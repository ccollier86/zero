/**
 * Read-only upgrade asset inspection. Parses literal CSS/module references and
 * probes only explicitly admitted source roots; never evaluates app imports,
 * config/resolvers, environment, provenance or runtime/private file contents.
 */
import { lstat, readlink } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { sourceOnlyBlockedPath, sourceOnlyInside, sourceOnlyRealpath } from './source-only-package';
import type { SourceOnlyDoctorOptions, SourceOnlyFile } from './source-only-types';
import type { PlatformDoctorFinding } from './platform-doctor-contracts';
import { DEFAULT_EXCLUDES, matchesPathPattern, normalizePath } from './usage-audit-scanner';

const DEFAULT_ROOTS = ['app', 'src', 'components', 'hooks', 'lib', 'server'];
const MAX_SOURCE_BYTES = 2_000_000, MAX_TOTAL_BYTES = 16_000_000, MAX_SOURCES = 256;
const MAX_REFERENCES = 512, MAX_METADATA_PROBES = 4096, MAX_LINKS = 40;
const SOURCE_EXTENSION = /\.(?:css|ts|tsx|js|jsx|mts|cts|mjs|cjs)$/iu;

/** Counts describe definite/uncertain literal references, not compiled or visual correctness. */
export interface SourceOnlyUpgradeAssetResult {
  readonly findings: readonly PlatformDoctorFinding[];
  readonly checkedAssets: number;
  readonly reviewAssets: number;
}
type Reference = { target: string; line: number; uncertain?: boolean };
type Fence = { lexical: string; canonical: string; file: boolean; stats: Stats };
type Probe = { kind: 'present'; path: string; stats: Stats } | { kind: 'absent' | 'blocked' | 'review' | 'limit' };

/** Literal CSS escapes do not authorize their decoded path to leave its source fence. */
function cssLiteral(value: string): string | null {
  const decoded = value.replace(/\\([\da-f]{1,6})(?:\r\n|[\t\n\r\f ])?|\\([^\n\r\f])|\\(?:\r\n|[\n\r\f])/giu,
    (_match, hexadecimal: string | undefined, character: string | undefined) => {
      if (hexadecimal) { const point = Number.parseInt(hexadecimal, 16); return point === 0 || point > 0x10ffff || point >= 0xd800 && point <= 0xdfff ? '\ufffd' : String.fromCodePoint(point); }
      return character ?? '';
    });
  return decoded.includes('\u0000') || decoded.includes('\ufffd') ? null : decoded;
}
function cssString(source: string, start: number): { target: string; end: number } | null {
  const quote = source[start]; let raw = '';
  for (let index = start + 1; index < source.length; index++) {
    const character = source[index]!;
    if (character === quote) { const target = cssLiteral(raw); return target === null ? null : { target, end: index + 1 }; }
    if (character === '\\') {
      raw += character;
      if (index + 1 < source.length) { raw += source[++index]; if (source[index] === '\r' && source[index + 1] === '\n') raw += source[++index]; }
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
    if (source[index] === '/' && source[index + 1] === '*') { const end = source.indexOf('*/', index + 2); if (end === -1) return source.length; index = end + 2; continue; }
    break;
  }
  return index;
}
function cssUnquotedUrl(source: string, start: number): { target: string; end: number } | null {
  for (let index = start; index < source.length; index++) {
    const character = source[index]!;
    if (character === ')') { const target = cssLiteral(source.slice(start, index)); return target === null ? null : { target, end: index + 1 }; }
    if (/[\t\n\r\f ]/u.test(character)) {
      const end = cssWhitespace(source, index); if (source[end] !== ')') return null;
      const target = cssLiteral(source.slice(start, index)); return target === null ? null : { target, end: end + 1 };
    }
    if (character === '\\') {
      if (index + 1 >= source.length || /[\n\r\f]/u.test(source[index + 1]!)) return null;
      const hexadecimal = /^[\da-f]{1,6}(?:\r\n|[\t\n\r\f ])?/iu.exec(source.slice(index + 1));
      index += hexadecimal ? hexadecimal[0].length : 1; continue;
    }
    if (character === '"' || character === "'" || character === '(' || /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/u.test(character)) return null;
  }
  return null;
}

/** Collect actual top-level CSS @imports, ignoring comments, quoted data and nested custom-property tokens. */
export function collectSourceOnlyCssImports(source: string): Reference[] {
  const references: Reference[] = []; let braces = 0, parentheses = 0;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '/' && source[index + 1] === '*') { const end = source.indexOf('*/', index + 2); if (end === -1) break; index = end + 1; continue; }
    if (character === '"' || character === "'") { const value = cssString(source, index); if (!value) break; index = value.end - 1; continue; }
    if (character === '{') { braces++; continue; } if (character === '}') { braces = Math.max(0, braces - 1); continue; }
    if (character === '(') { parentheses++; continue; } if (character === ')') { parentheses = Math.max(0, parentheses - 1); continue; }
    if (character !== '@' || braces || parentheses) continue;
    const keyword = /^@import(?![\w-])/iu.exec(source.slice(index)); if (!keyword) continue;
    let cursor = cssWhitespace(source, index + keyword[0].length), value: { target: string; end: number } | null = null;
    if (source[cursor] === '"' || source[cursor] === "'") value = cssString(source, cursor);
    else {
      const url = /^url\(/iu.exec(source.slice(cursor));
      if (url) {
        cursor = cssWhitespace(source, cursor + url[0].length);
        if (source[cursor] === '"' || source[cursor] === "'") {
          const quoted = cssString(source, cursor), end = quoted && cssWhitespace(source, quoted.end);
          if (quoted && end !== null && source[end] === ')') value = { target: quoted.target, end: end + 1 };
        } else value = cssUnquotedUrl(source, cursor);
      }
    }
    if (value) { references.push({ target: value.target, line: source.slice(0, index).split('\n').length }); index = value.end - 1;
      if (references.length > MAX_REFERENCES) break; }
  }
  return references;
}

function referencesFromSource(file: SourceOnlyFile): Reference[] {
  if (/\.css$/iu.test(file.path)) return collectSourceOnlyCssImports(file.source);
  const parsed = ts.createSourceFile(file.path, file.source, ts.ScriptTarget.Latest, true), references: Reference[] = [];
  const add = (node: ts.StringLiteralLike, uncertain = false) => {
    const spelling = node.getText(parsed), delimiter = spelling[0];
    references.push({ target: node.text, line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1,
      uncertain: uncertain || !["'", '"', '`'].includes(delimiter ?? '') || spelling.at(-1) !== delimiter });
  };
  const queue: ts.Node[] = [parsed];
  while (queue.length && references.length <= MAX_REFERENCES) {
    const node = queue.pop()!;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) add(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) add(node.moduleReference.expression);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) add(node.argument.literal);
    else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]!)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      // An arbitrary function named require is not proven to be the application's module resolver.
      add(node.arguments[0]!, node.expression.kind !== ts.SyntaxKind.ImportKeyword);
    }
    const children: ts.Node[] = [];
    ts.forEachChild(node, child => { children.push(child); });
    for (let index = children.length - 1; index >= 0; index--) queue.push(children[index]!);
  }
  return references;
}

function resolutions(path: string): string[] | null {
  const extension = extname(path).toLowerCase(), base = path.slice(0, -extension.length);
  if (extension === '.js') return [`${base}.ts`, `${base}.tsx`, path, `${base}.jsx`];
  if (extension === '.jsx') return [`${base}.tsx`, path];
  if (extension === '.mjs') return [`${base}.mts`, path];
  if (extension === '.cjs') return [`${base}.cts`, path];
  return ['.css', '.ts', '.tsx', '.mts', '.cts'].includes(extension) ? [path] : null;
}
function finding(source: SourceOnlyFile, line: number, kind: 'missing' | 'resolution_review' | 'scan_limit'): PlatformDoctorFinding {
  return { code: `upgrade.assets.${kind}`, severity: kind === 'missing' ? 'error' : 'warning',
    category: kind === 'missing' ? 'required' : 'manual-review', confidence: 'high', path: `${source.path}:${line}`, line,
    message: kind === 'missing' ? 'A literal local CSS/helper reference has no supported file target inside the admitted source roots.'
      : kind === 'scan_limit' ? 'The bounded upgrade asset inspection limit was reached; dependency coverage is incomplete.'
      : 'A referenced asset cannot be established with the admitted roots and static literal resolver; manual review is required.',
    hint: kind === 'missing' ? 'Restore the intended local dependency or review the application-specific resolver. Doctor never overwrites customized copies.'
      : 'Review the literal reference and explicitly admit its source root if appropriate. Doctor never loads application configuration, resolves virtual imports or prints source contents.' };
}

/** Inspect admitted relative CSS/helper references without importing configuration, evaluating code or changing files. */
export async function inspectSourceOnlyUpgradeAssets(projectRoot: string, files: readonly SourceOnlyFile[],
  options: Pick<SourceOnlyDoctorOptions, 'include' | 'exclude'> = {}): Promise<SourceOnlyUpgradeAssetResult> {
  const findings: PlatformDoctorFinding[] = [], fences: Fence[] = [];
  let checkedAssets = 0, reviewAssets = 0, probes = 0, bytes = 0, limitReported = false;
  const root = resolve(projectRoot), exclusions = [...DEFAULT_EXCLUDES, ...(options.exclude ?? [])];
  const label = (path: string) => normalizePath(relative(root, path));
  const excluded = (path: string) => sourceOnlyBlockedPath(path) || exclusions.some(pattern => matchesPathPattern(label(path), normalizePath(pattern)));
  const finish = () => Object.freeze({ findings: Object.freeze(findings), checkedAssets, reviewAssets });
  const inputs = options.include?.length ? options.include : DEFAULT_ROOTS;
  if (inputs.length > MAX_SOURCES || files.length > MAX_SOURCES) {
    findings.push(finding({ path: 'projectRoot', source: '' }, 1, 'scan_limit')); limitReported = true;
  }
  for (const input of inputs.slice(0, MAX_SOURCES)) {
    const lexical = isAbsolute(input) ? resolve(input) : resolve(root, input);
    if (excluded(lexical)) continue;
    try {
      const canonical = sourceOnlyRealpath(lexical); if (excluded(canonical)) continue;
      const stats = await lstat(canonical);
      if (stats.isFile() || stats.isDirectory()) fences.push({ lexical, canonical, file: stats.isFile(), stats });
    } catch { /* Root discovery already owns missing/unreadable explicit roots. */ }
  }
  const matchFence = (path: string) => fences.flatMap(fence => [fence.lexical, fence.canonical].map(base => ({ fence, base })))
    .filter(({ fence, base }) => fence.file ? path === base : sourceOnlyInside(base, path)).sort((a, b) => b.base.length - a.base.length)[0];
  const metadata = new Map<string, Promise<Stats | 'absent' | 'review' | 'limit'>>();
  const inspectMetadata = (path: string) => {
    let inspected = metadata.get(path); if (inspected) return inspected;
    inspected = ++probes > MAX_METADATA_PROBES ? Promise.resolve('limit' as const) : lstat(path)
      .catch((error: unknown) => (error as { code?: string })?.code === 'ENOENT' ? 'absent' as const : 'review' as const);
    metadata.set(path, inspected); return inspected;
  };
  const walk = async (path: string, links = 0): Promise<Probe> => {
    if (excluded(path)) return { kind: 'blocked' };
    if (links > MAX_LINKS) return { kind: 'review' };
    const owner = matchFence(path); if (!owner) return { kind: 'review' };
    const parts = relative(owner.base, path).split(sep).filter(Boolean);
    let current = owner.fence.canonical, stats = owner.fence.stats;
    for (let index = 0; index < parts.length; index++) {
      if (!stats.isDirectory()) return { kind: 'review' };
      current = resolve(current, parts[index]!);
      if (excluded(current)) return { kind: 'blocked' };
      if (!matchFence(current)) return { kind: 'review' };
      const next = await inspectMetadata(current);
      if (typeof next === 'string') return { kind: next };
      stats = next;
      if (stats.isSymbolicLink()) {
        try {
          const target = resolve(dirname(current), await readlink(current), ...parts.slice(index + 1));
          // Admission happens before any metadata/content probe at a symlink destination.
          return await walk(target, links + 1);
        } catch { return { kind: 'review' }; }
      }
    }
    return stats.isFile() && SOURCE_EXTENSION.test(current) ? { kind: 'present', path: current, stats } : { kind: 'review' };
  };
  const reportLimit = (source: SourceOnlyFile, line: number) => { if (!limitReported) findings.push(finding(source, line, 'scan_limit')); limitReported = true; };
  const sources = new Map<string, SourceOnlyFile>(), queue: Array<{ path: string; file: SourceOnlyFile }> = [];
  const enqueue = (path: string, file: SourceOnlyFile) => {
    if (sources.has(path)) return;
    const size = Buffer.byteLength(file.source);
    if (size > MAX_SOURCE_BYTES || bytes + size > MAX_TOTAL_BYTES || sources.size >= MAX_SOURCES) { reportLimit(file, 1); return; }
    bytes += size; sources.set(path, file); queue.push({ path, file });
  };
  for (const file of files.slice(0, MAX_SOURCES)) {
    if (!SOURCE_EXTENSION.test(file.path)) continue;
    const source = await walk(resolve(root, file.path));
    if (source.kind === 'present') enqueue(source.path, file);
    else if (source.kind === 'limit') reportLimit(file, 1);
    else if (source.kind === 'review') findings.push(finding(file, 1, 'resolution_review'));
  }
  const seen = new Set<string>(), targets = new Map<string, Promise<Probe>>();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { path, file } = queue[cursor]!;
    let references: Reference[];
    try { references = referencesFromSource(file); }
    catch { reportLimit(file, 1); continue; } // Parser exhaustion cannot establish absent dependencies.
    for (const reference of references) {
      const plain = reference.target.split(/[?#]/u)[0]!;
      if (sourceOnlyBlockedPath(plain)) continue;
      if (/^(?:https?:|data:|node:)/iu.test(reference.target)) continue;
      const relativeReference = /^(?:\.\.?)[/\\]/u.test(reference.target);
      const uncertainSpecifier = /^(?:#|@\/|~|virtual:|\/)/u.test(reference.target);
      if (!relativeReference && !uncertainSpecifier) continue; // Ordinary package imports belong to the existing public-export checker.
      const key = `${path}\u0000${reference.target}`; if (seen.has(key)) continue;
      if (seen.size >= MAX_REFERENCES) { reportLimit(file, reference.line); break; } seen.add(key);
      const target = relativeReference ? resolve(dirname(path), plain) : null;
      if (target && excluded(target)) continue;
      // Backslashes in module/CSS literals require application-specific interpretation;
      // do not reinterpret a Unix filename or a custom Windows-style resolver as proof.
      const candidates = target && !reference.uncertain && !/[\\?#\u0000]/u.test(reference.target) ? resolutions(target) : null;
      if (!candidates || !target || !matchFence(target)) { reviewAssets++; findings.push(finding(file, reference.line, 'resolution_review')); continue; }
      let present: Extract<Probe, { kind: 'present' }> | undefined, uncertain = false, blocked = false, limited = false;
      for (const candidate of candidates) {
        let result = targets.get(candidate); if (!result) { result = walk(candidate); targets.set(candidate, result); }
        const probed = await result;
        if (probed.kind === 'present') { present = probed; break; }
        if (probed.kind === 'review') uncertain = true;
        if (probed.kind === 'blocked') blocked = true;
        if (probed.kind === 'limit') limited = true;
      }
      if (present) {
        checkedAssets++;
        if (sources.has(present.path)) continue;
        if (present.stats.size > MAX_SOURCE_BYTES || bytes + present.stats.size > MAX_TOTAL_BYTES || sources.size >= MAX_SOURCES) { reportLimit(file, reference.line); continue; }
        try {
          // A source growing after metadata inspection still cannot cause an unbounded content read.
          const budget = Math.min(MAX_SOURCE_BYTES, MAX_TOTAL_BYTES - bytes);
          const content = await Bun.file(present.path).slice(0, budget + 1).text();
          if (Buffer.byteLength(content) > budget) { reportLimit(file, reference.line); continue; }
          enqueue(present.path, { path: label(present.path), source: content });
        }
        catch { reviewAssets++; findings.push(finding(file, reference.line, 'resolution_review')); }
      } else if (limited) { reviewAssets++; reportLimit(file, reference.line); }
      else if (blocked) { /* Private/excluded alternatives never become guessed missing-asset findings. */ }
      else if (uncertain) { reviewAssets++; findings.push(finding(file, reference.line, 'resolution_review')); }
      else { checkedAssets++; findings.push(finding(file, reference.line, 'missing')); }
    }
  }
  return finish();
}
