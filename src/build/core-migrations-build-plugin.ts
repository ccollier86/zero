/** Preserve framework migration source identity across source setup and the official server bundle. */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Build-owned source snapshots only; stored checksums and runtime validation are never changed or bypassed. */
export async function createCoreMigrationsBuildPlugin(): Promise<Bun.BunPlugin> {
  const path = fileURLToPath(new URL('../migrations/index.ts', import.meta.url));
  const sources = new Map<string, string>([[resolve(path), await Bun.file(path).text()]]);
  const definitions = join(dirname(path), 'definitions');
  for (const name of new Bun.Glob('*.ts').scanSync({ cwd: definitions })) {
    const file = resolve(definitions, name); sources.set(file, await Bun.file(file).text());
  }
  const { migrations } = await import(pathToFileURL(path).href) as typeof import('../migrations');
  const canonical = Object.fromEntries(migrations.map(migration => [migration.version, {
    description: migration.description, safety: migration.safety ?? 'safe', backupRequired: migration.backupRequired ?? false,
    up: migration.up.toString(), down: migration.down?.toString() ?? null,
  }]));
  const injected = `
// Exact trusted source definitions from this installed build. These are not
// replacement checksums, legacy aliases or permission to rewrite a ledger.
const __zeroCoreMigrationSources = ${JSON.stringify(canonical)};
if (migrations.length !== Object.keys(__zeroCoreMigrationSources).length) throw new Error('Core build migration registry changed.');
for (const migration of migrations) {
  const source = __zeroCoreMigrationSources[migration.version];
  if (!source || migration.description !== source.description || (migration.safety ?? 'safe') !== source.safety
    || (migration.backupRequired ?? false) !== source.backupRequired
    || (migration.down !== undefined) !== (source.down !== null)) throw new Error('Core build migration registry changed.');
  Object.defineProperty(migration.up, 'toString', { value: () => source.up, configurable: false, writable: false });
  if (migration.down) Object.defineProperty(migration.down, 'toString', { value: () => source.down, configurable: false, writable: false });
}
`;
  return {
    name: 'zero-canonical-core-migrations',
    setup(build) {
      build.onLoad({ filter: /[/\\]migrations[/\\](?:index\.ts|definitions[/\\][^/\\]+\.ts)$/ }, async args => {
        const file = resolve(args.path), original = sources.get(file);
        if (original === undefined) return undefined;
        if (await Bun.file(file).text() !== original) throw new Error('Core migration source changed during the build.');
        return { contents: original + (file === resolve(path) ? injected : ''), loader: 'ts', resolveDir: dirname(file) };
      });
    },
  };
}
