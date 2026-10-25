/** preparation.test.ts: exercises migration-preparation guards against synthetic source and disposable SQLite only. */
import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { captureSource, compareSource, sourceBaseline } from './source-guard';
import { compareTables, inspectOfflineSQLite } from './offline-sqlite';
import { initializeRehearsal, readReport, rehearsal, writeReport } from './safety';
import { run } from './run';

const owned: string[] = [];
afterEach(() => { for (const root of owned.splice(0)) rmSync(root, { recursive: true, force: true }); });
const hash = (bytes: string | Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

/** Fresh source repository and a sibling private evidence workspace. */
function fixture() {
  const root = mkdtempSync(join(process.env.PROJECT_SCRATCH_DIR ?? tmpdir(), 'piq-upgrade-guards-')); owned.push(root);
  const project = join(root, 'project'); mkdirSync(project);
  const put = (path: string, content: string) => { const target = join(project, path); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, content); };
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', '-c', 'user.name=Zero Fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd: project, stdout: 'pipe', stderr: 'pipe' });
    if (result.exitCode) throw new Error('Synthetic Git command failed');
  };
  const release = (commit = 'a'.repeat(40), content = 'synthetic old archive') => {
    put('.zero/framework/zero-framework.tgz', content);
    const sha256 = hash(content); put('zero-release.json', JSON.stringify({ schema: 1, version: '1.3.0-piq.1', source: 'refs/heads/main', commit, sha256 }));
    return { commit, sha256 };
  };
  put('package.json', JSON.stringify({ private: true, dependencies: { '@zero/framework': 'file:./.zero/framework/zero-framework.tgz' } }));
  put('zero.config.ts', 'throw new Error("A source check must never evaluate app config");');
  put('bun.lock', 'synthetic lock');
  put('app/layout.tsx', 'synthetic root layout');
  put('lib/public-site/public-site-styles.ts', 'synthetic custom public colors');
  put('server/handler.ts', 'synthetic handler');
  put('db/migrations/2026102003_history.ts', 'immutable synthetic historical migration');
  put('.env.private', 'synthetic-secret-must-not-be-read');
  put('data/private.db', 'synthetic-data-must-not-be-read');
  const initial = release();
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'Synthetic fixture');
  const work = initializeRehearsal(project, join(root, 'rehearsal'));
  return { root, project, work, put, release, initial, git };
}

test('source baseline verifies the old archive without evaluating config or inventorying dotenv/runtime data', async () => {
  const f = fixture(), before = await captureSource(f.project);
  expect(before.release).toMatchObject(f.initial);
  expect(before.files.map(file => file.path)).toContain('zero.config.ts');
  expect(before.files.map(file => file.path)).not.toContain('.env.private');
  expect(before.files.map(file => file.path)).not.toContain('data/private.db');
  expect(JSON.stringify(before)).not.toContain('synthetic-secret-must-not-be-read');
  f.put('server/untracked.ts', 'uncommitted source');
  await expect(captureSource(f.project)).rejects.toThrow('UPGRADE_WORKTREE_NOT_CLEAN');
});

test('package check permits only managed artifact changes and requires the exact reviewed destination', async () => {
  const f = fixture(), before = await captureSource(f.project);
  const target = f.release('b'.repeat(40), 'synthetic standard release'); f.put('bun.lock', 'synthetic new lock');
  const after = await captureSource(f.project, false);
  compareSource(before, after, 'package', target);
  expect(() => compareSource(before, after, 'package', f.initial)).toThrow('UPGRADE_DESTINATION_MISMATCH');
  expect(() => compareSource(before, { ...after, release: { ...after.release, source: 'refs/heads/fix/custom' } }, 'package', target)).toThrow('UPGRADE_DESTINATION_MISMATCH');
  f.put('server/handler.ts', 'intentional later app implementation');
  const changed = await captureSource(f.project, false);
  expect(() => compareSource(before, changed, 'package', target)).toThrow('UPGRADE_SOURCE_CHANGED');
  compareSource(before, changed, 'protected', target);
});

test('a corrupted vendored archive cannot produce a successful source or destination receipt', async () => {
  const f = fixture();
  f.put('.zero/framework/zero-framework.tgz', 'synthetic corrupt archive');
  await expect(captureSource(f.project, false)).rejects.toThrow('UPGRADE_ARCHIVE_HASH_MISMATCH');
});

test('public styling, new public files, existing historical migrations and aliases cannot bypass source protection', async () => {
  const f = fixture(), before = await captureSource(f.project);
  f.put('lib/public-site/public-site-styles.ts', 'unapproved rebrand');
  expect(() => compareSource(before, { ...before, files: before.files.map(file => file.path.includes('public-site-styles') ? { ...file, sha256: hash('unapproved rebrand') } : file) }, 'protected', f.initial)).toThrow('UPGRADE_SOURCE_CHANGED');
  f.put('lib/public-site/public-site-styles.ts', 'synthetic custom public colors');
  f.put('lib/public-site/new-override.ts', 'unapproved new override');
  expect(() => compareSource(before, before, 'protected', f.initial)).not.toThrow();
  await expect(captureSource(f.project, false)).rejects.toThrow('UPGRADE_UNTRACKED_SOURCE');
  f.git('add', 'lib/public-site/new-override.ts');
  const added = await captureSource(f.project, false);
  expect(() => compareSource(before, added, 'protected', f.initial)).toThrow('UPGRADE_SOURCE_CHANGED');
  rmSync(join(f.project, 'lib/public-site/new-override.ts'));
  f.git('reset', '-q', 'HEAD', '--', 'lib/public-site/new-override.ts');
  f.put('db/migrations/2026102003_history.ts', 'rewritten historical SQL');
  const changed = await captureSource(f.project, false);
  expect(() => compareSource(before, changed, 'protected', f.initial)).toThrow('UPGRADE_SOURCE_CHANGED');
  symlinkSync(join(f.root, 'not-an-app-source'), join(f.project, 'server/alias.ts'));
  await expect(captureSource(f.project, false)).rejects.toThrow();
  expect(() => sourceBaseline({ ...before, files: [] })).toThrow('UPGRADE_BASELINE_INVALID');
});

test('evidence files are private, outside the app and never overwritten or followed through symlinks', () => {
  const f = fixture();
  expect(rehearsal(f.project, f.work)).toBe(f.work);
  expect(() => initializeRehearsal(f.project, join(f.project, 'inside'))).toThrow('UPGRADE_REHEARSAL_INVALID');
  expect(() => initializeRehearsal(f.project, f.work)).toThrow('UPGRADE_REHEARSAL_INVALID');
  writeReport(f.work, 'baseline.json', { synthetic: true });
  expect(statSync(join(f.work, 'evidence/baseline.json')).mode & 0o777).toBe(0o600);
  expect(readReport(f.work, 'baseline.json')).toEqual({ synthetic: true });
  expect(() => writeReport(f.work, 'baseline.json', {})).toThrow();
  expect(() => writeReport(f.work, '../outside.json', {})).toThrow('UPGRADE_REPORT_NAME_INVALID');
  symlinkSync(join(f.work, 'evidence/baseline.json'), join(f.work, 'evidence/alias.json'));
  expect(() => readReport(f.work, 'alias.json')).toThrow('UPGRADE_FILE_INVALID');
});

/** Populate only synthetic values, including binary data and integers beyond JS's safe number range. */
function database(path: string, reversed = false): void {
  const db = new Database(path);
  try {
    db.exec('CREATE TABLE patients (patient_id TEXT PRIMARY KEY, value BLOB, counter INTEGER)');
    const rows: Array<[string, Uint8Array | null, bigint]> = [['synthetic-a', new Uint8Array([0, 255]), 9007199254740993n], ['synthetic-b', null, 2n]];
    for (const row of reversed ? rows.reverse() : rows) db.query('INSERT INTO patients VALUES (?, ?, ?)').run(...row);
  } finally { db.close(); }
}

test('offline checks compare exact typed values independently of insertion order and leave SQLite bytes unchanged', () => {
  const f = fixture(), a = join(f.work, 'source/legacy.db'), b = join(f.work, 'candidate/app.db');
  database(a); database(b, true);
  const original = hash(readFileSync(a));
  const before = inspectOfflineSQLite(f.work, 'source/legacy.db');
  const after = inspectOfflineSQLite(f.work, 'candidate/app.db', ['patients']);
  compareTables(before, after, ['patients']);
  expect(before.tables[0]!.rows).toBe(2);
  expect(JSON.stringify(before)).not.toContain('synthetic-a');
  expect(hash(readFileSync(a))).toBe(original);
  expect(readdirSync(join(f.work, 'source'))).toEqual(['legacy.db']);
  const db = new Database(b); try { db.query('UPDATE patients SET counter=3 WHERE patient_id=?').run('synthetic-b'); } finally { db.close(); }
  const changed = inspectOfflineSQLite(f.work, 'candidate/app.db');
  expect(() => compareTables(before, changed, ['patients'])).toThrow('UPGRADE_PRESERVED_TABLE_CHANGED');
  expect(() => compareTables(before, after, [])).toThrow('UPGRADE_TABLE_LIST_INVALID');
  expect(() => compareTables(before, after, ['unknown'])).toThrow('UPGRADE_PRESERVED_TABLE_CHANGED');
});

test('offline verification rejects missing files, live-style sidecars, outside paths and failed foreign keys', () => {
  const f = fixture(), file = join(f.work, 'source/legacy.db'); database(file);
  expect(() => inspectOfflineSQLite(f.work, '../project/data/private.db')).toThrow('UPGRADE_OFFLINE_COPY_REQUIRED');
  expect(() => inspectOfflineSQLite(f.work, 'candidate/missing.db')).toThrow();
  writeFileSync(`${file}-wal`, 'synthetic sidecar');
  expect(() => inspectOfflineSQLite(f.work, 'source/legacy.db')).toThrow('UPGRADE_CONSOLIDATED_COPY_REQUIRED');
  rmSync(`${file}-wal`);
  symlinkSync(file, join(f.work, 'candidate/alias.db'));
  expect(() => inspectOfflineSQLite(f.work, 'candidate/alias.db')).toThrow('UPGRADE_FILE_INVALID');
  const broken = new Database(join(f.work, 'candidate/broken.db'));
  try { broken.exec('PRAGMA foreign_keys=OFF; CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id INTEGER REFERENCES parent(id)); INSERT INTO child VALUES (99)'); } finally { broken.close(); }
  expect(() => inspectOfflineSQLite(f.work, 'candidate/broken.db')).toThrow('UPGRADE_SQLITE_FOREIGN_KEYS_FAILED');
});

test('command parser has no migrate/install/start/restore command or permissive flag fallback', async () => {
  const f = fixture();
  for (const command of ['migrate', 'install', 'restore', 'start']) await expect(run([command, '--project', f.project, '--rehearsal', f.work])).rejects.toThrow('UPGRADE_COMMAND_INVALID');
  await expect(run(['source-baseline', '--project', f.project, '--project', f.project])).rejects.toThrow('UPGRADE_OPTION_INVALID');
  await expect(run(['source-baseline', '--force', 'true'])).rejects.toThrow('UPGRADE_OPTION_INVALID');
  await run(['source-baseline', '--project', f.project, '--rehearsal', f.work, '--out', 'sources.json']);
  expect(sourceBaseline(readReport(f.work, 'sources.json')).release.commit).toBe(f.initial.commit);
});
