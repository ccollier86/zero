/** Disposable filesystem/CLI fixtures prove static inspection never evaluates application modules. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { runSourceOnlyDoctor } from './source-only-doctor';

const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
async function fixture(run: (root: string) => Promise<void>) {
  await mkdir(scratch, { recursive: true }); const root = await mkdtemp(join(scratch, 'source-doctor-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function write(root: string, path: string, source: string) { const target = join(root, path); await Bun.write(target, source); return target; }
async function install(root: string, show = true) {
  await write(root, 'node_modules/@zero/framework/package.json', JSON.stringify({ name: '@zero/framework', version: show ? '2.6.0' : '2.5.0',
    exports: { '.': './src/index.ts', './modals': './src/modals/index.ts' } }));
  await write(root, 'node_modules/@zero/framework/src/modals/index.ts', 'export { modals } from "./events";');
  await write(root, 'node_modules/@zero/framework/src/modals/events.ts', `export const modals={open${show ? ',show' : ''}}; throw new Error('MUST_NOT_EXECUTE_PACKAGE');`);
}

test('source roots, default excludes, installed exports and strict semantics remain scoped', async () => fixture(async root => {
  await install(root); await write(root, 'app/page.tsx', "import {modals} from '@zero/framework/modals'; modals.open({content:'x'});");
  await write(root, 'app/page.test.tsx', "import {modals} from '@zero/framework/modals'; modals.show({});");
  await write(root, 'custom/ui.tsx', "import {modals} from '@zero/framework/modals'; modals.show({});");
  const report = await runSourceOnlyDoctor({ projectRoot: root });
  expect(report.mode).toBe('source-only'); expect(report.scannedFiles).toBe(1); expect(report.ok).toBe(true);
  expect(report.installedFramework).toMatchObject({ status: 'installed', version: '2.6.0', modalShow: true });
  expect(report.findings.map(f => f.code)).toEqual(['usage.modal.legacy_open']);
  expect((await runSourceOnlyDoctor({ projectRoot: root, strict: true })).ok).toBe(false);
  const custom = await runSourceOnlyDoctor({ projectRoot: root, include: ['custom'] });
  expect(custom.findings[0]?.path).toBe('custom/ui.tsx:1'); expect(custom.ok).toBe(false);
  expect((await runSourceOnlyDoctor({ projectRoot: root, include: ['custom'], exclude: ['custom/**'] })).scannedFiles).toBe(0);
}));

test('rule severities and exact code/path allow entries are applied after parsing', async () => fixture(async root => {
  await install(root); await write(root, 'app/page.tsx', "import {modals} from '@zero/framework/modals'; modals.open({content:'x'}); modals.show({});");
  const report = await runSourceOnlyDoctor({ projectRoot: root, rules: { 'usage.modal.legacy_open': 'off' },
    allow: [{ code: 'usage.modal.title_required', path: 'app/**' }] });
  expect(report.findings).toEqual([]); expect(report.ok).toBe(true);
}));

test('missing installed package yields unknown capability instead of recommending new APIs', async () => fixture(async root => {
  await write(root, 'app/page.tsx', "import {modals} from '@zero/framework'; modals.open({content:'x'});");
  const report = await runSourceOnlyDoctor({ projectRoot: root });
  expect(report.installedFramework).toMatchObject({ status: 'missing', version: null, modalShow: null });
  expect(report.findings.every(f => f.severity === 'info')).toBe(true);
}));

test('actual readonly facade assertions and satisfies wrappers retain static installed capability without execution', async () => fixture(async root => {
  await install(root); await write(root, 'app/page.tsx', "import {modals} from '@zero/framework/modals'; modals.open({content:'x'});");
  for (const declaration of ['({open,show}) as const', '(({open,show}) as const) satisfies Readonly<Record<string,unknown>>', '<Readonly<Record<string,unknown>>>({open,show})']) {
    await write(root, 'node_modules/@zero/framework/src/modals/events.ts', `export const modals=${declaration}; throw new Error('MUST_NOT_EXECUTE_PACKAGE');`);
    const report = await runSourceOnlyDoctor({ projectRoot: root });
    expect(report.installedFramework.modalShow).toBe(true);
    expect(report.findings.map(finding => finding.code)).toEqual(['usage.modal.legacy_open']);
  }
}));

test('explicit symlink aliases retain root ownership and intentional external roots stay explicit', async () => fixture(async base => {
  const root = join(base, 'project'); const external = join(base, 'shared'); const alias = join(base, 'alias');
  await mkdir(root); await mkdir(external); await install(root); await symlink(root, alias, 'dir');
  await write(root, 'app/page.tsx', "import {modals} from '@zero/framework/modals'; modals.open({content:'x'});");
  await write(external, 'ui.tsx', "import {modals} from '@zero/framework/modals'; modals.show({});");
  expect((await runSourceOnlyDoctor({ projectRoot: alias })).findings[0]?.path).toBe('app/page.tsx:1');
  const report = await runSourceOnlyDoctor({ projectRoot: alias, include: [external] });
  expect(report.findings[0]?.path).toBe('../shared/ui.tsx:1');
}));

test('own package manifest aliases cannot read ambient/data files or leave the explicit project', async () => {
  for (const targetName of ['.env', 'fake-data.db', '../outside/package.json']) await fixture(async base => {
    const root = join(base, 'project'); await mkdir(root);
    const target = join(root, targetName);
    await Bun.write(target, JSON.stringify({ name: '@zero/framework', version: 'FAKE_PRIVATE_VERSION', exports: { './modals': './modals.ts' } }));
    await symlink(target, join(root, 'package.json'));
    const report = await runSourceOnlyDoctor({ projectRoot: root });
    expect(report.installedFramework).toMatchObject({ status: 'missing', version: null, modalShow: null });
    expect(JSON.stringify(report)).not.toContain('FAKE_PRIVATE_VERSION');
  });
});

test('installed manifest aliases cannot read ambient files instead of package metadata', async () => fixture(async root => {
  await write(root, '.env', JSON.stringify({ name: '@zero/framework', version: 'FAKE_PRIVATE_VERSION', exports: { './modals': './modals.ts' } }));
  await mkdir(join(root, 'node_modules/@zero/framework'), { recursive: true });
  await symlink(join(root, '.env'), join(root, 'node_modules/@zero/framework/package.json'));
  const report = await runSourceOnlyDoctor({ projectRoot: root });
  expect(report.installedFramework).toMatchObject({ status: 'unavailable', version: null, modalShow: null });
  expect(JSON.stringify(report)).not.toContain('FAKE_PRIVATE_VERSION');
}));

test('public package source aliases cannot read ambient/data/private files', async () => {
  for (const targetName of ['.env', '.env.fixture.ts', 'fake-data.db', '.zero/private.ts']) await fixture(async root => {
    const packageRoot = join(root, 'node_modules/@zero/framework');
    await write(root, 'node_modules/@zero/framework/package.json', JSON.stringify({ name: '@zero/framework', version: '2.6.0', exports: { './modals': './src/alias.ts' } }));
    await Bun.write(join(packageRoot, targetName), 'export const modals={show}; throw new Error("FAKE_PRIVATE_MODULE_MUST_NOT_EXECUTE");');
    await mkdir(join(packageRoot, 'src'), { recursive: true });
    await symlink(join(packageRoot, targetName), join(packageRoot, 'src/alias.ts'));
    const report = await runSourceOnlyDoctor({ projectRoot: root });
    expect(report.installedFramework).toMatchObject({ status: 'installed', version: '2.6.0', modalShow: null });
    expect(JSON.stringify(report)).not.toContain('FAKE_PRIVATE_MODULE_MUST_NOT_EXECUTE');
  });
});

test('installed package directory symlinks retain legitimate canonical manifest/source inspection', async () => fixture(async base => {
  const root = join(base, 'project'), packageRoot = join(base, 'external-package'); await mkdir(root);
  await Bun.write(join(packageRoot, 'package.json'), JSON.stringify({ name: '@zero/framework', version: '2.6.0', exports: { './modals': './src/modals.ts' } }));
  await Bun.write(join(packageRoot, 'src/modals.ts'), 'export const modals={show}; throw new Error("MUST_NOT_EXECUTE_PACKAGE");');
  await mkdir(join(root, 'node_modules/@zero'), { recursive: true });
  await symlink(packageRoot, join(root, 'node_modules/@zero/framework'), 'dir');
  const report = await runSourceOnlyDoctor({ projectRoot: root });
  expect(report.installedFramework).toMatchObject({ status: 'installed', version: '2.6.0', modalShow: true });
  expect(JSON.stringify(report)).not.toContain('MUST_NOT_EXECUTE_PACKAGE');
}));

test('invalid roots are unsuppressable and never fall back to process cwd', async () => {
  const report = await runSourceOnlyDoctor({ projectRoot: '/nonexistent-zero-source-fixture', rules: { 'usage.source.root_invalid': 'off' },
    allow: [{ code: 'usage.source.root_invalid', path: 'projectRoot' }] });
  expect(report.ok).toBe(false); expect(report.scannedFiles).toBe(0); expect(report.findings[0]?.code).toBe('usage.source.root_invalid');
});

test('CLI source-only never discovers/evaluates config, resources, package code or env fixtures', async () => fixture(async root => {
  await install(root); await write(root, 'app/page.tsx', "import {modals} from '@zero/framework/modals'; modals.show({title:'Safe'});");
  await write(root, 'zero.config.ts', "await Bun.write('CONFIG_EXECUTED','bad'); throw new Error('CONFIG_MUST_NOT_RUN');");
  await write(root, 'server/resources/data.ts', "await Bun.write('RESOURCE_EXECUTED','bad'); throw new Error('RESOURCE_MUST_NOT_RUN');");
  await write(root, '.env', 'SOURCE_AUDIT_SECRET=PRIVATE_ENV_FIXTURE\n');
  const script = new URL('./run.ts', import.meta.url).pathname;
  const child = Bun.spawn([process.execPath, '--no-env-file', script, '--source-only', '--project-root', root, '--json', '--usage-include', 'app'],
    { cwd: root, env: { PATH: Bun.env.PATH ?? '' }, stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(child.stdout).text(); const stderr = await new Response(child.stderr).text();
  expect(await child.exited).toBe(0); expect(JSON.parse(stdout).mode).toBe('source-only');
  expect(stdout + stderr).not.toContain('PRIVATE_ENV_FIXTURE'); expect(stdout + stderr).not.toContain('CONFIG_MUST_NOT_RUN');
  expect(await Bun.file(join(root, 'CONFIG_EXECUTED')).exists()).toBe(false); expect(await Bun.file(join(root, 'RESOURCE_EXECUTED')).exists()).toBe(false);
}));
