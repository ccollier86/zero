/**
 * Source-only Doctor orchestration. Uses Bun filesystem reads/globs and a
 * TypeScript AST; it never discovers/imports config, reads .env, initializes
 * plugins/services or inspects databases. An explicit root owns every read.
 */
import { statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { PlatformDoctorFinding } from './platform-doctor-contracts';
import { checkSourceOnlyModals } from './source-only-modal-checks';
import { checkSourceOnlyLogging } from './source-only-logging-checks';
import { checkSourceOnlyCharts } from './source-only-chart-checks';
import { checkSourceOnlyUpgradeUsage } from './source-only-upgrade-checks';
import { inspectSourceOnlyUpgradeAssets } from './source-only-upgrade-assets';
import { getSourceOnlyUpgradeCatalog, SOURCE_ONLY_UPGRADE_CATALOG_VERSION } from './source-only-upgrade-catalog';
import { inspectSourceOnlyUpgradeTarget } from './source-only-upgrade-target';
import { inspectSourceOnlyThemeFoundation } from './source-only-theme-foundation';
import { inspectSourceOnlyPackage, sourceOnlyBlockedPath, sourceOnlyInside, sourceOnlyRealpath } from './source-only-package';
import type { SourceOnlyDoctorOptions, SourceOnlyDoctorReport, SourceOnlyFile } from './source-only-types';
import type { SourceOnlyUpgradeOption } from './source-only-upgrade-types';
import { DEFAULT_EXCLUDES, matchesPathPattern, normalizePath } from './usage-audit-scanner';

const defaultRoots = ['app', 'src', 'components', 'hooks', 'lib', 'server'];

/** Audit literal source contracts without loading application configuration or ambient files. */
export async function runSourceOnlyDoctor(options: SourceOnlyDoctorOptions): Promise<SourceOnlyDoctorReport> {
  const findings: PlatformDoctorFinding[] = [];
  const unavailable = { status: 'unavailable' as const, version: null, publicExports: [], modalShow: null };
  const themeFoundationRequested = options?.themeFoundation;
  // Snapshot untyped settings once before filesystem work. Reject hidden/symbol keys
  // and never echo arbitrary caller values or invoke an application resolver.
  let upgradeOption: SourceOnlyUpgradeOption | undefined;
  try {
    const upgradeRequested = options?.upgrade;
    if (upgradeRequested !== undefined && typeof upgradeRequested !== 'boolean') {
      if (!upgradeRequested || typeof upgradeRequested !== 'object' || Array.isArray(upgradeRequested)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(upgradeRequested))
        || Reflect.ownKeys(upgradeRequested).some(key => key !== 'targetRoot')) throw new Error();
      const targetRoot = upgradeRequested.targetRoot;
      if (targetRoot !== undefined && (typeof targetRoot !== 'string' || !targetRoot.trim())) throw new Error();
      upgradeOption = targetRoot === undefined ? {} : { targetRoot };
    } else upgradeOption = upgradeRequested;
  } catch {
    return { mode: 'source-only', ok: false, scannedFiles: 0, installedFramework: unavailable,
      findings: [{ severity: 'error', code: 'upgrade.option_invalid', path: 'upgrade', category: 'required', confidence: 'high',
        message: 'Source-only upgrade must be a boolean or an object containing only an optional nonempty targetRoot string.' }] };
  }
  if (themeFoundationRequested !== undefined && typeof themeFoundationRequested !== 'boolean') return {
    mode: 'source-only', ok: false, scannedFiles: 0, installedFramework: unavailable,
    findings: [{ severity: 'error', code: 'theme.foundation.option_invalid', path: 'themeFoundation', category: 'required', confidence: 'high',
      message: 'The optional source-only themeFoundation setting must be a boolean.' }],
  };
  const checkThemeFoundation = themeFoundationRequested === true;
  const checkUpgrade = upgradeOption !== undefined && upgradeOption !== false;
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
  const files = await discover(root, options, findings, checkThemeFoundation || checkUpgrade);
  for (const file of files) {
    if (/\.css$/iu.test(file.path)) continue;
    const lineCount = file.source.split(/\r?\n/u).length;
    if (lineCount > (options.maxFileLines ?? 400)) findings.push({ severity: 'warning', code: 'usage.structure.large_file', path: `${file.path}:1`, line: 1,
      category: 'recommended', confidence: 'high', message: 'This source file exceeds the configured responsibility-size threshold.', hint: 'Review responsibility boundaries; size alone does not prove a defect.' });
    if (!checkUpgrade) findings.push(...checkSourceOnlyModals(file, installed), ...checkSourceOnlyLogging(file));
    else {
      // Pathological generated syntax can exhaust the legacy AST parser/walker.
      // Keep the opt-in audit useful for other files without exposing source or
      // treating incomplete inspection as a proven migration requirement.
      try { findings.push(...checkSourceOnlyModals(file, installed), ...checkSourceOnlyLogging(file)); }
      catch { findings.push({ severity: 'warning', code: 'upgrade.source_incomplete', path: `${file.path}:1`, line: 1,
        category: 'manual-review', confidence: 'high', message: 'This source could not be inspected within parser limits; upgrade coverage is incomplete.',
        hint: 'Review or explicitly exclude unsupported generated source before treating the audit as complete.' }); }
    }
  }
  const themeFoundation = checkThemeFoundation ? await inspectSourceOnlyThemeFoundation(root, files, options) : undefined;
  if (themeFoundation) findings.push(...themeFoundation.findings);
  const upgradeTarget = checkUpgrade ? await inspectSourceOnlyUpgradeTarget(root, upgradeOption!) : undefined;
  const upgradeUsage = upgradeTarget ? await checkSourceOnlyUpgradeUsage(files, upgradeTarget) : undefined;
  const chartUsage = upgradeTarget ? await checkSourceOnlyCharts(files, upgradeTarget) : undefined;
  const upgradeAssets = checkUpgrade ? await inspectSourceOnlyUpgradeAssets(root, files, options) : undefined;
  if (upgradeTarget) findings.push(...upgradeTarget.findings);
  if (upgradeUsage) findings.push(...upgradeUsage.findings);
  if (chartUsage) findings.push(...chartUsage);
  if (upgradeAssets) findings.push(...upgradeAssets.findings);
  const admitted = findings.filter(finding => {
    if (finding.code === 'usage.source.root_invalid' || finding.code === 'usage.source.outside_root'
      || finding.code === 'upgrade.target_invalid' || finding.code === 'upgrade.outside_root') return true;
    const configured = options.rules?.[finding.code];
    if (configured === 'off') return false;
    if (configured) finding.severity = configured;
    return !options.allow?.some(entry => entry.code === finding.code && matchesPathPattern((finding.path ?? '').replace(/:\d+$/u, ''), normalizePath(entry.path)));
  });
  return { mode: 'source-only', findings: admitted, ok: !admitted.some(finding => finding.severity === 'error' || (options.strict && finding.severity === 'warning')),
    scannedFiles: files.length, installedFramework: { status: installed.status, version: installed.version, publicExports: installed.publicExports, modalShow: installed.modalShow },
    ...(themeFoundation ? { themeFoundation: themeFoundation.summary } : {}),
    ...(upgradeTarget && upgradeUsage && upgradeAssets ? { upgrade: {
      catalogVersion: SOURCE_ONLY_UPGRADE_CATALOG_VERSION, target: upgradeTarget.summary,
      applicableMigrations: getSourceOnlyUpgradeCatalog().filter(entry => !entry.capability
        || upgradeTarget.summary.capabilities[entry.capability] === 'available').map(entry => entry.id),
      checkedImports: upgradeUsage.stats.checkedNamedExports,
      checkedAssets: upgradeAssets.checkedAssets, reviewAssets: upgradeAssets.reviewAssets, usage: upgradeUsage.stats,
      chartReviews: admitted.filter(item => item.code.startsWith('upgrade.chart.')).length,
      reviewCounts: {
        required: admitted.filter(item => item.code.startsWith('upgrade.') && item.category === 'required').length,
        recommended: admitted.filter(item => item.code.startsWith('upgrade.') && item.category === 'recommended').length,
        manualReview: admitted.filter(item => item.code.startsWith('upgrade.') && item.category === 'manual-review').length,
      }, coverage: 'bounded-static' as const,
      limitations: ['Only admitted literal source and catalog contracts are inspected; dynamic wrappers and app resolvers can require review.',
        'Customized source copies have no historical baseline unless separately recorded; no file is overwritten.',
        'A clean scan does not qualify runtime services, persisted-data migrations, accessibility or visual layout.'],
    } } : {}) };
}

async function discover(root: string, options: SourceOnlyDoctorOptions, findings: PlatformDoctorFinding[], includeCss: boolean): Promise<SourceOnlyFile[]> {
  const exclusions = [...DEFAULT_EXCLUDES, ...(options.exclude ?? [])];
  const files = new Map<string, SourceOnlyFile>();
  const roots = options.include?.length ? options.include : defaultRoots;
  const sourceExtension = includeCss ? /\.(?:css|ts|tsx|js|jsx|mts|cts|mjs|cjs)$/iu : /\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/iu;
  const excluded = (path: string) => sourceOnlyBlockedPath(path) || exclusions.some(pattern => matchesPathPattern(path, normalizePath(pattern)));
  async function read(path: string, fence: string, explicitFile = false) {
    const label = normalizePath(relative(root, path));
    if (!sourceExtension.test(label) || excluded(label)) return;
    try {
      const canonical = sourceOnlyRealpath(path);
      if ((!explicitFile && !sourceOnlyInside(fence, canonical)) || (explicitFile && canonical !== fence)) {
        findings.push({ severity: 'error', code: 'usage.source.outside_root', path: label, category: 'required', confidence: 'high',
          message: 'A source symlink leaves its explicitly admitted scan root; that source was not read.' }); return;
      }
      const canonicalLabel = normalizePath(relative(root, canonical));
      if (!sourceExtension.test(canonicalLabel) || sourceOnlyBlockedPath(canonicalLabel) || includeCss && excluded(canonicalLabel)) return;
      if (files.has(canonical)) return;
      const file = Bun.file(canonical);
      if (file.size > 2_000_000) {
        findings.push({ severity: 'warning', code: 'usage.source.file_too_large', path: label, category: 'manual-review', confidence: 'high', message: 'Source larger than 2 MB was skipped; inspection coverage is incomplete.' }); return;
      }
      files.set(canonical, { path: label, resolutionPath: relative(root, canonical), source: await file.text() });
    } catch { findings.push({ severity: 'warning', code: 'usage.source.read_failed', path: label, category: 'manual-review', confidence: 'high', message: 'Source could not be read; inspection coverage is incomplete.' }); }
  }
  for (const input of roots) {
    const path = isAbsolute(input) ? input : resolve(root, input);
    let fence: string;
    try { fence = sourceOnlyRealpath(path); } catch { continue; }
    try {
      if (statSync(fence).isFile()) { await read(path, fence, true); continue; }
      if (!statSync(fence).isDirectory()) continue;
      const glob = new Bun.Glob(includeCss ? '**/*.{css,ts,tsx,js,jsx,mts,cts,mjs,cjs}' : '**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}');
      for await (const entry of glob.scan({ cwd: fence, absolute: true, dot: true, onlyFiles: true, followSymlinks: false })) await read(entry, fence);
    } catch { findings.push({ severity: 'warning', code: 'usage.source.scan_failed', path: normalizePath(relative(root, path)), category: 'manual-review', confidence: 'high', message: 'An admitted source root could not be scanned; inspection coverage is incomplete.' }); }
  }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}
