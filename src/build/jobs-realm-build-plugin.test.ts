/** Official bundled parents and retained source jobs actors must agree without weakening any realm check. */
import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { jobsRealm } from '../jobs/realm';
import { resolveJobsPersistenceConfig } from '../jobs/persistence-config';
import { ownedWorkerFixture } from '../workers/test-support/owned-fixture';
import { createJobsRealmBuildPlugin, createJobsRealmBuildPluginForSource } from './jobs-realm-build-plugin';

for (const minify of [false, true]) test(`server bundling preserves exact jobs migrations and the complete realm identity (minify=${minify})`, async () => {
  const fixture = await ownedWorkerFixture('jobs-canonical-build');
  try {
    const result = await Bun.build({ entrypoints: [new URL('../jobs/realm.ts', import.meta.url).pathname], outdir: fixture.root,
      target: 'bun', format: 'esm', minify, plugins: [await createJobsRealmBuildPlugin()] });
    expect(result.success, result.logs.map(log => log.message).join('\n')).toBe(true);
    const bundled = (await import(result.outputs.find(output => output.kind === 'entry-point')!.path)).jobsRealm;
    expect(bundled.fingerprint).toBe(jobsRealm.fingerprint);
    expect(bundled.schemaChecksum).toBe(jobsRealm.schemaChecksum);
    expect(bundled.migrationChecksums).toEqual(jobsRealm.migrationChecksums);
    expect(bundled.version).toBe(jobsRealm.version);
    for (const [index, migration] of bundled.migrations.entries()) {
      expect(migration.up.toString()).toBe(jobsRealm.migrations[index]!.up.toString());
      expect(Object.getOwnPropertyDescriptor(migration.up, 'toString')).toMatchObject({ writable: false, configurable: false });
    }
  } finally { await fixture.cleanup(); }
}, 60_000);

test('repeated jobs builds cannot stamp changed migration code with a cached source checksum', async () => {
  const fixture = await ownedWorkerFixture('jobs-build-snapshot');
  try {
    const sourcePath = join(fixture.root, 'jobs/realm.ts');
    await mkdir(join(fixture.root, 'jobs'));
    const definition = (generation: string) => `
import { defineDatabaseRealm } from ${JSON.stringify(new URL('../databases/database-realm.ts', import.meta.url).pathname)};
export const jobsRealm = defineDatabaseRealm({
  name: 'synthetic-jobs-snapshot', version: '1', tables: { marks: { id: 'TEXT PRIMARY KEY' } },
  migrations: [{ version: '001', description: 'Owned snapshot regression', up(database) { database.run(${JSON.stringify('SELECT ' + generation)}); } }],
});
`;
    await writeFile(sourcePath, definition('first'));
    // Mirror a builder whose config or earlier build already imported this path.
    const cached = (await import(pathToFileURL(sourcePath).href)).jobsRealm as typeof jobsRealm;
    const build = async (generation: string) => {
      const result = await Bun.build({ entrypoints: [sourcePath], outdir: join(fixture.root, generation),
        target: 'bun', format: 'esm', minify: true, plugins: [await createJobsRealmBuildPluginForSource(sourcePath)] });
      expect(result.success, result.logs.map(log => log.message).join('\n')).toBe(true);
      return (await import(result.outputs.find(output => output.kind === 'entry-point')!.path)).jobsRealm as typeof jobsRealm;
    };
    const first = await build('first');
    expect(first.migrationChecksums).toEqual(cached.migrationChecksums);
    await writeFile(sourcePath, definition('second'));
    const second = await build('second');
    expect(second.migrationChecksums).not.toEqual(first.migrationChecksums);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(second.migrations[0]!.up.toString()).toContain('SELECT second');
    const executed: string[] = [];
    await second.migrations[0]!.up({ run(statement: string) { executed.push(statement); } } as never);
    expect(executed).toEqual(['SELECT second']);
  } finally { await fixture.cleanup(); }
}, 60_000);

test('jobs source snapshots neither inherit the parent environment nor load local dotenv', async () => {
  const fixture = await ownedWorkerFixture('jobs-build-environment');
  try {
    const directory = join(fixture.root, 'jobs'), sourcePath = join(directory, 'realm.ts');
    await mkdir(directory);
    await writeFile(join(directory, '.env'), 'ZERO_JOBS_SNAPSHOT_DOTENV=synthetic-private-value\n');
    await writeFile(sourcePath, `
if (process.env.PATH !== undefined || process.env.ZERO_JOBS_SNAPSHOT_DOTENV !== undefined) throw new Error('Snapshot environment was not isolated.');
function defineDatabaseRealm(definition) { return definition; }
export const jobsRealm = defineDatabaseRealm({ migrations: [{ version: '001', up() {} }] });
`);
    expect((await createJobsRealmBuildPluginForSource(sourcePath)).name).toBe('zero-canonical-jobs-migrations');
  } finally { await fixture.cleanup(); }
}, 60_000);

test('bundled jobs configuration resolves the retained matching source actor rather than the main app', async () => {
  const fixture = await ownedWorkerFixture('jobs-actor-resolve');
  try {
    const result = await Bun.build({ entrypoints: [new URL('../jobs/persistence-config.ts', import.meta.url).pathname], outdir: fixture.root,
      target: 'bun', format: 'esm', plugins: [await createJobsRealmBuildPlugin()] });
    expect(result.success, result.logs.map(log => log.message).join('\n')).toBe(true);
    const bundled = await import(result.outputs.find(output => output.kind === 'entry-point')!.path);
    const source = resolveJobsPersistenceConfig({}, process.cwd());
    const actual = bundled.resolveJobsPersistenceConfig({}, process.cwd());
    expect(actual.defaultActorEntrypoint).toBe(source.defaultActorEntrypoint);
    expect(actual.defaultActorEntrypoint).toEndWith('/src/jobs/actor-entry.ts');
  } finally { await fixture.cleanup(); }
}, 60_000);
