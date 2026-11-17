/** A bundled parent must retain the exact migration identity of its dedicated source calendar actor. */
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface CalendarMigrationSource { readonly up: string; readonly down: string | null }
const ANCHOR = 'export const calendarRealm = defineDatabaseRealm({';

export async function createCalendarRealmBuildPlugin(): Promise<Bun.BunPlugin> {
  return createCalendarRealmBuildPluginForSource(fileURLToPath(new URL('../calendar/realm.ts', import.meta.url)));
}

/** @internal The source seam is build-owned, never a runtime/application configuration option. */
export async function createCalendarRealmBuildPluginForSource(sourcePath: string): Promise<Bun.BunPlugin> {
  if (/\/\$bunfs\//.test(import.meta.url)) throw new Error('Calendar realm snapshots require the source Bun build CLI.');
  const path = resolve(sourcePath);
  if (!/[/\\]calendar[/\\]realm\.ts$/.test(path)) throw new Error('Calendar realm build source path is invalid.');
  const source = await Bun.file(path).text();
  if (source.split(ANCHOR).length !== 2) throw new Error('Calendar realm build anchor is invalid.');
  // A fresh isolated source import is the cache boundary. Repeated builds must
  // not stamp a changed migration with an earlier cached module's source hash.
  const definitions = await readFreshCalendarMigrationSources(path, source);
  if (await Bun.file(path).text() !== source) throw new Error('Calendar realm source changed during build.');
  const contents = canonicalCalendarRealmSource(source, definitions);
  return { name: 'zero-canonical-calendar-migrations', setup(build) {
    build.onLoad({ filter: /[/\\]calendar[/\\]realm\.ts$/ }, async args => {
      if (resolve(args.path) !== path) return undefined;
      if (await Bun.file(path).text() !== source) throw new Error('Calendar realm source changed during build.');
      return { contents, loader: 'ts', resolveDir: dirname(path) };
    });
  } };
}

/** Pure transform seam; it does not build, open a file or start a helper process. */
export function canonicalCalendarRealmSource(source: string, definitions: Readonly<Record<string, CalendarMigrationSource>>): string {
  if (source.split(ANCHOR).length !== 2) throw new Error('Calendar realm build anchor is invalid.');
  return source.replace(ANCHOR, 'export const calendarRealm = __zeroDefineCanonicalCalendarRealm({') + `
function __zeroDefineCanonicalCalendarRealm(definition) {
  const sources = ${JSON.stringify(definitions)};
  if (definition.migrations.length !== Object.keys(sources).length) throw new Error('Calendar migration registry changed during build.');
  for (const migration of definition.migrations) {
    const source = sources[migration.version];
    if (!source || (migration.down !== undefined) !== (source.down !== null)) throw new Error('Calendar migration registry changed during build.');
    Object.defineProperty(migration.up, 'toString', { value: () => source.up, configurable: false, writable: false });
    if (migration.down) Object.defineProperty(migration.down, 'toString', { value: () => source.down, configurable: false, writable: false });
  }
  return defineDatabaseRealm(definition);
}
`;
}

async function readFreshCalendarMigrationSources(path: string, source: string): Promise<Record<string, CalendarMigrationSource>> {
  const sourceSha256 = createHash('sha256').update(source).digest('hex');
  const program = `
import { createHash } from 'node:crypto';
const path = ${JSON.stringify(path)}, expected = ${JSON.stringify(sourceSha256)};
const check = async () => {
  if (createHash('sha256').update(await Bun.file(path).text()).digest('hex') !== expected) throw new Error('Calendar realm snapshot source changed.');
};
await check();
const { calendarRealm } = await import(${JSON.stringify(pathToFileURL(path).href)});
await check();
const migrations = calendarRealm.migrations.map(migration => ({ version: migration.version, up: migration.up.toString(), down: migration.down?.toString() ?? null }));
process.stdout.write(JSON.stringify({ sourceSha256: expected, migrations }));
`;
  const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', program], {
    cwd: dirname(path), env: {}, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  });
  const stdout = child.stdout.getReader(), stderr = child.stderr.getReader();
  const capture = async (reader: ReadableStreamDefaultReader<Uint8Array>, maximum: number): Promise<string> => {
    let bytes = 0, output = ''; const decoder = new TextDecoder();
    try {
      while (true) {
        const next = await reader.read(); if (next.done) return output + decoder.decode();
        bytes += next.value.byteLength;
        if (bytes > maximum) throw new Error('Calendar realm snapshot output exceeded its bound.');
        output += decoder.decode(next.value, { stream: true });
      }
    } finally { reader.releaseLock(); }
  };
  const output = capture(stdout, 1_048_576), errors = capture(stderr, 4_096);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const [code, text] = await Promise.race([
      Promise.all([child.exited, output, errors]),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Calendar realm snapshot timed out.')), 30_000); }),
    ]);
    if (code !== 0) throw new Error('Calendar realm snapshot child failed.');
    const snapshot = JSON.parse(text) as { sourceSha256?: unknown; migrations?: unknown };
    if (snapshot.sourceSha256 !== sourceSha256 || !Array.isArray(snapshot.migrations)
      || snapshot.migrations.length < 1 || snapshot.migrations.length > 256) throw new Error('Calendar realm snapshot is invalid.');
    const definitions: Record<string, CalendarMigrationSource> = Object.create(null);
    for (const entry of snapshot.migrations) {
      if (!entry || typeof entry !== 'object' || Object.keys(entry).sort().join(',') !== 'down,up,version'
        || typeof entry.version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(entry.version)
        || Object.hasOwn(definitions, entry.version) || typeof entry.up !== 'string' || entry.up.length < 1 || entry.up.length > 262_144
        || entry.down !== null && (typeof entry.down !== 'string' || entry.down.length < 1 || entry.down.length > 262_144)) throw new Error('Calendar realm snapshot migration is invalid.');
      definitions[entry.version] = { up: entry.up, down: entry.down };
    }
    return definitions;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill('SIGKILL');
    let retirementTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([child.exited, Promise.allSettled([stdout.cancel(), stderr.cancel(), output, errors])]),
        new Promise<never>((_, reject) => { retirementTimer = setTimeout(() => reject(new Error('Calendar realm snapshot child retirement was not confirmed.')), 5_000); }),
      ]);
    } finally { clearTimeout(retirementTimer); }
  }
}
