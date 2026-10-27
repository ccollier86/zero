/** Preserve exact source migration identities for bundled parents and retained, matching source messaging actors. */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
export async function createMessagingRealmBuildPlugin(): Promise<Bun.BunPlugin> {
  const path = fileURLToPath(new URL('../messaging/realm.ts', import.meta.url)), source = await Bun.file(path).text();
  const { messagingRealm } = await import(pathToFileURL(path).href) as typeof import('../messaging/realm');
  const definitions = Object.fromEntries(messagingRealm.migrations.map(migration => [migration.version, { up: migration.up.toString(), down: migration.down?.toString() ?? null }]));
  const injected = `
function __zeroDefineCanonicalMessagingRealm(definition: Parameters<typeof defineDatabaseRealm>[0]) {
  const sources = ${JSON.stringify(definitions)};
  if (definition.migrations.length !== Object.keys(sources).length) throw new Error('Messaging migration registry changed during build.');
  for (const migration of definition.migrations) {
    const source = sources[migration.version];
    if (!source || (migration.down !== undefined) !== (source.down !== null)) throw new Error('Messaging migration registry changed during build.');
    Object.defineProperty(migration.up, 'toString', { value: () => source.up, configurable: false, writable: false });
    if (migration.down) Object.defineProperty(migration.down, 'toString', { value: () => source.down, configurable: false, writable: false });
  }
  return defineDatabaseRealm(definition);
}
`;
  return { name: 'zero-canonical-messaging-migrations', setup(build) {
    build.onLoad({ filter: /[/\\]messaging[/\\]realm\.ts$/ }, async args => {
      if (resolve(args.path) !== resolve(path)) return undefined;
      if (await Bun.file(path).text() !== source) throw new Error('Messaging realm source changed during build.');
      const anchor = 'export const messagingRealm = defineDatabaseRealm({';
      if (source.split(anchor).length !== 2) throw new Error('Messaging realm build anchor is invalid.');
      return { contents: source.replace(anchor, 'export const messagingRealm = __zeroDefineCanonicalMessagingRealm({') + injected, loader: 'ts', resolveDir: dirname(path) };
    });
  } };
}
