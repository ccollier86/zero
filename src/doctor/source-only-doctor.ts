/**
 * Source-only Doctor orchestration. Uses Bun filesystem reads/globs and a
 * TypeScript AST; it never discovers/imports config, reads .env, initializes
 * plugins/services or inspects databases. An explicit root owns every read.
 */
import { statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { PlatformDoctorFinding } from './platform-doctor-contracts';
import { checkSourceOnlyModals } from './source-only-modal-checks';
import { inspectSourceOnlyPackage, sourceOnlyInside, sourceOnlyRealpath } from './source-only-package';
import type { SourceOnlyDoctorOptions, SourceOnlyDoctorReport, SourceOnlyFile } from './source-only-types';
import { DEFAULT_EXCLUDES, matchesPathPattern, normalizePath } from './usage-audit-scanner';

const defaultRoots = ['app', 'src', 'components', 'hooks', 'lib', 'server'];
const blocked = new Set(['.git', '.zero', '.build', '.storage', '.cache', '.next', '.turbo', 'coverage', 'dist', 'node_modules']);

/** Audit literal source contracts without loading application configuration or ambient files. */
export async function runSourceOnlyDoctor(options: SourceOnlyDoctorOptions): Promise<SourceOnlyDoctorReport> {
  const findings: PlatformDoctorFinding[] = [];
  const unavailable = { status: 'unavailable' as const, version: null, publicExports: [], modalShow: null };
  let root: string;
  try {
    if (!options || typeof options.projectRoot !== 'string' || !options.projectRoot.trim()) throw new Error();
    root = sourceOnlyRealpath(resolve(options.projectRoot));
    if (!statSync(root).isDirectory()) throw new Error();
  } catch {
    return { mode: 'source-only', ok: false, scannedFiles: 0, installedFramework: unavailable, findings: [{ severity: 'error', code: 'usage.source.root_invalid',
      path: 'projectRoot', category: 'required', confidence: 'high', message: 'An existing explicit application directory is required for source-only inspection.' }] };
  }
  const installed = await inspectSourceOnlyPackage(root);
  if (installed.status === 'missing' || installed.status === 'unavailable' || installed.modalShow === null) findings.push({ severity: 'info',
    code: 'usage.source.package_unknown', path: 'node_modules/@zero/framework/package.json', category: 'manual-review', confidence: 'high',
    message: 'Installed framework metadata or structured modal capability could not be established. No newer facade is assumed available.',
    hint: 'Install the intended package or select the actual app/workspace root before following version-dependent migration advice.' });
  const files = await discover(root, options, findings);
  for (const file of files) {
    const lineCount = file.source.split(/\r?\n/u).length;
    if (lineCount > (options.maxFileLines ?? 400)) findings.push({ severity: 'warning', code: 'usage.structure.large_file', path: `${file.path}:1`, line: 1,
      category: 'recommended', confidence: 'high', message: 'This source file exceeds the configured responsibility-size threshold.', hint: 'Review responsibility boundaries; size alone does not prove a defect.' });
    findings.push(...checkSourceOnlyModals(file, installed));
  }
  const admitted = findings.filter(finding => {
    if (finding.code === 'usage.source.root_invalid' || finding.code === 'usage.source.outside_root') return true;
    const configured = options.rules?.[finding.code];
    if (configured === 'off') return false;
    if (configured) finding.severity = configured;
    return !options.allow?.some(entry => entry.code === finding.code && matchesPathPattern((finding.path ?? '').replace(/:\d+$/u, ''), normalizePath(entry.path)));
  });
  return { mode: 'source-only', findings: admitted, ok: !admitted.some(finding => finding.severity === 'error' || (options.strict && finding.severity === 'warning')),
    scannedFiles: files.length, installedFramework: { status: installed.status, version: installed.version, publicExports: installed.publicExports, modalShow: installed.modalShow } };
}

async function discover(root: string, options: SourceOnlyDoctorOptions, findings: PlatformDoctorFinding[]): Promise<SourceOnlyFile[]> {
  const exclusions = [...DEFAULT_EXCLUDES, ...(options.exclude ?? [])];
  const files = new Map<string, SourceOnlyFile>();
  const roots = options.include?.length ? options.include : defaultRoots;
  const excluded = (path: string) => path.split('/').some(segment => blocked.has(segment)) || exclusions.some(pattern => matchesPathPattern(path, normalizePath(pattern)));
  async function read(path: string, fence: string, explicitFile = false) {
    const label = normalizePath(relative(root, path));
    if (!/\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/u.test(label) || excluded(label)) return;
    try {
      const canonical = sourceOnlyRealpath(path);
      if ((!explicitFile && !sourceOnlyInside(fence, canonical)) || (explicitFile && canonical !== fence)) {
        findings.push({ severity: 'error', code: 'usage.source.outside_root', path: label, category: 'required', confidence: 'high',
          message: 'A source symlink leaves its explicitly admitted scan root; that source was not read.' }); return;
      }
      if (files.has(canonical)) return;
      const file = Bun.file(canonical);
      if (file.size > 2_000_000) {
        findings.push({ severity: 'warning', code: 'usage.source.file_too_large', path: label, category: 'manual-review', confidence: 'high', message: 'Source larger than 2 MB was skipped; inspection coverage is incomplete.' }); return;
      }
      files.set(canonical, { path: label, source: await file.text() });
    } catch { findings.push({ severity: 'warning', code: 'usage.source.read_failed', path: label, category: 'manual-review', confidence: 'high', message: 'Source could not be read; inspection coverage is incomplete.' }); }
  }
  for (const input of roots) {
    const path = isAbsolute(input) ? input : resolve(root, input);
    let fence: string;
    try { fence = sourceOnlyRealpath(path); } catch { continue; }
    try {
      if (statSync(fence).isFile()) { await read(path, fence, true); continue; }
      if (!statSync(fence).isDirectory()) continue;
      const glob = new Bun.Glob('**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}');
      for await (const entry of glob.scan({ cwd: fence, absolute: true, dot: true, onlyFiles: true, followSymlinks: false })) await read(entry, fence);
    } catch { findings.push({ severity: 'warning', code: 'usage.source.scan_failed', path: normalizePath(relative(root, path)), category: 'manual-review', confidence: 'high', message: 'An admitted source root could not be scanned; inspection coverage is incomplete.' }); }
  }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}
