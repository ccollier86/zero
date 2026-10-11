/** Upgrade orchestration/CLI policy in disposable projects; never imports app configuration or executes target modules. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { runSourceOnlyDoctor } from './source-only-doctor';
import { getSourceOnlyUpgradeCatalog, SOURCE_ONLY_UPGRADE_CATALOG_VERSION } from './source-only-upgrade-catalog';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const FRAMEWORK = new URL('../../', import.meta.url).pathname;
async function fixture(run: (root: string) => Promise<void>) {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'upgrade-doctor-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function install(root: string) {
  await Bun.write(join(root, 'node_modules/@zero/framework/package.json'), JSON.stringify({
    name: '@zero/framework', version: '2.6.0', exports: { './modals': './src/modals.ts', './react': './src/react.ts',
      './components/ui/*': './src/components/ui/*.tsx' },
  }));
  await Bun.write(join(root, 'node_modules/@zero/framework/src/modals.ts'),
    'export const modals={open(){},show(){}}; throw new Error("TARGET_SOURCE_MUST_NOT_EXECUTE");');
  await Bun.write(join(root, 'node_modules/@zero/framework/src/react.ts'), 'export function Card(){};');
}
async function cli(root: string, args: string[]) {
  const child = Bun.spawn([process.execPath, '--no-env-file', new URL('../cli/run.ts', import.meta.url).pathname, 'doctor', ...args], {
    cwd: root, stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH, TMPDIR: SCRATCH },
  });
  const timer = setTimeout(() => child.kill(), 25_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, code };
  } finally { clearTimeout(timer); }
}

test('upgrade is opt-in; default scans retain existing metadata and source extension contracts', async () => fixture(async root => {
  await install(root);
  await Bun.write(join(root, 'app/card.tsx'), "import {Card} from '@zero/framework/react'; export const article=<Card/>;");
  await Bun.write(join(root, 'app/missing.css'), '@import "./missing-helper.css";');
  const normal = await runSourceOnlyDoctor({ projectRoot: root });
  const disabled = await runSourceOnlyDoctor({ projectRoot: root, upgrade: false });
  expect(normal.upgrade).toBeUndefined(); expect(disabled).toEqual(normal);
  expect(normal.scannedFiles).toBe(1); expect(normal.findings).toEqual([]);
  const upgraded = await runSourceOnlyDoctor({ projectRoot: root, upgrade: true });
  expect(upgraded.scannedFiles).toBe(2); expect(upgraded.upgrade?.target.version).toBe('2.6.0');
  expect(upgraded.upgrade?.catalogVersion).toBe(SOURCE_ONLY_UPGRADE_CATALOG_VERSION);
  expect(upgraded.upgrade?.coverage).toBe('bounded-static');
  expect(upgraded.findings.some(finding => finding.code === 'upgrade.assets.missing')).toBe(true);
}));

test('explicit target preserves installed identity and inspects current capabilities without calling the target', async () => fixture(async root => {
  await install(root);
  await Bun.write(join(root, 'app/card.tsx'), "import {Card, NotAFrameworkExport} from '@zero/framework/components/ui/card'; export const card=<Card/>;");
  const report = await runSourceOnlyDoctor({ projectRoot: root, upgrade: { targetRoot: FRAMEWORK } });
  expect(report.installedFramework.status).toBe('installed');
  expect(report.upgrade?.target.status).toBe('explicit');
  expect(report.upgrade?.target.capabilities.contentCard).toBe('available');
  expect(report.upgrade?.target.capabilities.dropdownInnerViewport).toBe('available');
  expect(report.upgrade?.target.capabilities.popoverViewport).toBe('available');
  expect(report.upgrade?.target.fingerprint.value).toMatch(/^[a-f\d]{64}$/u);
  expect(report.upgrade?.checkedImports).toBe(2);
  expect(report.findings.some(finding => finding.code === 'upgrade.import_missing' && finding.category === 'required')).toBe(true);
  expect(report.findings.some(finding => finding.code === 'upgrade.dropdown_scroll_owner')).toBe(false);
}));

test('policies apply before upgrade summary counts and strict exit status are derived', async () => fixture(async root => {
  await install(root);
  await Bun.write(join(root, 'app/usage.tsx'), "import {NotAFrameworkExport} from '@zero/framework/components/ui/card'; import './missing.css';");
  const report = await runSourceOnlyDoctor({ projectRoot: root, upgrade: { targetRoot: FRAMEWORK },
    rules: { 'upgrade.assets.missing': 'off' }, allow: [{ code: 'upgrade.import_missing', path: 'app/**' }] });
  expect(report.findings.filter(finding => finding.code.startsWith('upgrade.') && finding.category === 'required')).toEqual([]);
  expect(report.upgrade?.reviewCounts.required).toBe(0); expect(report.ok).toBe(true);
}));

test('pathological source becomes incomplete coverage without aborting independent upgrade findings', async () => fixture(async root => {
  await install(root);
  await Bun.write(join(root, 'app/deep.ts'), `export const value=${'('.repeat(4_000)}0${')'.repeat(4_000)};`);
  await Bun.write(join(root, 'app/missing.ts'), "import {Removed} from '@zero/framework/components/ui/card';");
  const report = await runSourceOnlyDoctor({ projectRoot: root, themeFoundation: true, upgrade: { targetRoot: FRAMEWORK } });
  expect(report.findings.some(finding => finding.code === 'upgrade.source_incomplete' && finding.category === 'manual-review')).toBe(true);
  expect(report.findings.some(finding => finding.code === 'upgrade.import_missing' && finding.path?.startsWith('app/missing.ts:'))).toBe(true);
  expect(report.upgrade?.coverage).toBe('bounded-static');
}));

test('admitted source aliases resolve local reexports at their canonical source while retaining diagnostic labels', async () => fixture(async root => {
  await install(root);
  await Bun.write(join(root, 'app/physical/entry.tsx'), "import {Local} from './bridge'; export const card=<Local/>;");
  await Bun.write(join(root, 'app/physical/bridge.ts'), "export {Removed as Local} from '@zero/framework/components/ui/card';");
  await Bun.write(join(root, 'app/bridge.ts'), "export {Card as Local} from '@zero/framework/components/ui/card';");
  await symlink(join(root, 'app/physical/entry.tsx'), join(root, 'app/entry.tsx'));
  const report = await runSourceOnlyDoctor({ projectRoot: root, upgrade: { targetRoot: FRAMEWORK },
    include: ['app/entry.tsx', 'app/physical/bridge.ts', 'app/bridge.ts'] });
  expect(report.findings.some(finding => finding.code === 'upgrade.import_missing' && finding.path === 'app/entry.tsx:1')).toBe(true);
  expect(report.findings.some(finding => finding.code === 'upgrade.binding_unknown' && finding.path?.startsWith('app/entry.tsx:'))).toBe(false);
}));

test('malformed upgrade settings fail without scanning and are never reflected in diagnostics', async () => {
  for (const upgrade of [null, 'PRIVATE_UPGRADE_INPUT', [], new Date(), { targetRoot: '' }, { targetRoot: 1 },
    { unexpected: 'PRIVATE_UPGRADE_INPUT' }, { [Symbol('private')]: true }, Object.defineProperty({}, 'unknown', { value: true })]) {
    const report = await runSourceOnlyDoctor({ projectRoot: '/missing-fixture-never-read', upgrade } as never);
    expect(report.scannedFiles).toBe(0); expect(report.findings[0]?.code).toBe('upgrade.option_invalid');
    expect(JSON.stringify(report)).not.toContain('PRIVATE_UPGRADE_INPUT');
  }
});

test('upgrade option and target getter are snapshotted once before asynchronous discovery', async () => fixture(async root => {
  await install(root);
  let optionReads = 0, targetReads = 0;
  const settings = { get targetRoot() { targetReads++; return targetReads === 1 ? FRAMEWORK : '/invalid-late-target'; } };
  const report = await runSourceOnlyDoctor({ projectRoot: root, get upgrade() { optionReads++; return settings; } });
  expect(optionReads).toBe(1); expect(targetReads).toBe(1); expect(report.upgrade?.target.status).toBe('explicit');
}));

test('an invalid explicit target cannot fall back to nested installation or be suppressed', async () => fixture(async root => {
  await install(root);
  await Bun.write(join(root, 'package.json'), JSON.stringify({ name: 'application-with-a-nested-framework', private: true }));
  const report = await runSourceOnlyDoctor({ projectRoot: root, upgrade: { targetRoot: root },
    rules: { 'upgrade.target_invalid': 'off' }, allow: [{ code: 'upgrade.target_invalid', path: '**' }] });
  expect(report.ok).toBe(false); expect(report.upgrade?.target.status).toBe('unavailable');
  expect(report.findings.some(finding => finding.code === 'upgrade.target_invalid')).toBe(true);
}));

test('real CLI upgrade JSON stays config/resource/environment-free and preserves strict/policy outcomes', async () => fixture(async root => {
  await install(root);
  await Bun.write(join(root, 'app/card.tsx'), "import {Card} from '@zero/framework/react'; export const card=<Card/>;");
  await Bun.write(join(root, 'zero.config.ts'), "await Bun.write('CONFIG_EXECUTED','bad'); throw new Error('CONFIG_MUST_NOT_EXECUTE');");
  await Bun.write(join(root, 'server/resources/tripwire.ts'), "await Bun.write('RESOURCE_EXECUTED','bad'); throw new Error('RESOURCE_MUST_NOT_EXECUTE');");
  await Bun.write(join(root, '.env'), 'UPGRADE_DOCTOR_SECRET=PRIVATE_ENV_TRIPWIRE\n');
  const result = await cli(root, ['--source-only', '--project-root', root, '--upgrade', '--upgrade-target-root', FRAMEWORK,
    '--usage-include', 'app', '--strict', '--json']);
  const report = JSON.parse(result.stdout);
  expect(result.code).toBe(0); expect(report.mode).toBe('source-only');
  expect(report.upgrade.target.status).toBe('explicit'); expect(report.upgrade.coverage).toBe('bounded-static');
  expect(report.upgrade.checkedImports).toBe(1);
  expect(result.stdout + result.stderr).not.toMatch(/PRIVATE_ENV_TRIPWIRE|TARGET_SOURCE_MUST_NOT_EXECUTE|CONFIG_MUST_NOT_EXECUTE|RESOURCE_MUST_NOT_EXECUTE/u);
  expect(await Bun.file(join(root, 'CONFIG_EXECUTED')).exists()).toBe(false);
  expect(await Bun.file(join(root, 'RESOURCE_EXECUTED')).exists()).toBe(false);
  await Bun.write(join(root, 'app/card.tsx'), "import {NoLongerExported} from '@zero/framework/components/ui/card';");
  const missing = await cli(root, ['--source-only', '--project-root', root, '--upgrade', '--upgrade-target-root', FRAMEWORK,
    '--usage-include', 'app', '--json']);
  expect(missing.code).toBe(1);
  expect(JSON.parse(missing.stdout).findings.some((finding: { code: string }) => finding.code === 'upgrade.import_missing')).toBe(true);
}));

test('upgrade flags never silently enter the configuration-loading CLI branch', async () => fixture(async root => {
  await Bun.write(join(root, 'zero.config.ts'), "await Bun.write('CONFIG_EXECUTED','bad'); throw new Error('CONFIG_MUST_NOT_EXECUTE');");
  for (const args of [['--upgrade'], ['--source-only', '--project-root', root, '--upgrade-target-root', FRAMEWORK],
    ['--source-only', '--project-root', root, '--upgrade', '--upgrade-target-root']]) {
    const result = await cli(root, [...args, '--json']);
    expect(result.code).toBe(1); expect(JSON.parse(result.stdout).findings[0]?.code).toBe('doctor.failed');
    expect(result.stdout + result.stderr).not.toContain('CONFIG_MUST_NOT_EXECUTE');
  }
  expect(await Bun.file(join(root, 'CONFIG_EXECUTED')).exists()).toBe(false);
}));

test('dispatcher suppresses child environment loading for static-only options even before validation', async () => fixture(async root => {
  const entry = new URL('../cli/run.ts', import.meta.url).pathname;
  for (const flag of ['--source-only', '--theme-foundation', '--upgrade', '--upgrade-target-root']) {
    const script = `Bun.argv=[process.execPath,${JSON.stringify(entry)},'doctor',${JSON.stringify(flag)}];
      Bun.spawn=(command)=>{console.log(JSON.stringify(command));return {exited:Promise.resolve(0)}};
      await import(${JSON.stringify(entry)});`;
    const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', script], { cwd: root, stdout: 'pipe', stderr: 'pipe',
      env: { PATH: process.env.PATH, TMPDIR: SCRATCH } });
    const timer = setTimeout(() => child.kill(), 25_000);
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(code, stderr).toBe(0);
      expect(JSON.parse(stdout)[1]).toBe('--no-env-file');
    } finally { clearTimeout(timer); }
  }
}));

test('upgrade catalog is stable frozen data; optional parts never become required migrations', () => {
  const catalog = getSourceOnlyUpgradeCatalog();
  expect(SOURCE_ONLY_UPGRADE_CATALOG_VERSION).toBeGreaterThan(0); expect(Object.isFrozen(catalog)).toBe(true);
  expect(new Set(catalog.map(entry => entry.id)).size).toBe(catalog.length);
  for (const entry of catalog) expect(Object.isFrozen(entry)).toBe(true);
  expect(catalog.filter(entry => ['contentCard', 'selectRichSlots', 'popoverViewport'].includes(entry.capability ?? '')
    && entry.category === 'required')).toEqual([]);
});

test('real CLI charts are informational under strict mode; policy suppression affects chart review counts', async () => fixture(async root => {
  await install(root);
  await Bun.write(join(root, 'app/chart.tsx'), "import {LineChart as Legacy} from 'recharts'; export const chart=<Legacy/>; throw new Error('CHART_SOURCE_MUST_NOT_EXECUTE');");
  const normal = await runSourceOnlyDoctor({ projectRoot: root });
  expect(normal.findings.some(finding => finding.code.startsWith('upgrade.chart.'))).toBe(false);
  const result = await cli(root, ['--source-only', '--project-root', root, '--upgrade', '--upgrade-target-root', FRAMEWORK, '--strict', '--json']);
  const report = JSON.parse(result.stdout);
  expect(result.code).toBe(0); expect(report.ok).toBe(true); expect(report.upgrade.catalogVersion).toBe(2);
  expect(report.upgrade.chartReviews).toBe(2); expect(report.upgrade.reviewCounts.manualReview).toBe(2);
  expect(report.findings.find((finding: { code: string }) => finding.code === 'upgrade.chart.legacy_usage').hint).toContain('XYLineChart');
  expect(result.stdout + result.stderr).not.toContain('CHART_SOURCE_MUST_NOT_EXECUTE');
  const suppressed = await runSourceOnlyDoctor({ projectRoot: root, upgrade: { targetRoot: FRAMEWORK },
    rules: { 'upgrade.chart.legacy_dependency': 'off' }, allow: [{ code: 'upgrade.chart.legacy_usage', path: 'app/**' }] });
  expect(suppressed.upgrade?.chartReviews).toBe(0); expect(suppressed.ok).toBe(true);
}));
