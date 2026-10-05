/** Markdown structure extraction for the isolated documentation checks. */

export interface DocumentationPage {
  metadata: Record<string, unknown>;
  body: string;
  links: string[];
  anchors: Set<string>;
}

export function parseDocumentationPage(source: string): DocumentationPage {
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source);
  if (!frontMatter) throw new Error('Missing YAML front matter.');
  const parsed: unknown = Bun.YAML.parse(frontMatter[1]!);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Front matter must be a mapping.');
  }
  const body = source.slice(frontMatter[0].length);
  const prose = stripFences(body);
  return {
    metadata: parsed as Record<string, unknown>,
    body,
    links: extractMarkdownLinks(prose),
    anchors: extractHeadingAnchors(prose),
  };
}

export function stripFences(source: string): string {
  let fence: { marker: string; length: number } | undefined;
  return source.split(/\r?\n/u).map((line) => {
    const match = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
    if (!fence && match) {
      fence = { marker: match[1]![0]!, length: match[1]!.length };
      return '';
    }
    if (fence) {
      if (match && match[1]![0] === fence.marker && match[1]!.length >= fence.length) {
        fence = undefined;
      }
      return '';
    }
    return line;
  }).join('\n');
}

export function extractMarkdownLinks(source: string): string[] {
  const links: string[] = [];
  const inline = /\[[^\]\n]*\]\(/gu;
  for (const match of source.matchAll(inline)) {
    let position = match.index + match[0].length;
    let target = '';
    if (source[position] === '<') {
      const end = source.indexOf('>', position + 1);
      if (end === -1) continue;
      target = source.slice(position + 1, end);
    } else {
      let depth = 0;
      for (; position < source.length; position++) {
        const character = source[position]!;
        if (character === '\\' && position + 1 < source.length) {
          target += source[++position];
        } else if (character === '(') {
          depth++;
          target += character;
        } else if (character === ')') {
          if (depth === 0) break;
          depth--;
          target += character;
        } else if (/\s/u.test(character) && depth === 0) {
          break;
        } else {
          target += character;
        }
      }
    }
    if (target) links.push(target);
  }
  for (const match of source.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*(?:<([^>]+)>|(\S+))/gmu)) {
    links.push(match[1] ?? match[2]!);
  }
  return links;
}

export function extractHeadingAnchors(source: string): Set<string> {
  const anchors = new Set<string>();
  const occurrences = new Map<string, number>();
  for (const match of source.matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gmu)) {
    const label = match[1]!.replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
      .replace(/<[^>]*>/gu, '')
      .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
      .trim().toLowerCase().replace(/\s/gu, '-');
    const count = occurrences.get(label) ?? 0;
    occurrences.set(label, count + 1);
    anchors.add(count === 0 ? label : `${label}-${count}`);
  }
  for (const match of source.matchAll(/<(?:a|h[1-6])\b[^>]*\bid=["']([^"']+)["']/gu)) {
    anchors.add(match[1]!);
  }
  return anchors;
}
