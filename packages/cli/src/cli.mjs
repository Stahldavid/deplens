#!/usr/bin/env node
import { runInspect } from "@deplens/core"

function parseCliArgs(argv) {
  const target = argv[0]
  let filter = argv[1] && !argv[1].startsWith("--") ? argv[1].toLowerCase() : null
  const showTypes = argv.includes("--types")

  let jsdoc = null
  const jsdocIndex = argv.indexOf("--jsdoc")
  if (jsdocIndex !== -1 && argv[jsdocIndex + 1]) {
    jsdoc = argv[jsdocIndex + 1].toLowerCase()
  }

  let jsdocOutput = null
  const jsdocOutputIndex = argv.indexOf("--jsdoc-output")
  if (jsdocOutputIndex !== -1 && argv[jsdocOutputIndex + 1]) {
    jsdocOutput = argv[jsdocOutputIndex + 1].toLowerCase()
  }

  let jsdocSymbols = null
  const jsdocSymbolIndex = argv.indexOf("--jsdoc-symbol")
  if (jsdocSymbolIndex !== -1 && argv[jsdocSymbolIndex + 1]) {
    jsdocSymbols = argv[jsdocSymbolIndex + 1]
  }

  let jsdocSections = null
  const jsdocSectionsIndex = argv.indexOf("--jsdoc-sections")
  if (jsdocSectionsIndex !== -1 && argv[jsdocSectionsIndex + 1]) {
    jsdocSections = argv[jsdocSectionsIndex + 1]
  }

  let jsdocTagsInclude = null
  const jsdocTagsIndex = argv.indexOf("--jsdoc-tags")
  if (jsdocTagsIndex !== -1 && argv[jsdocTagsIndex + 1]) {
    jsdocTagsInclude = argv[jsdocTagsIndex + 1]
  }

  let jsdocTagsExclude = null
  const jsdocTagsExcludeIndex = argv.indexOf("--jsdoc-tags-exclude")
  if (jsdocTagsExcludeIndex !== -1 && argv[jsdocTagsExcludeIndex + 1]) {
    jsdocTagsExclude = argv[jsdocTagsExcludeIndex + 1]
  }

  let jsdocTruncate = null
  const jsdocTruncateIndex = argv.indexOf("--jsdoc-truncate")
  if (jsdocTruncateIndex !== -1 && argv[jsdocTruncateIndex + 1]) {
    jsdocTruncate = argv[jsdocTruncateIndex + 1].toLowerCase()
  }

  let jsdocMaxLen = null
  const jsdocMaxLenIndex = argv.indexOf("--jsdoc-max-len")
  if (jsdocMaxLenIndex !== -1 && argv[jsdocMaxLenIndex + 1]) {
    const parsed = parseInt(argv[jsdocMaxLenIndex + 1], 10)
    if (!isNaN(parsed) && parsed >= 0) jsdocMaxLen = parsed
  }

  const filterIndex = argv.indexOf("--filter")
  if (filterIndex !== -1 && argv[filterIndex + 1]) {
    filter = argv[filterIndex + 1].toLowerCase()
  }

  let resolveFrom = null
  const resolveFromIndex = argv.indexOf("--resolve-from")
  if (resolveFromIndex !== -1 && argv[resolveFromIndex + 1]) {
    resolveFrom = argv[resolveFromIndex + 1]
  }

  let kindFilter = null
  const kindIndex = argv.indexOf("--kind")
  if (kindIndex !== -1 && argv[kindIndex + 1]) {
    kindFilter = argv[kindIndex + 1].split(",").map((k) => k.trim().toLowerCase())
  }

  let depth = 1
  const depthIndex = argv.indexOf("--depth")
  if (depthIndex !== -1 && argv[depthIndex + 1]) {
    depth = parseInt(argv[depthIndex + 1], 10)
    if (isNaN(depth) || depth < 0 || depth > 5) {
      depth = 1
    }
  }

  let jsdocQuery = null
  if (
    jsdocSymbols ||
    jsdocSections ||
    jsdocTagsInclude ||
    jsdocTagsExclude ||
    jsdocTruncate ||
    jsdocMaxLen !== null
  ) {
    const symbols = jsdocSymbols ? jsdocSymbols.split(",").map((s) => s.trim()).filter(Boolean) : undefined
    const sections = jsdocSections ? jsdocSections.split(",").map((s) => s.trim()).filter(Boolean) : undefined
    const tagsInclude = jsdocTagsInclude ? jsdocTagsInclude.split(",").map((s) => s.trim()).filter(Boolean) : undefined
    const tagsExclude = jsdocTagsExclude ? jsdocTagsExclude.split(",").map((s) => s.trim()).filter(Boolean) : undefined
    jsdocQuery = {
      symbols: symbols && symbols.length === 1 ? symbols[0] : symbols,
      sections,
      tags: tagsInclude || tagsExclude ? { include: tagsInclude, exclude: tagsExclude } : undefined,
      mode: jsdoc === "compact" || jsdoc === "full" ? jsdoc : undefined,
      maxLen: jsdocMaxLen ?? undefined,
      truncate: jsdocTruncate ?? undefined,
    }
  }

  return { target, filter, showTypes, kindFilter, depth, resolveFrom, jsdoc, jsdocOutput, jsdocQuery }
}

function usage() {
  console.error(
    "Uso: deplens <pacote> [filtro] [--filter VALUE] [--types] [--jsdoc off|compact|full] [--jsdoc-output off|section|inline|only] [--jsdoc-symbol NAME|glob|/re/] [--jsdoc-sections summary,params,returns,tags] [--jsdoc-tags t1,t2] [--jsdoc-tags-exclude t1,t2] [--jsdoc-truncate none|sentence|word] [--jsdoc-max-len N] [--kind function,class,...] [--depth N] [--resolve-from DIR]"
  )
}

const parsed = parseCliArgs(process.argv.slice(2))
if (!parsed.target) {
  usage()
  process.exit(1)
}

runInspect({
  target: parsed.target,
  filter: parsed.filter,
  showTypes: parsed.showTypes,
  jsdoc: parsed.jsdoc,
  jsdocOutput: parsed.jsdocOutput,
  jsdocQuery: parsed.jsdocQuery,
  kind: parsed.kindFilter,
  depth: parsed.depth,
  resolveFrom: parsed.resolveFrom,
  cwd: process.cwd(),
  write: console.log,
  writeError: console.error,
})
