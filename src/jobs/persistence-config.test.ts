/** Pure launch/config admission: owned marker only, no job database, actor, app or provider starts. */
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolveJobsPersistenceConfig, type JobsPersistenceConfig } from './persistence-config';
import { databaseActorFactoryLaunch } from '../databases/subprocess-database-executor-factory';
import { ownedWorkerFixture } from '../workers/test-support/owned-fixture';

test('private persistence resolution uses bounded max I/O concurrency and an empty dedicated actor environment without opening state', async () => {
  const fixture = await ownedWorkerFixture('jobs-config');
  try {
    const config = resolveJobsPersistenceConfig({}, fixture.root), launch = databaseActorFactoryLaunch(config.createExecutor)!;
    expect(config.concurrency).toBe(100); expect(config.maxActiveDatabases).toBe(4);
    expect(existsSync(config.rootDirectory)).toBe(false); expect(launch.env).toEqual({});
    expect(launch.prefix).toContain('--no-env-file'); expect(launch.prefix.at(-1)).toEndWith('/jobs/actor-entry.ts');
    for (const input of [{ concurrency: 0 }, { concurrency: 101 }, { maxActiveDatabases: 4, maxDatabaseFiles: 2 }, { rootDirectory: '' },
      { rootDirectory: 'PRIVATE_PATH\0' }, { actors: { launch: { kind: 'source', entrypoint: '/synthetic.ts' }, actorFlag: '--different' } }]) {
      let error: unknown; try { resolveJobsPersistenceConfig(input as JobsPersistenceConfig, fixture.root); } catch (caught) { error = caught; }
      expect(error).toMatchObject({ code: 'JOBS_CONFIG_INVALID' }); expect(String(error)).not.toContain('PRIVATE_PATH');
    }
  } finally { await fixture.cleanup(); }
});
