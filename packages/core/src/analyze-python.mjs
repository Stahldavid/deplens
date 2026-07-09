import fs from 'fs';
import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/python_ast_tools.py');

const PYTHON_PROJECT_MARKERS = ['pyproject.toml', 'uv.lock', 'requirements.txt', '.venv', 'venv'];
const commandExistsCache = new Map();
const pythonCommandsCache = new Map();

function findPythonProjectRoot(startDir) {
  if (!startDir || !fs.existsSync(startDir)) return null;
  let current = path.resolve(startDir);
  const stat = fs.statSync(current);
  if (stat.isFile()) current = path.dirname(current);

  while (true) {
    if (PYTHON_PROJECT_MARKERS.some((marker) => fs.existsSync(path.join(current, marker)))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function findVenvPython(projectRoot) {
  if (!projectRoot) return null;
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(projectRoot, '.venv', 'Scripts', 'python.exe'),
          path.join(projectRoot, 'venv', 'Scripts', 'python.exe'),
        ]
      : [
          path.join(projectRoot, '.venv', 'bin', 'python'),
          path.join(projectRoot, 'venv', 'bin', 'python'),
        ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function commandExists(command, args = ['--version']) {
  const cacheKey = `${command}\0${args.join('\0')}`;
  if (commandExistsCache.has(cacheKey)) return commandExistsCache.get(cacheKey);
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 1500,
  });
  if (result.error?.code === 'ETIMEDOUT') {
    commandExistsCache.set(cacheKey, false);
    return false;
  }
  if (result.error && result.error.code === 'ENOENT') {
    commandExistsCache.set(cacheKey, false);
    return false;
  }
  const exists = result.status === 0 || Boolean(result.stdout || result.stderr);
  commandExistsCache.set(cacheKey, exists);
  return exists;
}

function buildPythonCommands(cwd) {
  const cacheKey = path.resolve(cwd || process.cwd());
  if (pythonCommandsCache.has(cacheKey)) return pythonCommandsCache.get(cacheKey);

  const projectRoot = findPythonProjectRoot(cwd);
  const venvPython = findVenvPython(projectRoot);
  const hasUvProject =
    projectRoot &&
    (fs.existsSync(path.join(projectRoot, 'pyproject.toml')) ||
      fs.existsSync(path.join(projectRoot, 'uv.lock')));

  const commands = [];

  if (venvPython) {
    commands.push({
      command: venvPython,
      argsPrefix: [],
      cwd: projectRoot || cwd,
    });
    pythonCommandsCache.set(cacheKey, commands);
    return commands;
  }

  if (hasUvProject && commandExists('uv')) {
    commands.push({
      command: 'uv',
      argsPrefix: ['run', '--project', projectRoot, 'python'],
      cwd: projectRoot || cwd,
    });
  }

  if (process.platform === 'win32') {
    if (commandExists('py', ['-3', '--version'])) {
      commands.push({ command: 'py', argsPrefix: ['-3'], cwd: cwd || projectRoot || process.cwd() });
      pythonCommandsCache.set(cacheKey, commands);
      return commands;
    }
  }

  if (commandExists('python3')) {
    commands.push({ command: 'python3', argsPrefix: [], cwd: cwd || projectRoot || process.cwd() });
  }
  if (commandExists('python')) {
    commands.push({ command: 'python', argsPrefix: [], cwd: cwd || projectRoot || process.cwd() });
  }

  pythonCommandsCache.set(cacheKey, commands);
  return commands;
}

function runPythonTool(toolArgs, { cwd } = {}) {
  const commands = buildPythonCommands(cwd || process.cwd());
  if (commands.length === 0) {
    return { error: 'No Python runtime found (.venv, uv, py, python3, or python).' };
  }

  let lastFailure = null;

  for (const candidate of commands) {
    const args = [...candidate.argsPrefix, SCRIPT_PATH, ...toolArgs];
    const result = spawnSync(candidate.command, args, {
      cwd: candidate.cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    });

    if (result.error?.code === 'ETIMEDOUT') {
      lastFailure = 'Python tool timed out after 30000ms';
      continue;
    }

    if (result.error && result.error.code === 'ENOENT') {
      lastFailure = result.error.message;
      continue;
    }

    if (result.status !== 0) {
      lastFailure = (result.stderr || result.stdout || '').trim() || `Python tool failed with exit code ${result.status}`;
      continue;
    }

    try {
      return JSON.parse(result.stdout || '{}');
    } catch (error) {
      return {
        error: `Failed to parse Python tool output: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return { error: lastFailure || 'Python tool execution failed.' };
}

export function analyzePythonPackage(pkgDir, options = {}) {
  const { filter, maxFiles = 5, includeBody = false, maxBodyLines = 10 } = options;
  const args = ['analyze-package', '--pkg-dir', path.resolve(pkgDir), '--max-files', String(maxFiles)];
  if (filter) args.push('--filter', String(filter));
  if (includeBody) args.push('--include-body');
  if (maxBodyLines) args.push('--max-body-lines', String(maxBodyLines));
  return runPythonTool(args, { cwd: pkgDir });
}

export function analyzePythonFile(content, options = {}) {
  const { filter, includeBody = false, maxBodyLines = 10 } = options;
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'deplens-python-analyze-'));
  const tempFile = path.join(tempDir, 'snippet.py');
  writeFileSync(tempFile, content, 'utf-8');

  try {
    const args = ['analyze-file', '--file', tempFile];
    if (filter) args.push('--filter', String(filter));
    if (includeBody) args.push('--include-body');
    if (maxBodyLines) args.push('--max-body-lines', String(maxBodyLines));
    return runPythonTool(args, { cwd: process.cwd() });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function resolvePythonPackage(target, options = {}) {
  const args = ['resolve-package', '--target', String(target)];
  return runPythonTool(args, { cwd: options.resolveFrom || options.cwd || process.cwd() });
}

export default {
  analyzePythonPackage,
  analyzePythonFile,
  resolvePythonPackage,
};
