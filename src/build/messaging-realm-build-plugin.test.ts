/** Source actors and the official bundled parent must retain identical complete realm/migration identities. */
import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { messagingRealm } from '../messaging/realm';
import { resolveMessagingConfig } from '../messaging/config';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { createMessagingRealmBuildPlugin } from './messaging-realm-build-plugin';

test('official server bundling preserves every messaging migration and the full schema fingerprint', async () => {
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/messaging-canonical-build-');
  const result = await Bun.build({ entrypoints: [new URL('../messaging/realm.ts', import.meta.url).pathname], outdir: directory, target: 'bun', format: 'esm',
    plugins: [await createMessagingRealmBuildPlugin()] });
  expect(result.success, result.logs.map(log => log.message).join('\n')).toBe(true);
  const bundled = (await import(result.outputs.find(output => output.kind === 'entry-point')!.path)).messagingRealm;
  expect(bundled.fingerprint).toBe(messagingRealm.fingerprint);
  expect(bundled.schemaChecksum).toBe(messagingRealm.schemaChecksum);
  expect(bundled.migrationChecksums).toEqual(messagingRealm.migrationChecksums);
  for (const migration of bundled.migrations) expect(Object.getOwnPropertyDescriptor(migration.up, 'toString')).toMatchObject({ writable: false, configurable: false });
}, 60000);

test('bundled default configuration resolves the retained matching source actor, never the main server entry', async () => {
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/messaging-actor-resolve-');
  const result = await Bun.build({ entrypoints: [new URL('../messaging/config.ts', import.meta.url).pathname], outdir: directory, target: 'bun', format: 'esm',
    plugins: [await createMessagingRealmBuildPlugin()] });
  expect(result.success, result.logs.map(log => log.message).join('\n')).toBe(true);
  const bundled = await import(result.outputs.find(output => output.kind === 'entry-point')!.path);
  const auth = resolveAuthBehaviorConfig(), source = resolveMessagingConfig(true, process.cwd(), auth);
  const actual = bundled.resolveMessagingConfig(true, process.cwd(), auth);
  expect(source).not.toBe(false);
  expect(actual.defaultActorEntrypoint).toBe(source && source.defaultActorEntrypoint);
  expect(actual.defaultActorEntrypoint).toEndWith('/src/messaging/actor-entry.ts');
}, 60000);
