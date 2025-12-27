// inspect.mjs
import { createRequire } from "module"
import fs from "fs"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import fg from "fast-glob"
import { resolve as importMetaResolve } from "import-meta-resolve"
import { parseDtsFile } from "./parse-dts.mjs"

function getPackageName(target) {
  if (!target) return target
  if (target.startsWith("@")) {
    const parts = target.split("/")
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : target
  }
  return target.split("/")[0]
}

function getPackageSubpath(target) {
  if (!target) return null
  const base = getPackageName(target)
  if (!base) return null
  if (target === base) return null
  const prefix = `${base}/`
  return target.startsWith(prefix) ? target.slice(prefix.length) : null
}

async function findWorkspaceRoot(startDir) {
  if (!startDir) return null
  let dir = path.resolve(startDir)
  while (true) {
    const pkgPath = path.join(dir, "package.json")
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
        if (pkg?.workspaces) return { dir, pkg }
      } catch (e) {}
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

async function listWorkspacePackageDirs(rootDir, workspaces, targetPackage) {
  const patterns = Array.isArray(workspaces) ? workspaces : workspaces?.packages
  if (!Array.isArray(patterns) || patterns.length === 0) return []
  const dirs = []
  const target = getPackageName(targetPackage)

  for (const pattern of patterns) {
    if (!pattern) continue
    const normalized = String(pattern).replace(/\\/g, "/").replace(/\/?$/, "/")
    const globPattern = `${normalized}package.json`
    const matches =
      typeof Bun !== "undefined" && Bun.Glob
        ? await Array.fromAsync(
            new Bun.Glob(globPattern).scan({
              cwd: rootDir,
              absolute: false,
              onlyFiles: true,
              followSymlinks: false,
              dot: false,
            }),
          )
        : await fg(globPattern, {
            cwd: rootDir,
            onlyFiles: true,
            dot: false,
            followSymbolicLinks: false,
          })
    for (const match of matches) {
      const pkgPath = path.join(rootDir, match)
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
        const depTables = [
          pkg?.dependencies,
          pkg?.devDependencies,
          pkg?.peerDependencies,
          pkg?.optionalDependencies,
        ]
        const hasTarget =
          Boolean(target) &&
          depTables.some((deps) => deps && Object.prototype.hasOwnProperty.call(deps, target))
        if (hasTarget) {
          dirs.push(path.dirname(pkgPath))
        }
      } catch (e) {}
    }
  }

  return dirs
}

async function resolveTargetModule(target, cwd, resolveFrom) {
  const baseDir = resolveFrom || cwd
  if (!baseDir) return { resolved: null, resolveCwd: baseDir, resolver: null }

  const tryResolve = async (dir) => {
    if (!dir) return null
    if (typeof Bun !== "undefined" && Bun.resolve) {
      try {
        const resolved = await Bun.resolve(target, dir)
        return { resolved, resolver: "bun", resolveCwd: dir }
      } catch (e) {}
    }
    try {
      const parentUrl = pathToFileURL(path.join(dir, "noop.js")).href
      const resolvedUrl = await importMetaResolve(target, parentUrl)
      const resolvedPath = resolvedUrl.startsWith("file://") ? fileURLToPath(resolvedUrl) : resolvedUrl
      return { resolved: resolvedPath, resolver: "import-meta-resolve", resolveCwd: dir }
    } catch (e) {}
    try {
      const req = createRequire(path.join(dir, "noop.js"))
      const resolved = req.resolve(target)
      return { resolved, resolver: "require", resolveCwd: dir }
    } catch (e) {
      return null
    }
  }

  const direct = await tryResolve(baseDir)
  if (direct) return direct

  const workspace = await findWorkspaceRoot(baseDir)
  if (workspace?.pkg?.workspaces) {
    const dirs = await listWorkspacePackageDirs(workspace.dir, workspace.pkg.workspaces, target)
    for (const dir of dirs) {
      const resolved = await tryResolve(dir)
      if (resolved) return resolved
    }
  }

  return { resolved: null, resolveCwd: baseDir, resolver: null }
}

function findPackageJsonFromPath(startPath) {
  if (!startPath) return null
  let dir = path.dirname(startPath)
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, "package.json")
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function findPackageJsonInNodeModules(startDir, basePkg) {
  if (!startDir || !basePkg) return null
  const segments = basePkg.split("/")
  let dir = path.resolve(startDir)
  while (true) {
    const candidate = path.join(dir, "node_modules", ...segments, "package.json")
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function resolvePackageInfo(basePkg, require, resolveFrom, resolvedPath) {
  let pkgPath
  let pkgDir
  try {
    pkgPath = require.resolve(`${basePkg}/package.json`)
    pkgDir = path.dirname(pkgPath)
  } catch (e) {
    try {
      const mainPath = require.resolve(basePkg)
      let dir = path.dirname(mainPath)
      for (let i = 0; i < 5; i++) {
        const candidate = path.join(dir, "package.json")
        if (fs.existsSync(candidate)) {
          pkgPath = candidate
          pkgDir = dir
          break
        }
        dir = path.dirname(dir)
      }
    } catch (err) {}
  }

  if (!pkgPath && resolveFrom && basePkg) {
    const fallback = findPackageJsonInNodeModules(resolveFrom, basePkg)
    if (fallback) {
      pkgPath = fallback
      pkgDir = path.dirname(fallback)
    }
  }

  if (!pkgPath && resolvedPath) {
    const fallback = findPackageJsonFromPath(resolvedPath)
    if (fallback) {
      pkgPath = fallback
      pkgDir = path.dirname(fallback)
    }
  }

  if (resolveFrom && basePkg) {
    const rootCandidate = findPackageJsonInNodeModules(resolveFrom, basePkg)
    if (rootCandidate && rootCandidate !== pkgPath) {
      pkgPath = rootCandidate
      pkgDir = path.dirname(rootCandidate)
    }
  }

  if (!pkgPath || !fs.existsSync(pkgPath)) return null
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
  return { pkg, pkgPath, pkgDir }
}

function resolveTypesFromExportEntry(entry) {
  if (!entry) return null
  if (typeof entry === "string") return entry
  if (typeof entry === "object") {
    if (typeof entry.types === "string") return entry.types
    for (const key of ["import", "require", "default"]) {
      if (typeof entry[key] === "string") return entry[key]
    }
  }
  return null
}

function coerceTypesPath(typesPath) {
  if (!typesPath) return typesPath
  if (typesPath.endsWith(".d.ts") || typesPath.endsWith(".d.cts") || typesPath.endsWith(".d.mts")) {
    return typesPath
  }
  if (typesPath.endsWith(".mjs")) return typesPath.replace(/\.mjs$/, ".d.mts")
  if (typesPath.endsWith(".cjs")) return typesPath.replace(/\.cjs$/, ".d.cts")
  if (typesPath.endsWith(".js")) return typesPath.replace(/\.js$/, ".d.ts")
  return typesPath
}

function resolveTypesFile(pkg, pkgDir, subpath) {
  if (!pkg || !pkgDir) return { typesFile: null, dtsPath: null, source: null }
  let typesFile = null
  let source = null

  if (pkg.exports) {
    let entry = null
    if (subpath) {
      const key = subpath.startsWith(".") ? subpath : `./${subpath}`
      if (typeof pkg.exports === "object") {
        entry = pkg.exports[key]
      }
    } else if (typeof pkg.exports === "string") {
      entry = pkg.exports
    } else if (typeof pkg.exports === "object") {
      entry = pkg.exports["."] ?? pkg.exports["./"]
    }

    const typesFromExport = resolveTypesFromExportEntry(entry)
    if (typesFromExport) {
      typesFile = coerceTypesPath(typesFromExport)
      source = "exports"
    }
  }

  if (!typesFile) {
    typesFile = pkg.types || pkg.typings || null
    if (typesFile) source = "package"
  }

  if (!typesFile) {
    const candidates = [
      "dist/index.d.ts",
      "dist/index.d.cts",
      "dist/index.d.mts",
      "lib/index.d.ts",
      "lib/index.d.cts",
      "lib/index.d.mts",
      "index.d.ts",
      "index.d.cts",
      "index.d.mts",
      "types/index.d.ts",
    ]
    for (const candidate of candidates) {
      const candidatePath = path.resolve(pkgDir, candidate)
      if (fs.existsSync(candidatePath)) {
        typesFile = candidate
        source = "fallback"
        break
      }
    }
  }

  if (!typesFile) {
    return { typesFile: null, dtsPath: null, source: null }
  }

  const resolved = path.isAbsolute(typesFile) ? typesFile : path.resolve(pkgDir, typesFile)
  let dtsPath = resolved
  if (!fs.existsSync(dtsPath)) {
    const mapped = coerceTypesPath(dtsPath)
    if (mapped !== dtsPath && fs.existsSync(mapped)) {
      dtsPath = mapped
    } else {
      const replacements = [".d.ts", ".d.cts", ".d.mts"]
      for (const ext of replacements) {
        if (dtsPath.endsWith(ext)) continue
        const candidate = `${dtsPath}${ext}`
        if (fs.existsSync(candidate)) {
          dtsPath = candidate
          break
        }
      }
      if (!fs.existsSync(dtsPath) && dtsPath.endsWith(".d.ts")) {
        const ctsPath = dtsPath.replace(".d.ts", ".d.cts")
        const mtsPath = dtsPath.replace(".d.ts", ".d.mts")
        if (fs.existsSync(ctsPath)) dtsPath = ctsPath
        else if (fs.existsSync(mtsPath)) dtsPath = mtsPath
      }
    }
  }

  if (!fs.existsSync(dtsPath)) {
    const altDir = path.dirname(dtsPath)
    const altCandidates = [
      "types.d.ts",
      "types.d.mts",
      "types.d.cts",
      "index.d.ts",
      "index.d.mts",
      "index.d.cts",
    ]
    for (const candidate of altCandidates) {
      const altPath = path.join(altDir, candidate)
      if (fs.existsSync(altPath)) {
        dtsPath = altPath
        typesFile = path.relative(pkgDir, altPath)
        if (!source || source === "exports" || source === "package") {
          source = "fallback"
        }
        break
      }
    }
  }

  return { typesFile, dtsPath, source }
}

function normalizeCjsExports(exportsValue) {
  if (exportsValue === null || exportsValue === undefined) {
    return { default: exportsValue }
  }
  if (typeof exportsValue === "object" || typeof exportsValue === "function") {
    return { ...exportsValue, default: exportsValue }
  }
  return { default: exportsValue }
}

function detectModuleFormat(resolvedPath, pkg) {
  const ext = path.extname(resolvedPath)
  if (ext === ".cjs" || ext === ".cts") return "cjs"
  if (ext === ".mjs" || ext === ".mts") return "esm"
  if (pkg?.type === "module") return "esm"
  return "cjs"
}

function isProbablyClass(fn) {
  if (typeof fn !== "function") return false
  const source = Function.prototype.toString.call(fn)
  if (source.startsWith("class ")) return true
  if (fn.prototype) {
    const protoProps = Object.getOwnPropertyNames(fn.prototype).filter((p) => p !== "constructor")
    if (protoProps.length > 0) return true
  }
  return false
}

async function loadModuleExports(resolvedPath, require, pkg) {
  const format = detectModuleFormat(resolvedPath, pkg)
  if (format === "cjs") {
    const mod = require(resolvedPath)
    return { module: normalizeCjsExports(mod), format }
  }
  const mod = await import(pathToFileURL(resolvedPath).href)
  return { module: mod, format }
}

function buildSymbolMatcher(symbols, fallbackFilter) {
  const patterns = []
  const addPattern = (value) => {
    if (!value) return
    if (value.startsWith("/") && value.endsWith("/") && value.length > 2) {
      try {
        patterns.push({ type: "regex", value: new RegExp(value.slice(1, -1), "i") })
        return
      } catch (e) {
        patterns.push({ type: "substring", value: value.toLowerCase() })
        return
      }
    }
    if (value.includes("*")) {
      const escaped = value.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
      patterns.push({ type: "regex", value: new RegExp(`^${escaped}$`, "i") })
      return
    }
    patterns.push({ type: "substring", value: value.toLowerCase() })
  }

  if (Array.isArray(symbols)) {
    symbols.forEach(addPattern)
  } else if (typeof symbols === "string") {
    addPattern(symbols)
  } else if (fallbackFilter) {
    addPattern(fallbackFilter)
  }

  if (patterns.length === 0) return null
  return (name) => {
    const lower = name.toLowerCase()
    return patterns.some((pattern) => {
      if (pattern.type === "regex") return pattern.value.test(name)
      return lower.includes(pattern.value)
    })
  }
}

function truncateSummary(text, mode, maxLen, truncateMode) {
  if (!text) return ""
  const normalized = text.replace(/\s+/g, " ").trim()
  if (truncateMode === "none") return normalized
  const limit = typeof maxLen === "number" ? maxLen : mode === "compact" ? 240 : 1200
  if (normalized.length <= limit) return normalized
  if (truncateMode === "sentence") {
    const slice = normalized.slice(0, limit)
    const lastPeriod = Math.max(slice.lastIndexOf("."), slice.lastIndexOf("!"), slice.lastIndexOf("?"))
    if (lastPeriod > 40) {
      return `${slice.slice(0, lastPeriod + 1)}`
    }
  }
  if (truncateMode === "word") {
    const slice = normalized.slice(0, limit)
    const lastSpace = slice.lastIndexOf(" ")
    if (lastSpace > 40) {
      return `${slice.slice(0, lastSpace)}...`
    }
  }
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`
}

function formatJsdocEntry(name, doc, options) {
  const mode = options.mode || "compact"
  const truncateMode = options.truncate || "word"
  const maxLen = options.maxLen
  const sections = options.sections && options.sections.length > 0 ? options.sections : ["summary", "tags"]
  const includeTags = options.tags?.include || null
  const excludeTags = options.tags?.exclude || null

  const summary = truncateSummary(doc.summary || "", mode, maxLen, truncateMode)
  const tags = doc.tags || {}
  const tagLines = []

  const addTag = (tagName, values) => {
    if (!values || values.length === 0) {
      tagLines.push(`@${tagName}`)
      return
    }
    for (const value of values) {
      tagLines.push(value ? `@${tagName} ${value}` : `@${tagName}`)
    }
  }

  const wantParams = sections.includes("params")
  const wantReturns = sections.includes("returns")
  const wantTags = sections.includes("tags")

  if (wantParams) {
    if (tags.param) addTag("param", tags.param)
  }
  if (wantReturns) {
    if (tags.returns) addTag("returns", tags.returns)
    if (tags.return) addTag("return", tags.return)
  }
  if (wantTags) {
    for (const [tagName, values] of Object.entries(tags)) {
      if (tagName === "param" || tagName === "returns" || tagName === "return") continue
      if (includeTags && !includeTags.includes(tagName)) continue
      if (excludeTags && excludeTags.includes(tagName)) continue
      if (mode === "compact" && !includeTags && !excludeTags) {
        if (!["deprecated", "since", "experimental"].includes(tagName)) continue
      }
      addTag(tagName, values)
    }
  }

  const parts = []
  if (sections.includes("summary") && summary) {
    parts.push(summary)
  }
  if (tagLines.length > 0) {
    parts.push(tagLines.join("; "))
  }

  return `${name}: ${parts.join(" | ")}`.trim()
}

function filterTypeInfo(typeInfo, filter, kindFilter) {
  if (!typeInfo) return null
  const includeName = (name) => !filter || name.toLowerCase().includes(filter)
  const allow = (kind) => !kindFilter || kindFilter.length === 0 || kindFilter.includes(kind)
  const includeExtras = !kindFilter || kindFilter.length === 0

  const filtered = {
    functions: {},
    interfaces: {},
    types: {},
    classes: {},
    enums: {},
    namespaces: {},
    defaults: [],
    jsdoc: {},
  }

  if (allow("function")) {
    for (const [name, info] of Object.entries(typeInfo.functions)) {
      if (includeName(name)) filtered.functions[name] = info
    }
  }

  if (allow("interface")) {
    for (const [name, props] of Object.entries(typeInfo.interfaces)) {
      if (includeName(name)) filtered.interfaces[name] = props
    }
  }

  if (allow("type")) {
    for (const [name, def] of Object.entries(typeInfo.types)) {
      if (includeName(name)) filtered.types[name] = def
    }
  }

  if (allow("class")) {
    for (const [name, info] of Object.entries(typeInfo.classes)) {
      if (includeName(name)) filtered.classes[name] = info
    }
  }

  if (includeExtras) {
    for (const [name, members] of Object.entries(typeInfo.enums || {})) {
      if (includeName(name)) filtered.enums[name] = members
    }
    for (const [name, value] of Object.entries(typeInfo.namespaces || {})) {
      if (includeName(name)) filtered.namespaces[name] = value
    }
    filtered.defaults = (typeInfo.defaults || []).filter((value) => includeName("default") || includeName(value))
  }

  if (typeInfo.jsdoc) {
    for (const [name, doc] of Object.entries(typeInfo.jsdoc)) {
      if (includeName(name)) filtered.jsdoc[name] = doc
    }
  }

  return filtered
}

// Helper function to inspect object properties recursively
function inspectObject(obj, currentDepth = 0, maxDepth = 1, indent = "  ") {
  if (currentDepth >= maxDepth || obj === null || obj === undefined) {
    return []
  }

  const lines = []
  try {
    const descriptors = Object.getOwnPropertyDescriptors(obj)
    const keys = Object.keys(descriptors).slice(0, 10) // Limit to first 10 properties
    for (const key of keys) {
      try {
        const descriptor = descriptors[key]
        if (descriptor.get || descriptor.set) {
          lines.push(`${indent.repeat(currentDepth + 1)}${key}: <getter>`)
          continue
        }
        const value = descriptor.value
        const type = typeof value
        const prefix = indent.repeat(currentDepth + 1)

        if (type === "function") {
          const paramCount = value.length
          lines.push(`${prefix}${key}(${paramCount} param${paramCount !== 1 ? "s" : ""})`)
        } else if (type === "object" && value !== null) {
          lines.push(`${prefix}${key}: {object}`)
          if (currentDepth + 1 < maxDepth) {
            lines.push(...inspectObject(value, currentDepth + 1, maxDepth, indent))
          }
        } else {
          const valStr = type === "string" ? `"${String(value).substring(0, 30)}"` : String(value).substring(0, 30)
          lines.push(`${prefix}${key}: ${valStr}`)
        }
      } catch (e) {
        // Skip properties that throw on access
      }
    }
    const totalKeys = Object.keys(descriptors).length
    if (totalKeys > 10) {
      lines.push(`${indent.repeat(currentDepth + 1)}... and ${totalKeys - 10} more`)
    }
  } catch (e) {
    // Skip if object is not enumerable
  }
  return lines
}

export async function runInspect(options) {
  const collect = !options?.write && !options?.writeError
  const output = collect ? [] : null
  const write = options?.write
  const writeError = options?.writeError ?? options?.write

  const log = (line = "") => {
    if (collect) output.push(String(line))
    else if (write) write(String(line))
  }
  const logErr = (line = "") => {
    if (collect) output.push(String(line))
    else if (writeError) writeError(String(line))
  }

  const target = options?.target
  const filter = options?.filter ? options.filter.toLowerCase() : null
  const showTypes = Boolean(options?.showTypes)
  const jsdocModeRaw = options?.jsdoc ? String(options.jsdoc).toLowerCase() : null
  const jsdocQuery = options?.jsdocQuery || null
  const jsdocOutputRaw = options?.jsdocOutput ? String(options.jsdocOutput).toLowerCase() : null
  const jsdocOutput = jsdocOutputRaw || (jsdocQuery ? "section" : "off")
  const wantJsdoc = jsdocOutput !== "off"
  const jsdocMode =
    showTypes || wantJsdoc ? (jsdocQuery?.mode || jsdocModeRaw || "compact") : "off"
  const kindFilter = Array.isArray(options?.kind)
    ? options.kind.map((k) => String(k).trim().toLowerCase())
    : null
  let depth = typeof options?.depth === "number" ? options.depth : 1
  if (isNaN(depth) || depth < 0 || depth > 5) depth = 1

  if (!target) {
    logErr(
      "Uso: node inspect.mjs <pacote> [filtro] [--filter VALUE] [--types] [--jsdoc off|compact|full] [--jsdoc-output off|section|inline|only] [--jsdoc-symbol NAME|glob|/re/] [--jsdoc-sections summary,params,returns,tags] [--jsdoc-tags t1,t2] [--jsdoc-tags-exclude t1,t2] [--jsdoc-truncate none|sentence|word] [--jsdoc-max-len N] [--kind function,class,...] [--depth N] [--resolve-from DIR]",
    )
    return collect ? output.join("\n") : ""
  }

  const baseCwd = options?.cwd
  const resolveFrom = options?.resolveFrom
    ? path.resolve(baseCwd || process.cwd(), options.resolveFrom)
    : baseCwd
  if (baseCwd) {
    try {
      process.chdir(baseCwd)
    } catch (e) {}
  }

  const resolution = await resolveTargetModule(target, baseCwd, resolveFrom)
  const resolveCwd = resolution.resolveCwd || baseCwd
  const require = createRequire(resolveCwd ? path.join(resolveCwd, "noop.js") : import.meta.url)
  const resolvedPath = resolution.resolved
  const entrypointPath =
    typeof resolvedPath === "string" && resolvedPath.startsWith("file://")
      ? fileURLToPath(resolvedPath)
      : resolvedPath
  const entrypointExists = entrypointPath ? fs.existsSync(entrypointPath) : false

  const flags = []
  if (filter) flags.push(`Filtro: "${filter}"`)
  if (kindFilter) flags.push(`Kind: ${kindFilter.join(",")}`)
  if (showTypes || wantJsdoc) flags.push("Type Analysis")
  if (jsdocOutput !== "off") flags.push(`JSDoc: ${jsdocMode}`)
  if (depth > 1) flags.push(`Depth: ${depth}`)

  const flagsStr = flags.length > 0 ? ` (${flags.join(" | ")})` : ""
  log(`🔍 Target: ${target}${flagsStr}`)

  try {
    if (!resolution.resolved) {
      logErr(`\n❌ Erro: Não foi possível resolver '${target}'`)
      logErr(`ResolveFrom: ${resolveFrom || baseCwd || "unknown"}`)
      logErr(`Certifique-se que '${target}' está instalado e é um caminho válido.`)
      return collect ? output.join("\n") : ""
    }

    const basePkg = getPackageName(target)
    const subpath = getPackageSubpath(target)
    const pkgInfo = basePkg
      ? resolvePackageInfo(basePkg, require, resolveFrom || baseCwd || process.cwd(), entrypointPath)
      : null
    const pkg = pkgInfo?.pkg
    const pkgDir = pkgInfo?.pkgDir

    log(`\n🧭 Resolution:`)
    log(`   ResolveFrom: ${resolveFrom || baseCwd || "unknown"}`)
    log(`   Entrypoint: ${resolution.resolved}`)
    if (resolution.resolver) {
      log(`   Resolver: ${resolution.resolver}`)
    }
    if (pkgDir) {
      log(`   PackageRoot: ${pkgDir}`)
    }

    let dtsPath
    let typesFile
    let typesSource

    if (pkg) {
      log(`\n📄 Package Info:`)
      log(`   Name: ${pkg.name || basePkg}`)
      log(`   Version: ${pkg.version || "Unknown"}`)
      if (pkg.description) {
        log(`   Description: ${pkg.description}`)
      }
      if (pkg.license) {
        log(`   License: ${pkg.license}`)
      }

      const typesResolution = resolveTypesFile(pkg, pkgDir, subpath)
      typesFile = typesResolution.typesFile
      dtsPath = typesResolution.dtsPath
      typesSource = typesResolution.source

      if (typesFile) {
        const sourceLabel = typesSource ? ` (${typesSource})` : ""
        const existsLabel = dtsPath && fs.existsSync(dtsPath) ? "" : " (missing)"
        log(`   Types: ${typesFile}${sourceLabel}${existsLabel}`)
      } else {
        log(`   Types: Not found`)
      }

      // === Mostrar subpath exports ===
      if (pkg.exports && typeof pkg.exports === "object") {
        const exportEntries = Object.entries(pkg.exports)
        if (exportEntries.length > 0) {
          log(`\n🚪 Subpath Exports (${exportEntries.length} available):`)
          for (const [pathKey, value] of exportEntries.slice(0, 10)) {
            if (typeof value === "string") {
              log(`   ${pathKey} → ${value}`)
            } else if (value && typeof value === "object") {
              const targets = Object.keys(value).join(", ")
              log(`   ${pathKey} → { ${targets} }`)
            }
          }
          if (exportEntries.length > 10) {
            log(`   ... and ${exportEntries.length - 10} more`)
          }
        }
      }
    }

    let typeInfoRaw = null
    if ((showTypes || wantJsdoc) && dtsPath && fs.existsSync(dtsPath)) {
      typeInfoRaw = parseDtsFile(dtsPath, null)
    }

    let moduleNamespace = {}
    let moduleDescriptors = {}
    let allExports = []
    const runtimeAvailable = Boolean(entrypointExists)
    if (!runtimeAvailable) {
      log(`\n⚠️  Entrypoint not found on disk; runtime exports skipped.`)
    } else {
      const { module: loadedNamespace } = await loadModuleExports(entrypointPath, require, pkg)
      moduleNamespace = loadedNamespace
      moduleDescriptors = Object.getOwnPropertyDescriptors(moduleNamespace)
      allExports = Object.keys(moduleDescriptors)
    }

    // Lógica de Filtro
    let finalList = allExports
    if (filter) {
      finalList = allExports.filter((key) => key.toLowerCase().includes(filter))
    }

    // Se a lista for muito grande e não tiver filtro, avisa e corta
    const LIMIT = 100
    if (!filter && finalList.length > LIMIT) {
      log(`\n⚠️ Módulo exporta ${finalList.length} itens. Mostrando os primeiros ${LIMIT}...`)
      log(`DICA: Use o parâmetro 'filter' para encontrar o que procura.`)
      finalList = finalList.slice(0, LIMIT)
    }

    // === MELHORIA 2: Categorizar exports por tipo ===
    const categorized = {
      functions: [],
      classes: [],
      objects: [],
      primitives: [],
      constants: [],
    }

    if (runtimeAvailable) {
      for (const key of finalList) {
        const descriptor = moduleDescriptors[key]
        if (!descriptor) continue
        if (descriptor.get || descriptor.set) {
          categorized.objects.push(key)
          continue
        }
        const value = descriptor.value
        const type = typeof value

        if (type === "function") {
          // Distinguir class vs function
          if (isProbablyClass(value)) {
            categorized.classes.push(key)
          } else {
            categorized.functions.push(key)
          }
        } else if (type === "object" && value !== null) {
          categorized.objects.push(key)
        } else if (type === "string" || type === "number" || type === "boolean") {
          categorized.constants.push(key)
        } else {
          categorized.primitives.push(key)
        }
      }

      // Prefer class from type info when available
      if (typeInfoRaw && Object.keys(typeInfoRaw.classes).length > 0) {
        const classNames = new Set(Object.keys(typeInfoRaw.classes))
        categorized.functions = categorized.functions.filter((name) => {
          if (classNames.has(name)) {
            categorized.classes.push(name)
            return false
          }
          return true
        })
      }

      // Apply kind filter if specified
      if (kindFilter && kindFilter.length > 0) {
        const kindMap = {
          function: "functions",
          class: "classes",
          object: "objects",
          constant: "constants",
        }

        // Keep only the requested kinds
        for (const [key, value] of Object.entries(categorized)) {
          const shouldKeep = Object.entries(kindMap).some(
            ([kind, catKey]) => kindFilter.includes(kind) && catKey === key,
          )
          if (!shouldKeep) {
            categorized[key] = []
          }
        }

        // Update finalList to only include filtered kinds
        finalList = [...categorized.functions, ...categorized.classes, ...categorized.objects, ...categorized.constants]
      }
    }

    // Mostrar exports categorizados
    if (jsdocOutput !== "only") {
      if (!runtimeAvailable) {
        log(`\nℹ️  Runtime exports unavailable. Use --types to inspect type exports.`)
      }
      log(`\n🔑 Exports Encontrados (${finalList.length} total):`)

      if (categorized.functions.length > 0) {
        log(`\n  📘 Functions (${categorized.functions.length}):`)
        log(`     ${categorized.functions.join(", ")}`)
      }

      if (categorized.classes.length > 0) {
        log(`\n  🏛️  Classes (${categorized.classes.length}):`)
        log(`     ${categorized.classes.join(", ")}`)
      }

      if (categorized.objects.length > 0) {
        log(`\n  📦 Objects/Namespaces (${categorized.objects.length}):`)
        log(`     ${categorized.objects.join(", ")}`)

        // If depth > 0, show object contents
        if (depth > 0 && categorized.objects.length <= 10) {
          log(`\n  📦 Object Contents (depth: ${depth}):`)
          for (const objName of categorized.objects) {
            log(`\n     ${objName}:`)
            const descriptor = moduleDescriptors[objName]
            if (!descriptor || descriptor.get || descriptor.set) {
              log(`     ${objName}: <getter>`)
              continue
            }
            const objValue = descriptor.value
            const lines = inspectObject(objValue, 0, depth, "  ")
            lines.forEach((line) => log(`     ${line}`))
          }
        } else if (depth > 0 && categorized.objects.length > 10) {
          log(`\n  ℹ️  Too many objects to show contents. Use 'filter' to narrow down.`)
        }
      }

      if (categorized.constants.length > 0) {
        log(`\n  🔢 Constants (${categorized.constants.length}):`)
        log(`     ${categorized.constants.join(", ")}`)
      }

      if (finalList.length === 0) {
        log("Nenhum export corresponde ao filtro.")
      }
    }

    // === MELHORIA 5: Mostrar assinaturas de funções ===
    if (jsdocOutput !== "only") {
      if (!runtimeAvailable) {
        // Skip runtime-only signature/default export hints when entrypoint is missing
      } else if (!showTypes && categorized.functions.length > 0 && categorized.functions.length <= 15) {
        log(`\n✍️  Function Signatures:`)
        for (const fname of categorized.functions) {
          const descriptor = moduleDescriptors[fname]
          const fn = descriptor?.value
          if (typeof fn === "function") {
            const paramCount = fn.length
            const params = paramCount === 0 ? "" : paramCount === 1 ? "1 param" : `${paramCount} params`
            log(`     ${fname}(${params})`)
          }
        }
      }

      // Default export handling
      if (runtimeAvailable) {
        const defaultDescriptor = moduleDescriptors.default
        if (defaultDescriptor && (!filter || "default".includes(filter))) {
          const defaultValue = defaultDescriptor.get || defaultDescriptor.set ? undefined : defaultDescriptor.value
          const defaultType = typeof defaultValue
          log(`\n📦 Default Export: ${defaultType}`)
          if (defaultType === "function" && defaultValue && defaultValue.length !== undefined) {
            log(`   Parameters: ${defaultValue.length}`)
          }
        }
      }
    }

    // === NEW: Parse .d.ts file if --types flag is present ===
    if (showTypes || wantJsdoc) {
      if (dtsPath && fs.existsSync(dtsPath)) {
        if (jsdocOutput !== "only") {
          log(`\n🔬 Type Definitions Analysis:`)
          log(`   Source: ${path.basename(dtsPath)}`)
        }

        const typeInfo = filterTypeInfo(typeInfoRaw, filter, kindFilter)

        if (typeInfo) {
          if (jsdocOutput !== "only") {
            // Show function signatures with full type info
            if (Object.keys(typeInfo.functions).length > 0) {
              log(`\n  📘 Function Type Signatures:`)
              for (const [name, info] of Object.entries(typeInfo.functions)) {
                log(`     ${name}(${info.params}): ${info.returnType}`)
                if (jsdocOutput === "inline" && typeInfo.jsdoc?.[name]) {
                  const entry = formatJsdocEntry(name, typeInfo.jsdoc[name], {
                    mode: jsdocMode,
                    truncate: jsdocQuery?.truncate,
                    maxLen: jsdocQuery?.maxLen,
                    sections: jsdocQuery?.sections,
                    tags: jsdocQuery?.tags,
                  })
                  log(`       ↳ ${entry}`)
                }
              }
            }

            // Show interfaces
            if (Object.keys(typeInfo.interfaces).length > 0) {
              log(`\n  📋 Interfaces:`)
              for (const [name, props] of Object.entries(typeInfo.interfaces)) {
                log(`     interface ${name} {`)
                props.forEach((prop) => log(`       ${prop}`))
                if (props.length === 5) {
                  log(`       ... (truncated)`)
                }
                log(`     }`)
                if (jsdocOutput === "inline" && typeInfo.jsdoc?.[name]) {
                  const entry = formatJsdocEntry(name, typeInfo.jsdoc[name], {
                    mode: jsdocMode,
                    truncate: jsdocQuery?.truncate,
                    maxLen: jsdocQuery?.maxLen,
                    sections: jsdocQuery?.sections,
                    tags: jsdocQuery?.tags,
                  })
                  log(`       ↳ ${entry}`)
                }
              }
            }

            // Show type aliases
            if (Object.keys(typeInfo.types).length > 0) {
              log(`\n  📝 Type Aliases:`)
              for (const [name, definition] of Object.entries(typeInfo.types)) {
                const shortDef = definition.length > 80 ? definition.substring(0, 80) + "..." : definition
                log(`     type ${name} = ${shortDef}`)
                if (jsdocOutput === "inline" && typeInfo.jsdoc?.[name]) {
                  const entry = formatJsdocEntry(name, typeInfo.jsdoc[name], {
                    mode: jsdocMode,
                    truncate: jsdocQuery?.truncate,
                    maxLen: jsdocQuery?.maxLen,
                    sections: jsdocQuery?.sections,
                    tags: jsdocQuery?.tags,
                  })
                  log(`       ↳ ${entry}`)
                }
              }
            }

            // Show class inheritance
            if (Object.keys(typeInfo.classes).length > 0) {
              log(`\n  🏛️  Class Definitions:`)
              for (const [name, extendsClass] of Object.entries(typeInfo.classes)) {
                const inheritance = extendsClass ? ` extends ${extendsClass}` : ""
                log(`     class ${name}${inheritance}`)
                if (jsdocOutput === "inline" && typeInfo.jsdoc?.[name]) {
                  const entry = formatJsdocEntry(name, typeInfo.jsdoc[name], {
                    mode: jsdocMode,
                    truncate: jsdocQuery?.truncate,
                    maxLen: jsdocQuery?.maxLen,
                    sections: jsdocQuery?.sections,
                    tags: jsdocQuery?.tags,
                  })
                  log(`       ↳ ${entry}`)
                }
              }
            }

            if (Object.keys(typeInfo.enums).length > 0) {
              log(`\n  🧾 Enums:`)
              for (const [name, members] of Object.entries(typeInfo.enums)) {
                const preview = members.length > 0 ? ` = [${members.join(", ")}]` : ""
                log(`     enum ${name}${preview}`)
                if (jsdocOutput === "inline" && typeInfo.jsdoc?.[name]) {
                  const entry = formatJsdocEntry(name, typeInfo.jsdoc[name], {
                    mode: jsdocMode,
                    truncate: jsdocQuery?.truncate,
                    maxLen: jsdocQuery?.maxLen,
                    sections: jsdocQuery?.sections,
                    tags: jsdocQuery?.tags,
                  })
                  log(`       ↳ ${entry}`)
                }
              }
            }

            if (Object.keys(typeInfo.namespaces).length > 0) {
              log(`\n  📦 Namespaces:`)
              for (const name of Object.keys(typeInfo.namespaces)) {
                log(`     namespace ${name}`)
                if (jsdocOutput === "inline" && typeInfo.jsdoc?.[name]) {
                  const entry = formatJsdocEntry(name, typeInfo.jsdoc[name], {
                    mode: jsdocMode,
                    truncate: jsdocQuery?.truncate,
                    maxLen: jsdocQuery?.maxLen,
                    sections: jsdocQuery?.sections,
                    tags: jsdocQuery?.tags,
                  })
                  log(`       ↳ ${entry}`)
                }
              }
            }

            if (typeInfo.defaults.length > 0) {
              log(`\n  📦 Default Exports:`)
              typeInfo.defaults.slice(0, 5).forEach((value) => log(`     default = ${value}`))
            }
          }

          if (wantJsdoc && jsdocMode !== "off" && typeInfo.jsdoc && Object.keys(typeInfo.jsdoc).length > 0) {
            const symbolMatcher = buildSymbolMatcher(jsdocQuery?.symbols, filter)
            const entries = Object.entries(typeInfo.jsdoc)
              .filter(([name]) => (symbolMatcher ? symbolMatcher(name) : true))
              .slice(0, 50)

            if (entries.length > 0) {
              log(`\n  📚 JSDoc:`)
              for (const [name, doc] of entries) {
                const entry = formatJsdocEntry(name, doc, {
                  mode: jsdocMode,
                  truncate: jsdocQuery?.truncate,
                  maxLen: jsdocQuery?.maxLen,
                  sections: jsdocQuery?.sections,
                  tags: jsdocQuery?.tags,
                })
                log(`     ${entry}`)
              }
            }
          }

          if (jsdocOutput !== "only") {
            const typeExportNames = new Set([
              ...Object.keys(typeInfo.functions),
              ...Object.keys(typeInfo.interfaces),
              ...Object.keys(typeInfo.types),
              ...Object.keys(typeInfo.classes),
              ...Object.keys(typeInfo.enums),
              ...Object.keys(typeInfo.namespaces),
            ])
            if (runtimeAvailable) {
              const runtimeNames = new Set(allExports)
              const runtimeOnly = [...runtimeNames].filter((name) => !typeExportNames.has(name))
              const typesOnly = [...typeExportNames].filter((name) => !runtimeNames.has(name))

              if (runtimeOnly.length > 0 || typesOnly.length > 0) {
                log(`\n  ⚖️  Runtime/Types Mismatch:`)
                if (runtimeOnly.length > 0) {
                  log(`     Runtime only: ${runtimeOnly.slice(0, 10).join(", ")}`)
                }
                if (typesOnly.length > 0) {
                  log(`     Types only: ${typesOnly.slice(0, 10).join(", ")}`)
                }
              }
            }

            if (
              Object.keys(typeInfo.functions).length === 0 &&
              Object.keys(typeInfo.interfaces).length === 0 &&
              Object.keys(typeInfo.types).length === 0 &&
              Object.keys(typeInfo.classes).length === 0 &&
              Object.keys(typeInfo.enums).length === 0 &&
              Object.keys(typeInfo.namespaces).length === 0 &&
              typeInfo.defaults.length === 0
            ) {
              log(`   ⚠️  No type definitions found for filtered exports`)
            }
          }
        } else {
          if (jsdocOutput !== "only") {
            log(`   ⚠️  Could not parse type definitions`)
          }
        }
      } else {
        if (jsdocOutput !== "only") {
          log(`\n⚠️  Type definitions not available for this package`)
        }
      }
    }
  } catch (e) {
    logErr(`\n❌ Erro: ${e.message}`)
    logErr(`Certifique-se que '${target}' está instalado e é um caminho válido.`)
  }

  return collect ? output.join("\n") : ""
}
