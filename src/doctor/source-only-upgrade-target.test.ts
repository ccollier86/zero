/** Read-only target/capability fixtures live outside projects; no config, env, package code or services execute. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectSourceOnlyUpgradeTarget } from './source-only-upgrade-target';
import { getSourceOnlyUpgradeCatalog, SOURCE_ONLY_UPGRADE_CATALOG_VERSION } from './source-only-upgrade-catalog';

const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
async function fixture(run: (root: string) => Promise<void>) {
  await mkdir(scratch, { recursive: true }); const root = await mkdtemp(join(scratch, 'upgrade-target-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function write(root: string, name: string, source: string) { await Bun.write(join(root, name), source); }
const exportsMap = { '.': './src/frontend.ts', './react': './src/frontend.ts', './modals': './src/modals.ts',
  './components/dropdown-menu': './src/dropdown.tsx', './components/popover': './src/popover.tsx',
  './components/ui/*': './src/*.tsx' };
async function target(root: string, next = true) {
  await write(root, 'package.json', JSON.stringify({ name: '@zero/framework', version: '2.6.0', exports: exportsMap }));
  await write(root, 'src/frontend.ts', 'export {}; throw new Error("PACKAGE_MUST_NOT_EXECUTE");');
  await write(root, 'src/modals.ts', `export const modals=({open${next ? ',show' : ''}} as const) satisfies object;`);
  const viewport = next ? '<div data-slot="dropdown-menu-viewport" ref={nativeViewportRef} className="min-h-0 overflow-y-auto">{children}</div><ScrollViewportDecoration viewport={viewport}/>' : '<div>{children}</div>';
  await write(root, 'src/dropdown.tsx', `export function DropdownMenuContent(){ return <Content>${viewport}</Content> }
    export function DropdownMenuSubContent(){ return <Content>${viewport}</Content> }`);
  await write(root, 'src/popover.tsx', next ? 'export function PopoverViewport(){ return <div/> }' : 'export function PopoverContent(){ return <div/> }');
  await write(root, 'src/content-card.tsx', next ? 'export function ContentCard(){ return <article/> }' : 'export function Card(){ return <div/> }');
  await write(root, 'src/select.tsx', next ? `export function SelectItem(){ return <Item><span className="zero-select-item-leading"/><Item.ItemText/>
    <span className="zero-select-item-description"/><span className="zero-select-item-trailing"/></Item> }` : 'export function SelectItem(){ return <Item><Item.ItemText/></Item> }');
}

test('installed targets, exact explicit roots and framework workspaces use actual same-version capability evidence', async () => fixture(async root => {
  const installed = join(root, 'node_modules/@zero/framework'); await target(installed);
  const inspection = await inspectSourceOnlyUpgradeTarget(root, true);
  expect(inspection.summary).toMatchObject({ status: 'installed', version: '2.6.0', capabilities: {
    modalShow: 'available', dropdownInnerViewport: 'available', popoverViewport: 'available', contentCard: 'available', selectRichSlots: 'available' } });
  expect(inspection.summary.fingerprint).toMatchObject({ algorithm: 'sha256', scope: 'bounded-public-source', complete: true });
  expect(inspection.findings).toEqual([]);
  expect((await inspection.inspectNamedExport('@zero/framework/components/ui/select', 'SelectItem')).status).toBe('available');
  expect((await inspectSourceOnlyUpgradeTarget(installed, true)).summary.status).toBe('workspace');
  const old = join(root, 'old-package'); await target(old, false);
  const previous = await inspectSourceOnlyUpgradeTarget(root, { targetRoot: old });
  expect(previous.summary).toMatchObject({ status: 'explicit', version: '2.6.0', capabilities: {
    modalShow: 'missing', dropdownInnerViewport: 'missing', popoverViewport: 'missing', contentCard: 'missing', selectRichSlots: 'missing' } });
  expect(previous.summary.fingerprint.value).not.toBe(inspection.summary.fingerprint.value);
  expect(previous.findings).toEqual([]); // Optional parts and older compatible implementations are not errors.
}));

test('default targets follow legitimate package-directory aliases while explicit app roots never fall back to installed packages', async () => fixture(async base => {
  const project = join(base, 'app'), external = join(base, 'framework'); await mkdir(project); await target(external);
  await write(project, 'package.json', '{"name":"not-zero","version":"1"}');
  await mkdir(join(project, 'node_modules/@zero'), { recursive: true }); await symlink(external, join(project, 'node_modules/@zero/framework'), 'dir');
  expect((await inspectSourceOnlyUpgradeTarget(project, true)).summary.status).toBe('installed');
  expect((await inspectSourceOnlyUpgradeTarget(project, { targetRoot: '../framework' })).summary.status).toBe('explicit');
  const invalid = await inspectSourceOnlyUpgradeTarget(project, { targetRoot: project });
  expect(invalid.summary.status).toBe('unavailable'); expect(invalid.findings[0]?.code).toBe('upgrade.target_invalid');
}));

test('missing default targets report uncertainty without assuming Doctor own version or capabilities', async () => fixture(async root => {
  const inspection = await inspectSourceOnlyUpgradeTarget(root, true);
  expect(inspection.summary.status).toBe('missing'); expect(inspection.summary.version).toBeNull();
  expect(inspection.summary.fingerprint.value).toBeNull(); expect(Object.values(inspection.summary.capabilities)).toEqual(['unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
  expect((await inspection.inspectNamedExport('@zero/framework', 'Missing')).status).toBe('unknown');
  expect(inspection.findings[0]?.severity).toBe('info');
  expect((await inspectSourceOnlyUpgradeTarget(root, false)).findings).toEqual([]);
}));

test('unsafe options and manifest aliases never read private env/data or leave canonical target ownership', async () => fixture(async root => {
  let reads = 0;
  const option = Object.defineProperty({}, 'targetRoot', { enumerable: true, get() { reads++; throw new Error('MUST_NOT_READ_ACCESSOR'); } });
  expect((await inspectSourceOnlyUpgradeTarget(root, option)).findings[0]?.code).toBe('upgrade.target_invalid'); expect(reads).toBe(0);
  for (const path of ['.env', '.env.private.ts', 'fake.db', '.zero/private.ts']) {
    const name = 'target-' + path.replaceAll('/', '-').replaceAll('.', '-'); const packageRoot = join(root, name); await mkdir(packageRoot);
    await write(packageRoot, path, '{"name":"@zero/framework","version":"PRIVATE_ENV_VALUE"}');
    await symlink(join(packageRoot, path), join(packageRoot, 'package.json'));
    const result = await inspectSourceOnlyUpgradeTarget(root, { targetRoot: packageRoot });
    expect(result.summary.status).toBe('unavailable'); expect(JSON.stringify(result)).not.toContain('PRIVATE_ENV_VALUE');
  }
  const outside = join(root, 'outside'), aliased = join(root, 'alias-package'); await target(outside); await mkdir(aliased);
  await symlink(join(outside, 'package.json'), join(aliased, 'package.json'));
  expect((await inspectSourceOnlyUpgradeTarget(root, { targetRoot: aliased })).findings[0]?.code).toBe('upgrade.outside_root');
}));

test('manifest name, private roots and oversize boundaries are explicit failures; source failures stay unknown', async () => fixture(async root => {
  const wrong = join(root, 'wrong'), privateRoot = join(root, '.zero/package'), huge = join(root, 'huge');
  await write(wrong, 'package.json', '{"name":"another-package"}'); await target(privateRoot);
  await write(huge, 'package.json', ' '.repeat(2_000_001));
  for (const targetRoot of [wrong, privateRoot, huge, join(root, 'absent')]) {
    expect((await inspectSourceOnlyUpgradeTarget(root, { targetRoot })).findings[0]?.code).toBe('upgrade.target_invalid');
  }
  const valid = join(root, 'valid'); await target(valid); await write(valid, 'src/modals.ts', `export { modals } from './.env.private.ts';`);
  await write(valid, 'src/.env.private.ts', 'export const modals={show};');
  const result = await inspectSourceOnlyUpgradeTarget(root, { targetRoot: valid });
  expect(result.summary.capabilities.modalShow).toBe('unknown'); expect(result.summary.fingerprint.complete).toBe(false);
  expect((await result.inspectNamedExport('@zero/framework/modals', 'modals')).status).toBe('unknown');
}));

test('fingerprints are stable across metadata key order and lazy checks, but distinguish changed source at the same version', async () => fixture(async root => {
  await target(root); const first = await inspectSourceOnlyUpgradeTarget(root, true);
  const manifest = await Bun.file(join(root, 'package.json')).json();
  await write(root, 'package.json', JSON.stringify({ exports: manifest.exports, version: manifest.version, name: manifest.name }));
  const reordered = await inspectSourceOnlyUpgradeTarget(root, true);
  expect(reordered.summary.fingerprint.value).toBe(first.summary.fingerprint.value);
  const identity = reordered.summary.fingerprint;
  await write(root, 'src/another.tsx', 'export const Another=1;');
  expect((await reordered.inspectNamedExport('@zero/framework/components/ui/another', 'Another')).status).toBe('available');
  expect(reordered.summary.fingerprint).toBe(identity);
  await write(root, 'src/select.tsx', (await Bun.file(join(root, 'src/select.tsx')).text()) + '\n// same version, new source');
  expect((await inspectSourceOnlyUpgradeTarget(root, true)).summary.fingerprint.value).not.toBe(identity.value);
}));

test('capabilities require actual source shape, not exported names or misleading comments', async () => fixture(async root => {
  await target(root);
  await write(root, 'src/dropdown.tsx', `// data-slot="dropdown-menu-viewport" overflow-y-auto ScrollViewportDecoration viewport ref
    export function DropdownMenuContent(){ return <Content>{children}</Content> }
    export function DropdownMenuSubContent(){ return <Content>{children}</Content> }`);
  await write(root, 'src/select.tsx', `// zero-select-item-leading zero-select-item-description zero-select-item-trailing
    export function SelectItem(){ return <Item><Item.ItemText/></Item> }`);
  await write(root, 'src/modals.ts', 'export const modals={...unknownFacade};');
  const result = await inspectSourceOnlyUpgradeTarget(root, true);
  expect(result.summary.capabilities).toMatchObject({ dropdownInnerViewport: 'missing', selectRichSlots: 'missing', modalShow: 'unknown' });
}));

test('conditional implementations cannot promote a behavior from just one branch, and ordering remains in target identity', async () => fixture(async root => {
  await target(root); await write(root, 'src/old-dropdown.tsx', 'export function DropdownMenuContent(){ return <div/> } export function DropdownMenuSubContent(){ return <div/> }');
  const manifest = await Bun.file(join(root, 'package.json')).json();
  manifest.exports['./components/dropdown-menu'] = { import: './src/dropdown.tsx', default: './src/old-dropdown.tsx' };
  await write(root, 'package.json', JSON.stringify(manifest));
  const first = await inspectSourceOnlyUpgradeTarget(root, true);
  expect(first.summary.capabilities.dropdownInnerViewport).toBe('unknown');
  expect((await first.inspectNamedExport('@zero/framework/components/dropdown-menu', 'DropdownMenuContent', 'value')).status).toBe('available');
  manifest.exports['./components/dropdown-menu'] = { default: './src/old-dropdown.tsx', import: './src/dropdown.tsx' };
  await write(root, 'package.json', JSON.stringify(manifest));
  const reordered = await inspectSourceOnlyUpgradeTarget(root, true);
  expect(reordered.summary.capabilities.dropdownInnerViewport).toBe('unknown');
  expect(reordered.summary.fingerprint.value).not.toBe(first.summary.fingerprint.value);
}));

test('migration catalog is versioned, deeply frozen metadata and does not demand optional new Card or Select APIs', () => {
  const catalog = getSourceOnlyUpgradeCatalog(); expect(SOURCE_ONLY_UPGRADE_CATALOG_VERSION).toBe(2);
  expect(Object.isFrozen(catalog)).toBe(true); expect(catalog.every(Object.isFrozen)).toBe(true);
  expect(catalog.find(entry => entry.detector === 'relative-asset')?.code).toBe('upgrade.assets.missing');
  expect(catalog.some(entry => entry.capability === 'contentCard' || entry.capability === 'selectRichSlots')).toBe(false);
});
