/**
 * Read-only filesystem adapter for backing-theme Doctor. Reads its own bundled
 * CSS plus admitted application text/relative CSS imports; never evaluates app
 * modules, package configuration, .env, Tailwind, fonts, databases or services.
 */
import { dirname, isAbsolute, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { checkSourceOnlyThemeFoundation, type SourceOnlyThemeCheckResult } from './source-only-theme-checks';
import { sourceOnlyBlockedPath, sourceOnlyInside, sourceOnlyRealpath } from './source-only-package';
import type { SourceOnlyDoctorOptions, SourceOnlyFile } from './source-only-types';
import type { ThemeAuditSource } from '../design-system/theme-types';
import type { PlatformDoctorFinding } from './platform-doctor-contracts';
import { DEFAULT_EXCLUDES, matchesPathPattern, normalizePath } from './usage-audit-scanner';

const MAX_SOURCE_BYTES = 2_000_000;
const MAX_CSS_IMPORTS = 512;
const copiedStylePaths = ['frontend/styles/theme-next.css', 'src/frontend/styles/theme-next.css'];

async function boundedRead(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path);
    if (!await file.exists() || file.size > MAX_SOURCE_BYTES) return null;
    return await file.text();
  } catch { return null; }
}

/** Read only the Doctor package's owned asset; a symlink escaping that package is not trusted. */
async function bundledRead(path: string, packageRoot: string): Promise<string | null> {
  try {
    const canonical = sourceOnlyRealpath(path);
    return /\.css$/iu.test(canonical) && sourceOnlyInside(packageRoot, canonical) ? await boundedRead(canonical) : null;
  } catch { return null; }
}

/** Decode literal CSS escapes only; filesystem admission still owns every resulting path. */
function cssLiteral(value: string): string | null {
  const decoded = value.replace(/\\([\da-f]{1,6})(?:\r\n|[\t\n\r\f ])?|\\([^\n\r\f])|\\(?:\r\n|[\n\r\f])/giu,
    (_match, hexadecimal: string | undefined, character: string | undefined) => {
      if (hexadecimal) { const point = Number.parseInt(hexadecimal, 16); return point === 0 || point > 0x10ffff || point >= 0xd800 && point <= 0xdfff ? '\ufffd' : String.fromCodePoint(point); }
      return character ?? '';
    });
  return decoded.includes('\u0000') || decoded.includes('\ufffd') ? null : decoded;
}

function cssString(source: string, start: number): { target: string; end: number } | null {
  const quote = source[start];
  let raw = '';
  for (let index = start + 1; index < source.length; index++) {
    const character = source[index]!;
    if (character === quote) { const target = cssLiteral(raw); return target === null ? null : { target, end: index + 1 }; }
    if (character === '\\') {
      raw += character;
      if (index + 1 < source.length) {
        raw += source[++index];
        if (source[index] === '\r' && source[index + 1] === '\n') raw += source[++index];
      }
      continue;
    }
    if (character === '\n' || character === '\r' || character === '\f') return null;
    raw += character;
  }
  return null;
}

function cssWhitespace(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    if (/[\t\n\r\f ]/u.test(source[index]!)) { index++; continue; }
    if (source[index] === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end === -1) return source.length;
      index = end + 2; continue;
    }
    break;
  }
  return index;
}

/** A CSS url token may contain escaped spaces, but never unescaped internal whitespace. */
function cssUnquotedUrl(source: string, start: number): { target: string; end: number } | null {
  let index = start;
  for (; index < source.length; index++) {
    const character = source[index]!;
    if (character === ')') {
      const target = cssLiteral(source.slice(start, index));
      return target === null ? null : { target, end: index + 1 };
    }
    if (/[\t\n\r\f ]/u.test(character)) {
      const end = cssWhitespace(source, index);
      if (source[end] !== ')') return null;
      const target = cssLiteral(source.slice(start, index));
      return target === null ? null : { target, end: end + 1 };
    }
    if (character === '\\') {
      if (index + 1 >= source.length || /[\n\r\f]/u.test(source[index + 1]!)) return null;
      const hexadecimal = /^[\da-f]{1,6}(?:\r\n|[\t\n\r\f ])?/iu.exec(source.slice(index + 1));
      index += hexadecimal ? hexadecimal[0].length : 1;
      continue;
    }
    if (character === '"' || character === "'" || character === '(' || /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/u.test(character)) return null;
  }
  return null;
}

/** Only actual @import tokens outside comments/strings supply CSS dependencies. */
function importsFromCss(source: string): { target: string; line: number }[] {
  const imports: { target: string; line: number }[] = [];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2); if (end === -1) break; index = end + 1; continue;
    }
    if (source[index] === '"' || source[index] === "'") { const value = cssString(source, index); if (value) index = value.end - 1; continue; }
    if (source[index] !== '@') continue;
    const keyword = /^@import(?![\w-])/iu.exec(source.slice(index));
    if (!keyword) continue;
    let cursor = cssWhitespace(source, index + keyword[0].length);
    let value: { target: string; end: number } | null = null;
    if (source[cursor] === '"' || source[cursor] === "'") value = cssString(source, cursor);
    else {
      const url = /^url\(\s*/iu.exec(source.slice(cursor));
      if (url) {
        cursor += url[0].length;
        if (source[cursor] === '"' || source[cursor] === "'") {
          const quoted = cssString(source, cursor);
          const end = quoted && cssWhitespace(source, quoted.end);
          if (quoted && end !== null && source[end] === ')') value = { target: quoted.target, end: end + 1 };
        } else value = cssUnquotedUrl(source, cursor);
      }
    }
    if (value) { imports.push({ target: value.target, line: source.slice(0, index).split('\n').length }); index = value.end - 1; }
  }
  return imports;
}

function cssImports(source: ThemeAuditSource): { target: string; line: number }[] {
  if (/\.css$/iu.test(source.name)) return importsFromCss(source.content);
  const file = ts.createSourceFile(source.name, source.content, ts.ScriptTarget.Latest, true);
  return file.statements.flatMap(statement => {
    if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier
      || !ts.isStringLiteralLike(statement.moduleSpecifier) || !/\.css(?:[?#].*)?$/iu.test(statement.moduleSpecifier.text)) return [];
    return [{ target: statement.moduleSpecifier.text, line: file.getLineAndCharacterOfPosition(statement.moduleSpecifier.getStart(file)).line + 1 }];
  });
}

/** Inspect backing source without broadening configured scan roots to arbitrary filesystem paths. */
export async function inspectSourceOnlyThemeFoundation(projectRoot: string, files: readonly SourceOnlyFile[],
  options: Pick<SourceOnlyDoctorOptions, 'include' | 'exclude'> = {}): Promise<SourceOnlyThemeCheckResult> {
  const findings: PlatformDoctorFinding[] = [];
  const packageRoot = sourceOnlyRealpath(fileURLToPath(new URL('../../', import.meta.url)));
  const ownSupplement = fileURLToPath(new URL('../frontend/styles/', import.meta.url));
  const [bundledStyles, bundledLegacyStyles] = await Promise.all([
    bundledRead(resolve(ownSupplement, 'theme-next.css'), packageRoot),
    bundledRead(resolve(ownSupplement, 'globals.css'), packageRoot),
  ]);
  const sources = new Map<string, ThemeAuditSource>();
  for (const file of files) {
    try { sources.set(sourceOnlyRealpath(resolve(projectRoot, file.path)), { name: file.path, content: file.source }); }
    catch { findings.push(readFailure(file.path, 1)); }
  }
  const fences = [projectRoot];
  for (const input of options.include ?? []) {
    try { fences.push(sourceOnlyRealpath(isAbsolute(input) ? input : resolve(projectRoot, input))); } catch { /* Missing explicit roots are already reported by discovery. */ }
  }
  const copiedStyles: ThemeAuditSource[] = [];
  const excluded = (name: string) => sourceOnlyBlockedPath(name)
    || [...DEFAULT_EXCLUDES, ...(options.exclude ?? [])].some(pattern => matchesPathPattern(name, normalizePath(pattern)));
  for (const local of copiedStylePaths) {
    if (excluded(local)) continue;
    const path = resolve(projectRoot, local);
    if (!await Bun.file(path).exists()) continue;
    try {
      const canonical = sourceOnlyRealpath(path);
      if (!sourceOnlyInside(projectRoot, canonical)) {
        findings.push({ severity: 'error', code: 'usage.source.outside_root', path: `${local}:1`, line: 1,
          category: 'required', confidence: 'high', message: 'A copied theme stylesheet symlink leaves the explicitly admitted project root; it was not read.' });
        continue;
      }
      if (!/\.css$/iu.test(canonical) || excluded(normalize(relative(projectRoot, canonical)).replaceAll('\\', '/'))) continue;
      const content = await boundedRead(canonical);
      if (content === null) { findings.push(readFailure(local, 1)); continue; }
      // The framework workspace's own generated asset is checked as a package
      // asset, not misclassified as application-owned customization.
      if (canonical !== resolve(ownSupplement, 'theme-next.css')) copiedStyles.push({ name: local, content });
      sources.set(canonical, { name: local, content });
    } catch { findings.push(readFailure(local, 1)); }
  }
  const queue = [...sources.entries()];
  const attempted = new Set<string>();
  let limitReported = false;
  for (let index = 0; index < queue.length; index++) {
    const [path, source] = queue[index]!;
    let imports: ReturnType<typeof cssImports>;
    try { imports = cssImports(source); }
    catch { findings.push(readFailure(source.name, 1, true)); continue; }
    for (const item of imports) {
      if (!item.target.startsWith('.') || !/\.css(?:[?#].*)?$/iu.test(item.target)) continue;
      const target = resolve(dirname(path), item.target.split(/[?#]/u)[0]!);
      if (excluded(normalize(relative(projectRoot, target)).replaceAll('\\', '/'))) continue;
      if (attempted.has(target)) continue;
      attempted.add(target);
      if (attempted.size > MAX_CSS_IMPORTS) {
        if (!limitReported) findings.push({ severity: 'warning', code: 'theme.foundation.import_limit', path: `${source.name}:${item.line}`, line: item.line,
          category: 'manual-review', confidence: 'high', message: 'The bounded CSS import inspection limit was reached; declaration coverage is incomplete.' });
        limitReported = true;
        break;
      }
      try {
        const canonical = sourceOnlyRealpath(target);
        if (!fences.some(fence => sourceOnlyInside(fence, canonical))) {
          findings.push({ severity: 'error', code: 'usage.source.outside_root', path: `${source.name}:${item.line}`, line: item.line,
            category: 'required', confidence: 'high', message: 'A CSS import leaves every explicitly admitted source root; it was not read.' });
          continue;
        }
        if (sources.has(canonical)) continue;
        const name = normalize(relative(projectRoot, canonical)).replaceAll('\\', '/');
        if (!/\.css$/iu.test(canonical) || excluded(name)) continue;
        const content = await boundedRead(canonical);
        if (content === null) { findings.push(readFailure(source.name, item.line)); continue; }
        const next = { name, content };
        sources.set(canonical, next); queue.push([canonical, next]);
      } catch { findings.push(readFailure(source.name, item.line)); }
    }
  }
  const inspected = [...sources.values()].filter(source => !copiedStylePaths.includes(source.name));
  const result = checkSourceOnlyThemeFoundation({ bundledStyles, bundledLegacyStyles, sources: inspected, copiedStyles });
  return Object.freeze({ findings: Object.freeze([...findings, ...result.findings]), summary: result.summary });
}

function readFailure(path: string, line: number, parserLimit = false): PlatformDoctorFinding {
  return { severity: 'warning', code: 'theme.foundation.source_unavailable', path: `${path}:${line}`, line,
    category: 'manual-review', confidence: 'high', message: parserLimit
      ? 'A theme source could not be inspected within parser limits; declaration coverage is incomplete.'
      : 'A theme source/import could not be read within the size limit; declaration coverage is incomplete.',
    hint: 'Review the admitted local source path. Doctor does not execute imports or print source contents.' };
}
