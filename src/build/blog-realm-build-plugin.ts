/** Build-only canonical migration definitions for matching bundled parent and retained source Blog actors. */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
/** Preserve exact source identities; neither runtime fingerprints nor migration checks are bypassed. */
export async function createBlogRealmBuildPlugin(): Promise<Bun.BunPlugin> {
  const path = fileURLToPath(new URL('../blog/content-realm.ts', import.meta.url)), source = await Bun.file(path).text();
  const { blogContentRealm } = await import(pathToFileURL(path).href) as typeof import('../blog/content-realm');
  const definitions = Object.fromEntries(blogContentRealm.migrations.map(migration => [migration.version, { up: migration.up.toString(), down: migration.down?.toString() ?? null }]));
  const injected = `
function __zeroDefineCanonicalBlogRealm(definition: Parameters<typeof defineDatabaseRealm>[0]) {
  const sources = ${JSON.stringify(definitions)};
  if (definition.migrations.length !== Object.keys(sources).length) throw new Error('Blog migration registry changed during build.');
  for (const migration of definition.migrations) {
    const source = sources[migration.version];
    if (!source || (migration.down !== undefined) !== (source.down !== null)) throw new Error('Blog migration registry changed during build.');
    Object.defineProperty(migration.up, 'toString', { value: () => source.up, configurable: false, writable: false });
    if (migration.down) Object.defineProperty(migration.down, 'toString', { value: () => source.down, configurable: false, writable: false });
  }
  return defineDatabaseRealm(definition);
}
`;
  return { name: 'zero-canonical-blog-migrations', setup(build) {
    build.onLoad({ filter: /[/\\]blog[/\\]content-realm\.ts$/ }, async args => {
      if (resolve(args.path) !== resolve(path)) return undefined;
      if (await Bun.file(path).text() !== source) throw new Error('Blog realm source changed during build.');
      const anchor = 'export const blogContentRealm = defineDatabaseRealm({';
      if (source.split(anchor).length !== 2) throw new Error('Blog realm build anchor is invalid.');
      return { contents: source.replace(anchor, 'export const blogContentRealm = __zeroDefineCanonicalBlogRealm({') + injected, loader: 'ts', resolveDir: dirname(path) };
    });
  } };
}
