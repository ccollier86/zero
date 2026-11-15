/** Preserve exact source migration identities for bundled parents and retained, matching source jobs actors. */
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Build-owned source snapshots only. Runtime fingerprints and stored migration checks remain authoritative. */
export async function createJobsRealmBuildPlugin(): Promise<Bun.BunPlugin> {
  return createJobsRealmBuildPluginForSource(fileURLToPath(new URL('../jobs/realm.ts', import.meta.url)));
}

/** @internal Separate source seam for owned synthetic build fixtures, not an application option. */
export async function createJobsRealmBuildPluginForSource(sourcePath: string): Promise<Bun.BunPlugin> {
  // A compiled app executable cannot serve as Bun's --eval build-time helper.
  // Source CLI builds may still produce compiled applications as usual.
  if (/\/\$bunfs\//.test(import.meta.url)) throw new Error('Jobs realm source snapshots require the source Bun build CLI, not a compiled application.');
  const path = resolve(sourcePath);
  if (!/[/\\]jobs[/\\]realm\.ts$/.test(path)) throw new Error('Jobs realm build source path is invalid.');
  const source = await Bun.file(path).text(), anchor = 'export const jobsRealm = defineDatabaseRealm({';
  if (source.split(anchor).length !== 2) throw new Error('Jobs realm build anchor is invalid.');
  // Bun caches physical modules even when their URL query changes. A fresh,
  // pure-import child is the cache boundary; never stamp new code with hashes
  // from a realm cached by an earlier build/config import in this process.
  const definitions = await readFreshMigrationSources(path, source);
  if (await Bun.file(path).text() !== source) throw new Error('Jobs realm source changed during build.');
  const injected = `
function __zeroDefineCanonicalJobsRealm(definition: Parameters<typeof defineDatabaseRealm>[0]) {
  const sources = ${JSON.stringify(definitions)};
  if (definition.migrations.length !== Object.keys(sources).length) throw new Error('Jobs migration registry changed during build.');
  for (const migration of definition.migrations) {
    const source = sources[migration.version];
    if (!source || (migration.down !== undefined) !== (source.down !== null)) throw new Error('Jobs migration registry changed during build.');
    Object.defineProperty(migration.up, 'toString', { value: () => source.up, configurable: false, writable: false });
    if (migration.down) Object.defineProperty(migration.down, 'toString', { value: () => source.down, configurable: false, writable: false });
  }
  return defineDatabaseRealm(definition);
}
`;
  return { name: 'zero-canonical-jobs-migrations', setup(build) {
    build.onLoad({ filter: /[/\\]jobs[/\\]realm\.ts$/ }, async args => {
      if (resolve(args.path) !== resolve(path)) return undefined;
      if (await Bun.file(path).text() !== source) throw new Error('Jobs realm source changed during build.');
      return { contents: source.replace(anchor, 'export const jobsRealm = __zeroDefineCanonicalJobsRealm({') + injected,
        loader: 'ts', resolveDir: dirname(path) };
    });
  } };
}

interface MigrationSource { version: string; up: string; down: string | null }
async function readFreshMigrationSources(path: string, source: string): Promise<Record<string, Omit<MigrationSource, 'version'>>> {
  const sourceSha256 = createHash('sha256').update(source).digest('hex');
  const program = `
import { createHash } from 'node:crypto';
const path = ${JSON.stringify(path)}, expected = ${JSON.stringify(sourceSha256)};
const check = async () => {
  if (createHash('sha256').update(await Bun.file(path).text()).digest('hex') !== expected) throw new Error('Jobs realm snapshot source changed.');
};
await check();
const { jobsRealm } = await import(${JSON.stringify(pathToFileURL(path).href)});
await check();
const migrations = jobsRealm.migrations.map(migration => ({ version: migration.version, up: migration.up.toString(), down: migration.down?.toString() ?? null }));
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
        if (bytes > maximum) throw new Error('Jobs realm snapshot output exceeded its bound.');
        output += decoder.decode(next.value, { stream: true });
      }
    } finally { reader.releaseLock(); }
  };
  const output = capture(stdout, 1_048_576), errors = capture(stderr, 4_096);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const [code, text] = await Promise.race([
      Promise.all([child.exited, output, errors]),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Jobs realm snapshot timed out.')), 30_000); }),
    ]);
    if (code !== 0) throw new Error('Jobs realm snapshot child failed.');
    const snapshot = JSON.parse(text) as { sourceSha256?: unknown; migrations?: unknown };
    if (snapshot.sourceSha256 !== sourceSha256 || !Array.isArray(snapshot.migrations)
      || snapshot.migrations.length < 1 || snapshot.migrations.length > 256) throw new Error('Jobs realm snapshot is invalid.');
    const definitions: Record<string, Omit<MigrationSource, 'version'>> = Object.create(null);
    for (const entry of snapshot.migrations) {
      if (!entry || typeof entry !== 'object' || Object.keys(entry).sort().join(',') !== 'down,up,version'
        || typeof entry.version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(entry.version)
        || Object.hasOwn(definitions, entry.version) || typeof entry.up !== 'string' || entry.up.length < 1 || entry.up.length > 262_144
        || entry.down !== null && (typeof entry.down !== 'string' || entry.down.length < 1 || entry.down.length > 262_144)) throw new Error('Jobs realm snapshot migration is invalid.');
      definitions[entry.version] = { up: entry.up, down: entry.down };
    }
    return definitions;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill('SIGKILL');
    let retirementTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Cancel pending pipe reads too: an error must not retain capture handles
      // after the exact child exits. Rejections were already observed above.
      await Promise.race([
        Promise.all([child.exited, Promise.allSettled([stdout.cancel(), stderr.cancel(), output, errors])]),
        new Promise<never>((_, reject) => { retirementTimer = setTimeout(() => reject(new Error('Jobs realm snapshot child retirement was not confirmed.')), 5_000); }),
      ]);
    } finally { clearTimeout(retirementTimer); }
  }
}
