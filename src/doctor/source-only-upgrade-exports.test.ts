/** Disposable public-contract fixtures. Package code and custom resolvers are never executed. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { SourceOnlyUpgradeExports } from './source-only-upgrade-exports';

const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
async function fixture(run: (root: string) => Promise<void>) {
  await mkdir(scratch, { recursive: true }); const root = await mkdtemp(join(scratch, 'upgrade-exports-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function write(root: string, name: string, source: string) { await Bun.write(join(root, name), source); }

test('literal declarations, aliases, imported locals, destructuring and type-only exports resolve statically', async () => fixture(async root => {
  const inspector = new SourceOnlyUpgradeExports(root, { '.': './index.ts', './types': './types.ts' });
  await write(root, 'index.ts', `export const Value=1; export function Function(){}; export class Class{}; export enum Enum { A }
    export const { Destructured } = { Destructured: 1 }; const Local=1; export { Local as Alias };
    export { Upstream as Renamed } from './upstream'; import Default, { Upstream as Imported } from './upstream';
    export { Imported, Default }; export type { Shape as PublicShape } from './types'; export * from './types';
    throw new Error('PACKAGE_MUST_NOT_EXECUTE');`);
  await write(root, 'upstream.ts', 'export const Upstream=1; export default function Default(){}');
  await write(root, 'types.ts', 'export interface Shape { value: number }; export type OnlyType = string; export const AlsoValue=1;');
  for (const name of ['Value', 'Function', 'Class', 'Enum', 'Destructured', 'Alias', 'Renamed', 'Imported', 'Default', 'AlsoValue']) {
    expect((await inspector.inspect('@zero/framework', name)).status).toBe('available');
  }
  expect(await inspector.inspect('@zero/framework', 'Absent')).toEqual({ status: 'missing', reason: 'not-exported' });
  for (const name of ['PublicShape', 'Shape', 'OnlyType']) {
    expect((await inspector.inspect('@zero/framework', name)).status).toBe('missing');
    expect((await inspector.inspect('@zero/framework', name, 'any')).status).toBe('available');
  }
  expect((await inspector.inspect('@zero/framework/types', 'Shape', 'any')).status).toBe('available');
}));

test('package exact denial and most-specific wildcard mappings beat broad public patterns', async () => fixture(async root => {
  const inspector = new SourceOnlyUpgradeExports(root, { '.': './index.ts', './ui/*': './generic/*.ts',
    './ui/private': null, './ui/private/*': null, './ui/precise-*': './precise/*.tsx' });
  await write(root, 'index.ts', 'export const Root=1;');
  await write(root, 'generic/button.ts', 'export const Button=1;');
  await write(root, 'precise/button.tsx', 'export const Precise=1;');
  expect((await inspector.inspect('@zero/framework/ui/button', 'Button')).status).toBe('available');
  expect((await inspector.inspect('@zero/framework/ui/precise-button', 'Precise')).status).toBe('available');
  for (const path of ['ui/private', 'ui/private/secret', 'not-public', 'ui/button/../../secret']) {
    expect((await inspector.inspect('@zero/framework/' + path, 'Secret')).status).not.toBe('available');
  }
  expect(await inspector.inspect('@zero/framework/ui/private', 'Secret')).toEqual({ status: 'missing', reason: 'not-public' });
  expect(await inspector.inspect('@zero/framework/ui/private/secret', 'Secret')).toEqual({ status: 'missing', reason: 'not-public' });
  expect((await inspector.inspect('#zero/private', 'Secret')).status).toBe('missing');
}));

test('many symbols sharing literal barrel edges reuse admitted source resolution within the original inspection budget', async () => fixture(async root => {
  const count = 100;
  await write(root, 'index.ts', Array.from({ length: 20 }, (_, i) => `export * from './barrel-${i}';`).join('\n'));
  for (let i = 0; i < 20; i++) await write(root, `barrel-${i}.ts`, `export { ${Array.from({ length: count }, (_, n) => `Value${n}`).join(',')} } from './values';`);
  await write(root, 'values.ts', Array.from({ length: count }, (_, n) => `export const Value${n}=${n};`).join('\n'));
  const inspector = new SourceOnlyUpgradeExports(root, { '.': './index.ts' });
  for (let n = 0; n < count; n++) expect((await inspector.inspect('@zero/framework', `Value${n}`)).status).toBe('available');
  expect(inspector.complete).toBe(true);
  expect(inspector.records.size).toBe(22);
}));

test('unresolved, private, external, malformed, CommonJS and cyclic stars stay unknown', async () => fixture(async root => {
  const cases = {
    unresolved: `export * from './absent';`, external: `export * from 'custom-resolver';`,
    private: `export * from './.zero/private';`, env: `export * from './.env.fixture.ts';`,
    malformed: 'export const = broken;', commonjs: 'module.exports={ Existing:1 };', brackets: 'module["exports"]={ Existing:1 };',
    descriptors: 'Object.defineProperty(exports, "Existing", { value: 1 });', equal: 'export = Something;',
    cycle: `export * from './cycle-b';`,
  };
  for (const [name, source] of Object.entries(cases)) await write(root, `${name}.ts`, source);
  await write(root, '.zero/private.ts', 'export const Secret=1;');
  await write(root, '.env.fixture.ts', 'export const Secret=1;');
  await write(root, 'cycle-b.ts', `export * from './cycle';`);
  const inspector = new SourceOnlyUpgradeExports(root, Object.fromEntries(Object.keys(cases).map(name => ['./' + name, './' + name + '.ts'])));
  for (const name of Object.keys(cases)) expect((await inspector.inspect('@zero/framework/' + name, 'Absent')).status).toBe('unknown');
  expect([...inspector.records.keys()].some(path => path.includes('.env') || path.includes('.zero'))).toBe(false);
  // Independent simultaneous cycle queries must settle instead of waiting on each other's cached promises.
  const cyclic = new SourceOnlyUpgradeExports(root, { './a': './cycle.ts', './b': './cycle-b.ts' });
  expect((await Promise.all([cyclic.inspect('@zero/framework/a', 'X'), cyclic.inspect('@zero/framework/b', 'X')])).map(item => item.status)).toEqual(['unknown', 'unknown']);
}));

test('star ambiguity, identical origins, explicit priority and namespace exports preserve ESM behavior', async () => fixture(async root => {
  await write(root, 'a.ts', 'export const Shared=1; export default 1;');
  await write(root, 'b.ts', 'export const Shared=2;');
  await write(root, 'same.ts', `export { Shared } from './a';`);
  await write(root, 'ambiguous.ts', `export * from './a'; export * from './b';`);
  await write(root, 'identical.ts', `export * from './a'; export * from './same';`);
  await write(root, 'priority.ts', `export { Shared } from './a'; export * from './absent';`);
  await write(root, 'namespace.ts', `export * as PublicNamespace from './a';`);
  const inspector = new SourceOnlyUpgradeExports(root, Object.fromEntries(['ambiguous', 'identical', 'priority', 'namespace'].map(name => ['./' + name, './' + name + '.ts'])));
  expect(await inspector.inspect('@zero/framework/ambiguous', 'Shared')).toMatchObject({ status: 'unknown', reason: 'ambiguous-star' });
  expect((await inspector.inspect('@zero/framework/identical', 'Shared')).status).toBe('available');
  expect((await inspector.inspect('@zero/framework/priority', 'Shared')).status).toBe('available');
  expect((await inspector.inspect('@zero/framework/namespace', 'PublicNamespace')).status).toBe('available');
  expect((await inspector.inspect('@zero/framework/identical', 'default')).status).toBe('missing');
}));

test('conditional exports, unsupported arrays and absent export maps cannot invent an unconditional contract', async () => fixture(async root => {
  await write(root, 'runtime.ts', 'export const Shared=1; export const RuntimeOnly=1;');
  await write(root, 'types.d.ts', 'export declare const Shared: number; export interface Shape {}');
  const inspector = new SourceOnlyUpgradeExports(root, { '.': { types: './types.d.ts', import: './runtime.ts', require: './runtime.ts' },
    './array': ['./runtime.ts', './absent.ts'], './broken': { import: './runtime.ts', default: null } });
  expect((await inspector.inspect('@zero/framework', 'Shared')).status).toBe('available');
  expect((await inspector.inspect('@zero/framework', 'RuntimeOnly')).status).toBe('available');
  expect((await inspector.inspect('@zero/framework', 'Shape')).status).toBe('missing');
  expect((await inspector.inspect('@zero/framework', 'Shape', 'any')).status).toBe('available');
  expect((await inspector.inspect('@zero/framework/array', 'Absent')).status).toBe('unknown');
  expect((await inspector.inspect('@zero/framework/broken', 'Absent')).status).toBe('unknown');
  expect((await new SourceOnlyUpgradeExports(root, undefined).inspect('@zero/framework', 'Absent')).status).toBe('unknown');
  expect((await new SourceOnlyUpgradeExports(root, { '.': './runtime.ts', import: './runtime.ts' }).inspect('@zero/framework', 'Absent')).status).toBe('unknown');
}));

test('mixed ESM/CommonJS preserves literal named declarations but cannot prove other names missing', async () => fixture(async root => {
  await write(root, 'mixed.ts', 'export const Known=1; module.exports=unknownContract;');
  const inspector = new SourceOnlyUpgradeExports(root, { '.': './mixed.ts' });
  expect((await inspector.inspect('@zero/framework', 'Known')).status).toBe('available');
  expect((await inspector.inspect('@zero/framework', 'Absent')).status).toBe('unknown');
}));

test('declaration-only public targets prove type names but never a runtime implementation', async () => fixture(async root => {
  await write(root, 'types.d.ts', 'export declare const Declared: number; export interface Shape {}');
  await write(root, 'ambient.ts', 'export declare const Ambient: number;');
  const inspector = new SourceOnlyUpgradeExports(root, { '.': './types.d.ts', './ambient': './ambient.ts' });
  expect((await inspector.inspect('@zero/framework', 'Declared', 'any')).status).toBe('available');
  expect((await inspector.inspect('@zero/framework', 'Declared', 'value')).status).toBe('unknown');
  expect((await inspector.inspect('@zero/framework', 'Missing', 'value')).status).toBe('unknown');
  expect((await inspector.inspect('@zero/framework/ambient', 'Ambient', 'value')).status).toBe('unknown');
  expect((await inspector.inspect('@zero/framework/ambient', 'Ambient', 'any')).status).toBe('available');
  await write(root, 'namespaces.ts', `export * as Direct from './types.d.ts'; import * as Imported from './types.d.ts'; export { Imported };`);
  const namespaces = new SourceOnlyUpgradeExports(root, { '.': './namespaces.ts' });
  for (const name of ['Direct', 'Imported']) {
    expect((await namespaces.inspect('@zero/framework', name, 'value')).status).toBe('unknown');
    expect((await namespaces.inspect('@zero/framework', name, 'any')).status).toBe('available');
  }
}));

test('foreign separator literals require review rather than inspecting a different native path', async () => fixture(async root => {
  await write(root, 'src/value.ts', 'export const Value=1;');
  const inspector = new SourceOnlyUpgradeExports(root, { '.': './src\\value.ts' });
  expect((await inspector.inspect('@zero/framework', 'Value')).status).toBe('unknown'); expect(inspector.records.size).toBe(0);
}));

test('source symlinks admit only same-root source extensions, never env/data/private/outside aliases', async () => fixture(async root => {
  const outside = await mkdtemp(join(scratch, 'upgrade-export-outside-'));
  try {
    await write(root, 'valid.ts', 'export const Valid=1;');
    await symlink(join(root, 'valid.ts'), join(root, 'alias.ts'));
    const inspector = new SourceOnlyUpgradeExports(root, { './valid': './alias.ts' });
    expect((await inspector.inspect('@zero/framework/valid', 'Valid')).status).toBe('available');
    for (const target of ['.env', '.env.fixture.ts', 'fake-data.db', '.zero/private.ts']) {
      await write(root, target, 'export const PRIVATE_VALUE=1;');
      const alias = 'alias-' + target.replaceAll('/', '-').replaceAll('.', '-') + '.ts';
      await symlink(join(root, target), join(root, alias));
      const invalid = new SourceOnlyUpgradeExports(root, { '.': './' + alias });
      expect((await invalid.inspect('@zero/framework', 'Absent')).status).toBe('unknown'); expect(invalid.records.size).toBe(0);
    }
    await write(outside, 'outside.ts', 'export const Secret=1;');
    await symlink(join(outside, 'outside.ts'), join(root, 'outside-alias.ts'));
    const invalid = new SourceOnlyUpgradeExports(root, { '.': './outside-alias.ts' });
    expect((await invalid.inspect('@zero/framework', 'Absent')).status).toBe('unknown'); expect(invalid.records.size).toBe(0);
  } finally { await rm(outside, { recursive: true, force: true }); }
}));

test('oversized source and bounded deep export chains yield unknown, not missing', async () => fixture(async root => {
  await write(root, 'large.ts', '//'.padEnd(2_000_001, ' '));
  expect(await new SourceOnlyUpgradeExports(root, { '.': './large.ts' }).inspect('@zero/framework', 'Absent')).toMatchObject({ status: 'unknown', reason: 'inspection-limit' });
  for (let index = 0; index < 45; index++) await write(root, `${index}.ts`, `export * from './${index + 1}';`);
  await write(root, '45.ts', 'export const Deep=1;');
  expect(await new SourceOnlyUpgradeExports(root, { '.': './0.ts' }).inspect('@zero/framework', 'Deep')).toMatchObject({ status: 'unknown', reason: 'inspection-limit' });
}));
