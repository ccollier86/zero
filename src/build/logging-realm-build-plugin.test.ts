/** Source and bundled parents retain identical canonical migrations; changed realm versions never compare equal. */
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loggingRealm } from '../logging/logging-realm';
import { createLoggingRealmBuildPlugin } from './logging-realm-build-plugin';

test('Bun server bundling preserves every source logging migration checksum and the complete realm identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logging-canonical-build-'));
  try {
    const entry = new URL('../logging/logging-realm.ts', import.meta.url).pathname;
    const result = await Bun.build({ entrypoints: [entry], outdir: directory, target: 'bun', format: 'esm', minify: false,
      plugins: [await createLoggingRealmBuildPlugin()] });
    expect(result.success, result.logs.map(log => log.message).join('\n')).toBe(true);
    const bundled = (await import(result.outputs.find(output => output.kind === 'entry-point')!.path)).loggingRealm;
    expect(bundled.fingerprint).toBe(loggingRealm.fingerprint);
    expect(bundled.migrationChecksums).toEqual(loggingRealm.migrationChecksums);
    expect(bundled.schemaChecksum).toBe(loggingRealm.schemaChecksum);
    expect(bundled.version).toBe(loggingRealm.version);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60000);
