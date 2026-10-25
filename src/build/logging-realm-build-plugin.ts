/** Preserve canonical source migration identities when the managed server and its retained source actors share a package. */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Build-time only. No runtime filesystem dependency or actor/schema fingerprint bypass is introduced. */
export async function createLoggingRealmBuildPlugin(): Promise<Bun.BunPlugin> {
  const path = fileURLToPath(new URL('../logging/logging-realm.ts', import.meta.url));
  const source = await Bun.file(path).text();
  const { loggingRealm } = await import(pathToFileURL(path).href) as typeof import('../logging/logging-realm');
  const definitions = Object.fromEntries(loggingRealm.migrations.map(migration => [migration.version, {
    up: migration.up.toString(), down: migration.down?.toString() ?? null,
  }]));
  const injected = `
// The build owns these exact source definitions. Migration checksums keep
// using their original source, not Bun's renamed/formatted bundle functions.
// Actors must still match the complete realm/schema/migration fingerprint.
function __zeroDefineCanonicalLoggingRealm(definition: Parameters<typeof defineDatabaseRealm>[0]) {
  const sources = ${JSON.stringify(definitions)};
  if (definition.migrations.length !== Object.keys(sources).length) throw new Error('Logging build migration registry changed.');
  for (const migration of definition.migrations) {
    const source = sources[migration.version];
    if (!source || (migration.down !== undefined) !== (source.down !== null)) throw new Error('Logging build migration registry changed.');
    Object.defineProperty(migration.up, 'toString', { value: () => source.up, configurable: false, writable: false });
    if (migration.down) Object.defineProperty(migration.down, 'toString', { value: () => source.down, configurable: false, writable: false });
  }
  return defineDatabaseRealm(definition);
}
`;
  return {
    name: 'zero-canonical-logging-migrations',
    setup(build) {
      build.onLoad({ filter: /[/\\]logging[/\\]logging-realm\.ts$/ }, async args => {
        if (resolve(args.path) !== resolve(path)) return undefined;
        if (await Bun.file(path).text() !== source) throw new Error('Logging realm source changed during the build.');
        const anchor = 'export const loggingRealm = defineDatabaseRealm({';
        if (source.split(anchor).length !== 2) throw new Error('Logging realm build anchor is invalid.');
        return { contents: source.replace(anchor, 'export const loggingRealm = __zeroDefineCanonicalLoggingRealm({') + injected,
          loader: 'ts', resolveDir: dirname(path) };
      });
    },
  };
}
