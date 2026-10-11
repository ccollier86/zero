/** Validates trusted theme declarations/reference graphs before serialization; no CSS engine or application bootstrap. */
import type { ThemeTokenMap } from './theme-types';

const TOKEN_NAME = /^--[a-z][a-z0-9-]*$/u;

function unquotedCss(value: string): string {
  let quote = '';
  return [...value].map(char => {
    if (quote) { if (char === quote) quote = ''; return ' '; }
    if (char === '"' || char === "'") { quote = char; return ' '; }
    return char;
  }).join('');
}

/** Extract referenced custom properties and whether a fallback is supplied; nested fallbacks are traversed. */
export function themeTokenReferences(value: string): readonly { name: string; fallback: boolean }[] {
  return [...unquotedCss(value).matchAll(/\bvar\(\s*(--[\w-]+)\s*([,)])/giu)].map(match => ({ name: match[1]!, fallback: match[2] === ',' }));
}

/** Reject declaration/style-tag injection; callers must still treat theme configuration as trusted app input. */
export function assertThemeTokenValue(name: string, value: unknown): asserts value is string {
  if (!TOKEN_NAME.test(name)) throw new TypeError(`Invalid theme token name: ${name}`);
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 ||
      /[{};<>\\\u0000-\u001f\u007f]|\/\*|\*\/|!\s*important|\burl\s*\(/iu.test(value))
    throw new TypeError(`Invalid theme token value: ${name}`);
  let depth = 0, quote = '';
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!;
    if (char === '\\') { index++; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth++;
    else if (char === ')' && --depth < 0) throw new TypeError(`Unbalanced theme token value: ${name}`);
  }
  if (depth || quote || value.endsWith('\\')) throw new TypeError(`Unbalanced theme token value: ${name}`);
  const syntax = unquotedCss(value);
  for (const match of syntax.matchAll(/\bvar\(/giu))
    if (!/^var\(\s*--[a-zA-Z_][\w-]*\s*[,)]/iu.test(syntax.slice(match.index)))
      throw new TypeError(`Malformed variable reference: ${name}`);
}

/** Validate missing no-fallback references and cycles, including cycles inside fallbacks, without resolving CSS expressions. */
export function assertThemeTokenGraph(tokens: ThemeTokenMap): void {
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(name: string): void {
    if (visiting.has(name)) throw new TypeError(`Cyclic theme token reference: ${name}`);
    if (visited.has(name)) return;
    visiting.add(name);
    assertThemeTokenValue(name, tokens[name]);
    for (const ref of themeTokenReferences(tokens[name]!)) {
      if (Object.hasOwn(tokens, ref.name)) visit(ref.name);
      else if (!ref.fallback) throw new TypeError(`Unresolved theme token reference: ${ref.name} in ${name}`);
    }
    visiting.delete(name); visited.add(name);
  }
  for (const name of Object.keys(tokens)) visit(name);
}

/** Return a validated immutable copy; unknown override roles cannot create accidental competing token families. */
export function applyThemeTokenOverrides(base: ThemeTokenMap, overrides: ThemeTokenMap = {}): ThemeTokenMap {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(overrides)))
    throw new TypeError('Theme overrides must be a plain token record.');
  const next = { ...base };
  for (const [name, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(base, name)) throw new TypeError(`Unknown theme token override: ${name}`);
    assertThemeTokenValue(name, value); next[name] = value;
  }
  assertThemeTokenGraph(next);
  return Object.freeze(next);
}
