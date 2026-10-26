/** A bundled parent and retained source actor must agree on the complete content realm, not a weakened migration check. */
import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { blogContentRealm } from '../blog/content-realm';
import { createBlogRealmBuildPlugin } from './blog-realm-build-plugin';
import { resolveBlogContentConfig } from '../blog/content-config';

test('official Bun server bundling preserves canonical source blog migration and schema identity', async () => {
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/blog-canonical-build-');
  const result = await Bun.build({ entrypoints: [new URL('../blog/content-realm.ts', import.meta.url).pathname], outdir: directory, target: 'bun', format: 'esm',
    plugins: [await createBlogRealmBuildPlugin()] });
  expect(result.success, result.logs.map(log => log.message).join('\n')).toBe(true);
  const bundled = (await import(result.outputs.find(output => output.kind === 'entry-point')!.path)).blogContentRealm;
  expect(bundled.fingerprint).toBe(blogContentRealm.fingerprint);
  expect(bundled.schemaChecksum).toBe(blogContentRealm.schemaChecksum);
  expect(bundled.migrationChecksums).toEqual(blogContentRealm.migrationChecksums);
  expect(Object.getOwnPropertyDescriptor(bundled.migrations[0].up, 'toString')).toMatchObject({ writable: false, configurable: false });
}, 60000);

test('bundled default configuration selects the installed source actor rather than booting the main app', async () => {
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/blog-actor-resolve-');
  const result = await Bun.build({ entrypoints: [new URL('../blog/content-config.ts', import.meta.url).pathname], outdir: directory, target: 'bun', format: 'esm',
    plugins: [await createBlogRealmBuildPlugin()] });
  expect(result.success, result.logs.map(log => log.message).join('\n')).toBe(true);
  const bundled = await import(result.outputs.find(output => output.kind === 'entry-point')!.path);
  const actual = bundled.resolveBlogContentConfig(true, process.cwd());
  const source = resolveBlogContentConfig(true, process.cwd());
  expect(source).not.toBe(false);
  expect(actual.defaultActorEntrypoint).toBe(source && source.defaultActorEntrypoint);
  expect(actual.defaultActorEntrypoint).toEndWith('/src/blog/content-actor-entry.ts');
}, 60000);
