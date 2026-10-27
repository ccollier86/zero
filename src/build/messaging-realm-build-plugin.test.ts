/** Source actors and the official bundled parent must retain identical complete realm/migration identities. */
import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { messagingRealm } from '../messaging/realm';
import { resolveMessagingConfig } from '../messaging/config';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { createMessagingRealmBuildPlugin } from './messaging-realm-build-plugin';

const ownedDirectories: string[] = [];
async function directory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix)); ownedDirectories.push(path); return path;
}
afterAll(async () => { for (const path of ownedDirectories) await rm(path, { recursive: true, force: true }); }, 20000);

test('official server bundling preserves every messaging migration and the full schema fingerprint', async () => {
  const output = await directory('messaging-canonical-build-');
  const result = await Bun.build({ entrypoints: [new URL('../messaging/realm.ts', import.meta.url).pathname], outdir: output, target: 'bun', format: 'esm',
    plugins: [await createMessagingRealmBuildPlugin()] });
  expect(result.success, result.logs.map(log => log.message).join('\n')).toBe(true);
  const bundled = (await import(result.outputs.find(output => output.kind === 'entry-point')!.path)).messagingRealm;
  expect(bundled.fingerprint).toBe(messagingRealm.fingerprint);
  expect(bundled.schemaChecksum).toBe(messagingRealm.schemaChecksum);
  expect(bundled.migrationChecksums).toEqual(messagingRealm.migrationChecksums);
  for (const migration of bundled.migrations) expect(Object.getOwnPropertyDescriptor(migration.up, 'toString')).toMatchObject({ writable: false, configurable: false });
}, 60000);

test('bundled default configuration resolves the retained matching source actor, never the main server entry', async () => {
  const output = await directory('messaging-actor-resolve-');
  const result = await Bun.build({ entrypoints: [new URL('../messaging/config.ts', import.meta.url).pathname], outdir: output, target: 'bun', format: 'esm',
    plugins: [await createMessagingRealmBuildPlugin()] });
  expect(result.success, result.logs.map(log => log.message).join('\n')).toBe(true);
  const bundled = await import(result.outputs.find(output => output.kind === 'entry-point')!.path);
  const auth = resolveAuthBehaviorConfig(), source = resolveMessagingConfig(true, process.cwd(), auth);
  const actual = bundled.resolveMessagingConfig(true, process.cwd(), auth);
  expect(source).not.toBe(false);
  expect(actual.defaultActorEntrypoint).toBe(source && source.defaultActorEntrypoint);
  expect(actual.defaultActorEntrypoint).toEndWith('/src/messaging/actor-entry.ts');
}, 60000);
