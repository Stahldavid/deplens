import argparse
import ast
import json
import os
import sys
import textwrap
from dataclasses import dataclass
from importlib import metadata as importlib_metadata
from importlib import util as importlib_util
from pathlib import Path

try:
    import tomllib
except Exception:  # pragma: no cover
    tomllib = None


EXCLUDED_DIRS = {
    "__pycache__",
    "node_modules",
    "target",
    "dist",
    ".git",
    "build",
    "out",
    ".mypy_cache",
    ".pytest_cache",
    ".venv",
    "venv",
}


@dataclass
class AnalyzeOptions:
    filter: str | None = None
    include_body: bool = False
    max_body_lines: int = 10


def to_json(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=True))


def parse_source(source: str):
    return ast.parse(source)


def complexity_for(node):
    complexity = 1
    for child in ast.walk(node):
        if isinstance(
            child,
            (
                ast.If,
                ast.For,
                ast.AsyncFor,
                ast.While,
                ast.Try,
                ast.With,
                ast.AsyncWith,
                ast.Match,
                ast.IfExp,
                ast.ExceptHandler,
            ),
        ):
            complexity += 1
        elif isinstance(child, ast.comprehension):
            complexity += 1
        elif isinstance(child, ast.BoolOp):
            complexity += max(1, len(child.values) - 1)
    return complexity


def detect_patterns(node):
    patterns = set()

    if getattr(node, "decorator_list", None):
        patterns.add("decorator")

    for child in ast.walk(node):
        if isinstance(child, (ast.Try, ast.ExceptHandler, ast.Raise)):
            patterns.add("error-handling")
        elif isinstance(child, (ast.With, ast.AsyncWith)):
            patterns.add("context-manager")
        elif isinstance(child, ast.Match):
            patterns.add("pattern-matching")
        elif isinstance(child, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            patterns.add("comprehension")
        elif isinstance(child, (ast.AsyncFunctionDef, ast.Await)):
            patterns.add("async")
        elif isinstance(child, (ast.Yield, ast.YieldFrom)):
            patterns.add("generator")
        elif isinstance(child, (ast.AnnAssign,)):
            patterns.add("type-hints")
        elif isinstance(child, ast.arg) and child.annotation is not None:
            patterns.add("type-hints")

    if getattr(node, "returns", None) is not None:
        patterns.add("type-hints")

    return sorted(patterns)


def unparse(node):
    if node is None:
        return None
    try:
        return ast.unparse(node)
    except Exception:
        return None


def format_parameters(arguments: ast.arguments):
    parts = []
    positional = list(arguments.posonlyargs) + list(arguments.args)
    positional_defaults = [None] * (len(positional) - len(arguments.defaults)) + list(arguments.defaults)

    for index, arg in enumerate(arguments.posonlyargs):
        parts.append(format_single_arg(arg, positional_defaults[index]))
    if arguments.posonlyargs:
        parts.append("/")

    for offset, arg in enumerate(arguments.args, start=len(arguments.posonlyargs)):
        parts.append(format_single_arg(arg, positional_defaults[offset]))

    if arguments.vararg:
        parts.append(format_single_arg(arguments.vararg, prefix="*"))
    elif arguments.kwonlyargs:
        parts.append("*")

    for arg, default in zip(arguments.kwonlyargs, arguments.kw_defaults):
        parts.append(format_single_arg(arg, default))

    if arguments.kwarg:
        parts.append(format_single_arg(arguments.kwarg, prefix="**"))

    return ", ".join(parts)


def format_single_arg(arg: ast.arg, default=None, prefix=""):
    annotation = f": {unparse(arg.annotation)}" if arg.annotation else ""
    default_text = f" = {unparse(default)}" if default is not None else ""
    return f"{prefix}{arg.arg}{annotation}{default_text}"


def get_body_snippet(source_lines, node, include_body, max_body_lines):
    if not include_body or not getattr(node, "body", None):
        return None
    first_stmt = node.body[0]
    last_stmt = node.body[-1]
    start = max(first_stmt.lineno - 1, 0)
    end = max(getattr(last_stmt, "end_lineno", last_stmt.lineno), first_stmt.lineno)
    snippet = textwrap.dedent("\n".join(source_lines[start:end])).strip()
    if not snippet:
        return None
    lines = snippet.splitlines()
    if len(lines) <= max_body_lines:
        return snippet
    return "\n".join(lines[:max_body_lines]) + f"\n... ({len(lines) - max_body_lines} more lines)"


def extract_imports(tree):
    imports = []
    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(
                    {
                        "type": "module",
                        "name": alias.name,
                        "alias": alias.asname,
                        "line": node.lineno,
                    }
                )
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name == "*":
                    continue
                imports.append(
                    {
                        "type": "from",
                        "module": node.module,
                        "name": alias.name,
                        "alias": alias.asname,
                        "line": node.lineno,
                    }
                )
    return imports


def extract_function(node, source_lines, options: AnalyzeOptions, owner=None):
    return {
        "name": node.name,
        "owner": owner,
        "qualifiedName": f"{owner}.{node.name}" if owner else node.name,
        "kind": "async-function" if isinstance(node, ast.AsyncFunctionDef) else "function",
        "params": format_parameters(node.args),
        "line": node.lineno,
        "returns": unparse(getattr(node, "returns", None)),
        "decorators": [unparse(decorator) for decorator in getattr(node, "decorator_list", [])],
        "complexity": complexity_for(node),
        "patterns": detect_patterns(node),
        "body": get_body_snippet(source_lines, node, options.include_body, options.max_body_lines),
    }


def extract_class(node, source_lines, options: AnalyzeOptions):
    methods = []
    for child in node.body:
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
            methods.append(extract_function(child, source_lines, options, owner=node.name))

    return {
        "name": node.name,
        "bases": [unparse(base) for base in node.bases],
        "line": node.lineno,
        "decorators": [unparse(decorator) for decorator in getattr(node, "decorator_list", [])],
        "methods": methods,
    }


def analyze_python_source(source: str, options: AnalyzeOptions):
    try:
        tree = parse_source(source)
    except SyntaxError as exc:
        return {
            "functions": [],
            "classes": [],
            "imports": [],
            "error": str(exc),
        }

    source_lines = source.splitlines()
    functions = []
    classes = []

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if options.filter and options.filter.lower() not in node.name.lower():
                continue
            functions.append(extract_function(node, source_lines, options))
        elif isinstance(node, ast.ClassDef):
            cls = extract_class(node, source_lines, options)
            if options.filter:
                cls["methods"] = [
                    method
                    for method in cls["methods"]
                    if options.filter.lower() in method["name"].lower()
                    or options.filter.lower() in method["qualifiedName"].lower()
                ]
            classes.append(cls)

    return {
        "functions": functions,
        "classes": classes,
        "imports": extract_imports(tree),
    }


def iter_python_files(pkg_dir: Path, max_files: int, depth_limit: int = 10):
    files = []

    def walk(directory: Path, depth: int = 0):
        if depth > depth_limit or len(files) >= max_files:
            return
        for entry in sorted(directory.iterdir(), key=lambda item: item.name):
            if len(files) >= max_files:
                break
            if entry.is_dir():
                if entry.name.startswith(".") or entry.name in EXCLUDED_DIRS:
                    continue
                walk(entry, depth + 1)
            elif entry.is_file() and entry.suffix == ".py":
                files.append(entry)

    walk(pkg_dir)
    return files


def analyze_python_package(pkg_dir: str, options: AnalyzeOptions, max_files: int):
    pkg_path = Path(pkg_dir).resolve()
    files = iter_python_files(pkg_path, max_files=max_files)
    if not files:
        return {"error": "No Python files found", "files": []}

    results = {
        "files": [],
        "summary": {
            "totalFiles": len(files),
            "totalFunctions": 0,
            "totalClasses": 0,
            "totalMethods": 0,
            "avgComplexity": 0,
            "highComplexityFunctions": [],
        },
    }

    total_complexity = 0
    total_items = 0

    for file_path in files:
        try:
            content = file_path.read_text(encoding="utf-8")
        except Exception as exc:
            results["files"].append({"path": str(file_path.relative_to(pkg_path)), "error": str(exc)})
            continue

        analysis = analyze_python_source(content, options)
        functions = analysis["functions"]
        classes = analysis["classes"]
        imports = analysis["imports"]
        file_entry = {
            "path": str(file_path.relative_to(pkg_path)),
            "functions": functions,
            "classes": classes,
            "imports": imports,
        }
        if "error" in analysis:
            file_entry["error"] = analysis["error"]
        results["files"].append(file_entry)

        results["summary"]["totalFunctions"] += len(functions)
        results["summary"]["totalClasses"] += len(classes)
        method_count = sum(len(cls["methods"]) for cls in classes)
        results["summary"]["totalMethods"] += method_count

        for fn in functions:
            total_items += 1
            total_complexity += fn["complexity"]
            if fn["complexity"] >= 10:
                results["summary"]["highComplexityFunctions"].append(
                    {"name": fn["qualifiedName"], "file": file_entry["path"], "complexity": fn["complexity"]}
                )

        for cls in classes:
            for method in cls["methods"]:
                total_items += 1
                total_complexity += method["complexity"]
                if method["complexity"] >= 10:
                    results["summary"]["highComplexityFunctions"].append(
                        {
                            "name": method["qualifiedName"],
                            "file": file_entry["path"],
                            "complexity": method["complexity"],
                        }
                    )

    results["summary"]["avgComplexity"] = round(total_complexity / total_items, 1) if total_items else 0
    results["summary"]["highComplexityFunctions"].sort(key=lambda item: item["complexity"], reverse=True)
    return results


def read_pyproject_metadata(project_root: Path):
    if tomllib is None:
        return {}
    pyproject = project_root / "pyproject.toml"
    if not pyproject.exists():
        return {}
    try:
        data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
    except Exception:
        return {}
    project = data.get("project", {})
    return {
        "name": project.get("name"),
        "version": project.get("version"),
        "description": project.get("description"),
    }


def find_local_package_dir(project_root: Path, preferred_name: str | None = None):
    normalized = preferred_name.replace("-", "_") if preferred_name else None
    search_roots = [project_root, project_root / "src"]
    for search_root in search_roots:
        if not search_root.exists() or not search_root.is_dir():
            continue
        if normalized:
            preferred = search_root / normalized
            if preferred.is_dir() and (preferred / "__init__.py").exists():
                return preferred
        for child in sorted(search_root.iterdir(), key=lambda item: item.name):
            if child.is_dir() and (child / "__init__.py").exists():
                return child
    return project_root if (project_root / "__init__.py").exists() else None


def resolve_local_target(target: str, cwd: Path):
    target_path = Path(target)
    if not target_path.is_absolute():
        target_path = (cwd / target_path).resolve()
    if not target_path.exists():
        return None

    if target_path.is_file():
        pkg_dir = target_path.parent
        project_root = pkg_dir
        resolved = str(target_path)
    else:
        project_root = target_path
        metadata = read_pyproject_metadata(project_root)
        pkg_dir = find_local_package_dir(project_root, metadata.get("name"))
        if pkg_dir is None:
            pkg_dir = project_root
        init_file = pkg_dir / "__init__.py"
        resolved = str(init_file if init_file.exists() else pkg_dir)

    metadata = read_pyproject_metadata(project_root)
    return {
        "resolved": resolved,
        "pkgDir": str(pkg_dir.resolve()),
        "package": metadata.get("name") or pkg_dir.name,
        "version": metadata.get("version"),
        "description": metadata.get("description"),
        "module": pkg_dir.name,
        "distribution": metadata.get("name"),
        "pythonExecutable": sys.executable,
        "source": "local-path",
    }


def choose_distribution_name(module_name: str, target: str):
    distributions = importlib_metadata.packages_distributions()
    top_level = module_name.split(".")[0]
    names = distributions.get(top_level, [])
    if names:
        return names[0]

    normalized_target = target.replace("_", "-").lower()
    for dist in importlib_metadata.distributions():
        name = dist.metadata.get("Name")
        if name and name.lower() == normalized_target:
            return name
    return None


def resolve_installed_target(target: str):
    candidates = [target]
    if "-" in target:
        candidates.append(target.replace("-", "_"))

    spec = None
    chosen = None
    for candidate in candidates:
        try:
            spec = importlib_util.find_spec(candidate)
        except (ModuleNotFoundError, ValueError):
            spec = None
        if spec is not None:
            chosen = candidate
            break

    if spec is None:
        return {"error": f"Could not resolve Python package '{target}' in the active environment."}

    if spec.submodule_search_locations:
        pkg_dir = Path(next(iter(spec.submodule_search_locations))).resolve()
    elif spec.origin:
        pkg_dir = Path(spec.origin).resolve().parent
    else:
        return {"error": f"Resolved Python package '{target}' but could not determine its source directory."}

    dist_name = choose_distribution_name(chosen, target)
    version = None
    description = None
    if dist_name:
        try:
            version = importlib_metadata.version(dist_name)
        except Exception:
            version = None
        try:
            description = importlib_metadata.metadata(dist_name).get("Summary")
        except Exception:
            description = None

    resolved = str(Path(spec.origin).resolve()) if spec.origin else str(pkg_dir)
    return {
        "resolved": resolved,
        "pkgDir": str(pkg_dir),
        "package": dist_name or target,
        "version": version,
        "description": description,
        "module": chosen,
        "distribution": dist_name,
        "pythonExecutable": sys.executable,
        "source": "environment",
    }


def resolve_python_package(target: str, cwd: str):
    cwd_path = Path(cwd).resolve()
    local = resolve_local_target(target, cwd_path)
    if local is not None:
        return local
    return resolve_installed_target(target)


def main():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    analyze_file = subparsers.add_parser("analyze-file")
    analyze_file.add_argument("--file", required=True)
    analyze_file.add_argument("--filter")
    analyze_file.add_argument("--include-body", action="store_true")
    analyze_file.add_argument("--max-body-lines", type=int, default=10)

    analyze_package = subparsers.add_parser("analyze-package")
    analyze_package.add_argument("--pkg-dir", required=True)
    analyze_package.add_argument("--filter")
    analyze_package.add_argument("--include-body", action="store_true")
    analyze_package.add_argument("--max-body-lines", type=int, default=10)
    analyze_package.add_argument("--max-files", type=int, default=5)

    resolve_package = subparsers.add_parser("resolve-package")
    resolve_package.add_argument("--target", required=True)

    args = parser.parse_args()

    if args.command == "analyze-file":
        source = Path(args.file).read_text(encoding="utf-8")
        options = AnalyzeOptions(
            filter=args.filter,
            include_body=args.include_body,
            max_body_lines=args.max_body_lines,
        )
        to_json(analyze_python_source(source, options))
        return

    if args.command == "analyze-package":
        options = AnalyzeOptions(
            filter=args.filter,
            include_body=args.include_body,
            max_body_lines=args.max_body_lines,
        )
        to_json(analyze_python_package(args.pkg_dir, options, max_files=args.max_files))
        return

    if args.command == "resolve-package":
        to_json(resolve_python_package(args.target, os.getcwd()))
        return


if __name__ == "__main__":
    main()
