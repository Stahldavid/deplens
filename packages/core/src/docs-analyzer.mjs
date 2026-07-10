export function looksLikeCodeBlock(value) {
  if (!value) return false;
  const text = String(value);
  return (
    text.includes('```') ||
    /\b(import|export)\b/.test(text) ||
    /\b(function|class)\b/.test(text) ||
    /\b(const|let|var)\b/.test(text) ||
    /=>/.test(text)
  );
}

export function extractMarkdownCodeFences(markdown, maxBlocks = 12, maxLinesPerBlock = 40) {
  if (!markdown) return [];
  const blocks = [];
  const expression = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match;
  while ((match = expression.exec(String(markdown))) && blocks.length < maxBlocks) {
    const language = String(match[1] || '').trim();
    const body = String(match[2] || '').trim();
    const code = body.split('\n').slice(0, maxLinesPerBlock).join('\n').trim();
    if (code) blocks.push({ lang: language, code });
  }
  return blocks;
}

export function extractMarkdownSections(markdown) {
  if (!markdown) return [];
  const sections = [];
  let current = null;
  let content = [];
  const flush = () => {
    if (!current) return;
    current.content = content.join('\n').trim();
    current.codeBlocks = extractMarkdownCodeFences(current.content, 5, 30);
    sections.push(current);
  };
  for (const line of String(markdown).split('\n')) {
    const header = line.match(/^(#{1,6})\s+(.+)$/);
    if (header) {
      flush();
      current = { level: header[1].length, title: header[2].trim(), content: '', codeBlocks: [] };
      content = [];
    } else if (current) {
      content.push(line);
    }
  }
  flush();
  return sections;
}

export function listReadmeSections(markdown) {
  return extractMarkdownSections(markdown).map((section) => ({
    level: section.level,
    title: section.title,
    hasCode: section.codeBlocks.length > 0,
    charCount: section.content.length,
  }));
}

export function extractSectionsByName(markdown, sectionNames, maxCharsPerSection = 4000) {
  if (!sectionNames?.length) return [];
  const names = sectionNames.map((name) => name.toLowerCase());
  return extractMarkdownSections(markdown)
    .filter((section) => {
      const title = section.title.toLowerCase();
      return names.some((name) => title.includes(name) || name.includes(title));
    })
    .map((section) => ({
      title: section.title,
      level: section.level,
      content: section.content.slice(0, maxCharsPerSection),
      codeBlocks: section.codeBlocks,
      truncated: section.content.length > maxCharsPerSection,
    }));
}

export function tokenizeSymbolName(name) {
  if (!name) return [];
  return String(name)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function expandSynonyms(tokens) {
  const synonyms = {
    validate: ['parse', 'check', 'assert', 'verify', 'safe'],
    validation: ['parse', 'check', 'assert', 'verify', 'safe'],
    schema: ['object', 'shape', 'struct'],
    http: ['fetch', 'request'],
    auth: ['token', 'session', 'login'],
  };
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const synonym of synonyms[token] || []) expanded.add(synonym);
  }
  return [...expanded];
}

export function rankReadmeSections(markdown, needle, maxSections = 5, maxCharsPerSection = 4000) {
  if (!markdown || !needle) return [];
  const tokens = expandSynonyms(tokenizeSymbolName(needle));
  const exact = String(needle).toLowerCase();
  return extractMarkdownSections(markdown)
    .map((section, index) => {
      const title = section.title.toLowerCase();
      const content = section.content.toLowerCase();
      let score = title.includes(exact) ? 50 : 0;
      score += (content.split(exact).length - 1) * 20;
      for (const token of tokens) {
        if (title.includes(token)) score += 10;
        score += (content.split(token).length - 1) * 3;
      }
      if (section.codeBlocks.some((block) => block.code.toLowerCase().includes(exact))) score += 30;
      return { section, index, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, maxSections)
    .map(({ section, score }) => ({
      title: section.title,
      level: section.level,
      score,
      content: section.content.slice(0, maxCharsPerSection),
      codeBlocks: section.codeBlocks,
      truncated: section.content.length > maxCharsPerSection,
    }));
}
