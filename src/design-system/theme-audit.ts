/** Read-only source-text migration diagnostics; not a CSS parser, a filesystem scan, or an automatic component rewrite. */
import { createThemeDeclarations } from './theme-tokens';
import { THEME_COMPATIBILITY_ALIASES } from './theme-compatibility';
import type { ThemeAuditFinding, ThemeAuditSource } from './theme-types';

/** Explicit runtime ownership prevents treating variable chart geometry and third-party CSS contracts as global token defects. */
export interface ThemeAuditOptions {
  readonly externalTokens?: readonly string[];
  readonly reportLegacyReferences?: boolean;
  readonly reportLiteralColors?: boolean;
}
const RUNTIME_PREFIXES = ['--radix-', '--shiki-', '--tw-'];
const RUNTIME_NAMES = ['--c', '--series', '--ridge', '--sidebar-width', '--sidebar-width-icon', '--sidebar-width-mobile'];

interface PreparedSource extends ThemeAuditSource {
  readonly css: boolean;
  readonly quotedSpans: readonly { readonly start: number; readonly end: number }[];
}

/** Mask comments without moving offsets or erasing quoted CSS/JS values. This is lexical preparation, not parsing. */
function prepare(source: ThemeAuditSource): PreparedSource {
  const characters = source.content.split('');
  const css = /\.css$/iu.test(source.name);
  const quotedSpans: { start: number; end: number }[] = [];
  let quote: string | undefined, quoteStart = 0;
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    if (quote) {
      if (character === '\\') { index++; continue; }
      if (character === quote) { quotedSpans.push({ start: quoteStart, end: index }); quote = undefined; }
      continue;
    }
    if (character === '"' || character === "'" || !css && character === '`') {
      quote = character; quoteStart = index; continue;
    }
    const block = character === '/' && characters[index + 1] === '*';
    const line = !css && character === '/' && characters[index + 1] === '/';
    if (!block && !line) continue;
    let end = index + 2;
    while (end < characters.length && (block ? !(characters[end] === '*' && characters[end + 1] === '/') : characters[end] !== '\n')) end++;
    if (block) end = Math.min(characters.length, end + 2);
    for (let cursor = index; cursor < end; cursor++) if (characters[cursor] !== '\n') characters[cursor] = ' ';
    index = end - 1;
  }
  if (quote) quotedSpans.push({ start: quoteStart, end: characters.length });
  return { ...source, content: characters.join(''), css, quotedSpans };
}

function quotedAt(source: PreparedSource, index: number): boolean {
  return source.quotedSpans.some(span => span.start <= index && index <= span.end);
}

function declarations(source: PreparedSource): string[] {
  const names: string[] = [];
  // Dashed identifiers may begin with an underscore or contain uppercase letters.
  // Quoted JS object keys must close with the same quote; CSS quoted content is not a declaration.
  for (const match of source.content.matchAll(/(?:(['"])(--[\w-]+)\1|(--[\w-]+))\s*:/gu)) {
    if (source.css && quotedAt(source, match.index!)) continue;
    names.push(match[2] ?? match[3]!);
  }
  return names;
}

/** Collect source-declared names, including local private tokens, without scanning imports or inventing prefix owners. */
export function collectThemeTokenDeclarations(sources: readonly ThemeAuditSource[]): readonly string[] {
  return Object.freeze([...new Set(sources.flatMap(source => declarations(prepare(source))))].sort());
}

/**
 * Report mandatory unresolved variables, legacy paint references and literal-color
 * review candidates in supplied text. Findings are syntactic evidence, not proof
 * of a computed-style defect; imports/inline variables must be supplied explicitly.
 */
export function auditThemeTokenUsage(sources: readonly ThemeAuditSource[], options: ThemeAuditOptions = {}): readonly ThemeAuditFinding[] {
  const known = new Set([...Object.keys(createThemeDeclarations()), ...RUNTIME_NAMES, ...(options.externalTokens ?? [])]);
  const clean = sources.map(prepare);
  for (const source of clean) for (const name of declarations(source)) known.add(name);
  const findings: ThemeAuditFinding[] = [];
  for (const source of clean) {
    const add = (index: number, finding: Omit<ThemeAuditFinding, 'source' | 'line'>) => findings.push(Object.freeze({
      source: source.name, line: source.content.slice(0, index).split('\n').length, ...finding,
    }));
    // CSS function names are case-insensitive; custom property names remain case-sensitive.
    for (const match of source.content.matchAll(/\bvar\(\s*(--[\w-]+)\s*([,)])/giu)) {
      if (source.css && quotedAt(source, match.index!)) continue;
      const token = match[1]!, fallback = match[2] === ',';
      if (!known.has(token) && !fallback && !RUNTIME_PREFIXES.some(prefix => token.startsWith(prefix)))
        add(match.index!, { kind: 'unresolved-reference', token, detail: 'No declaration or documented runtime owner in the supplied source set.' });
      else if (options.reportLegacyReferences !== false && Object.hasOwn(THEME_COMPATIBILITY_ALIASES, token))
        add(match.index!, { kind: 'legacy-reference', token, detail: 'Compatible paint alias; direct role adoption remains reviewable.' });
    }
    if (options.reportLiteralColors !== false) for (const match of source.content.matchAll(/#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b|\brgba?\(\s*\d[^)]*\)/giu)) {
      if (source.css && quotedAt(source, match.index!)) continue;
      add(match.index!, { kind: 'literal-color', detail: `Review deliberate palette, scrim or decorative paint before replacing ${match[0]}.` });
    }
  }
  return Object.freeze(findings);
}
