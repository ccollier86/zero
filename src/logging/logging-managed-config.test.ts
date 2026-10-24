import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveManagedLoggingConfig } from './logging-managed-config';
import { assertLoggingDirectoryIsolation } from './logging-directory-isolation';

test('managed logging is opt-in, detached and rooted in the immutable project directory', () => {
  expect(resolveManagedLoggingConfig(undefined, '/project')).toBe(false);
  expect(resolveManagedLoggingConfig(false, '/project')).toBe(false);
  const config = resolveManagedLoggingConfig(true, '/project');
  expect(config && config.rootDirectory).toBe('/project/data/zero.logs');
  expect(config && config.policy.enabled).toBe(true);
  const input = { rootDirectory: 'logs', queue: { batchSize: 2 } };
  const normalized = resolveManagedLoggingConfig(input, '/project'); input.rootDirectory = 'different'; input.queue.batchSize = 9;
  expect(normalized && normalized.rootDirectory).toBe('/project/logs');
  expect(normalized && normalized.policy.queue.batchSize).toBe(2);
});

test('managed configuration rejects premature compliance, accessors, unknown fields and unsafe actor environments', () => {
  expect(() => resolveManagedLoggingConfig({ preset: 'compliance' }, '/project')).toThrow(expect.objectContaining({ code: 'LOGGING_NOT_READY' }));
  for (const input of [null, { rootDirectory: '' }, { rootDirectory: 'x\0y' }, { extra: true }, { actors: { launch: { kind: 'source', entrypoint: '/actor.ts' }, env: { INVALID: 42 } } }]) {
    expect(() => resolveManagedLoggingConfig(input as any, '/project')).toThrow(expect.objectContaining({ code: 'LOGGING_CONFIG_INVALID' }));
  }
  let invoked = false;
  expect(() => resolveManagedLoggingConfig({ get rootDirectory() { invoked = true; return 'logs'; } }, '/project')).toThrow();
  expect(invoked).toBe(false);
});

test('logging directory admission protects build, sources, private artifacts, application/control files and other Fabric roots', () => {
  const base = { rootDirectory: '/project/logs', outDir: '/project/build', storageDir: '/project/storage',
    generatedDir: '/project/generated', appDir: '/project/app', applicationFabricRoot: '/project/fabric', controlDatabasePaths: ['/project/data/app.db', '/project/control/system.db'] };
  expect(() => assertLoggingDirectoryIsolation(base)).not.toThrow();
  for (const rootDirectory of ['/project', '/project/build/logs', '/project/build', '/project/storage', '/project/storage/tmp/logs', '/project/storage/blobs/logs',
    '/project/generated/logs', '/project/app/logs', '/project/fabric/logs', '/project/data', '/project/control']) {
    expect(() => assertLoggingDirectoryIsolation({ ...base, rootDirectory })).toThrow(expect.objectContaining({ code: 'LOGGING_CONFIG_INVALID' }));
  }
});

test('canonical admission catches symlink aliases before creating a logging directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-isolation-'));
  try {
    await mkdir(join(root, 'build')); await symlink(join(root, 'build'), join(root, 'alias'));
    expect(() => assertLoggingDirectoryIsolation({ rootDirectory: join(root, 'alias', 'logs'), outDir: join(root, 'build'), storageDir: join(root, 'storage'),
      generatedDir: join(root, 'generated'), appDir: join(root, 'app'), controlDatabasePaths: [] }, true)).toThrow(expect.objectContaining({ code: 'LOGGING_CONFIG_INVALID' }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
