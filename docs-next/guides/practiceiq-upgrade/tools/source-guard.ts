/** source-guard.ts: fingerprints application source and its exact vendored Zero pin without evaluating configuration. */
import { createReadStream, readFileSync } from 'node:fs';
import { directory, fail, regularFile } from './safety';

const DIGEST = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40,64}$/;
const MANAGED = new Set(['.zero/framework/zero-framework.tgz', 'zero-release.json', 'bun.lock', 'bun.lockb']);
const PRIVATE_ROOTS = ['data/', 'node_modules/', '.git/', '.build/', 'dist/', '.zero/generated/'];

export interface SourceBaseline {
  schema: 1;
  kind: 'practiceiq-source';
  commit: string;
  release: { version: string; source: string; commit: string; sha256: string };
  files: Array<{ path: string; sha256: string }>;
}

/** Read-only Git invocation; no hooks, config imports, dependency installs or optional index writes. */
function git(project: string, args: string[]): string {
  const result = Bun.spawnSync(['git', '--no-optional-locks', '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', project, ...args], {
    env: { PATH: process.env.PATH, GIT_OPTIONAL_LOCKS: '0' }, stdout: 'pipe', stderr: 'pipe',
  });
  if (result.exitCode) fail('UPGRADE_GIT_CHECK_FAILED');
  return result.stdout.toString();
}

/** Stream a file digest, never returning its content. */
async function digest(path: string): Promise<string> {
  const hash = new Bun.CryptoHasher('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

/** Capture a clean baseline, or inspect the explicit candidate after a deliberate update. */
export async function captureSource(project: string, requireClean = true): Promise<SourceBaseline> {
  project = directory(project);
  const top = directory(git(project, ['rev-parse', '--show-toplevel']).trim());
  if (top !== project) fail('UPGRADE_PROJECT_ROOT_REQUIRED');
  if (requireClean && git(project, ['status', '--porcelain', '--untracked-files=normal']).trim()) fail('UPGRADE_WORKTREE_NOT_CLEAN');
  const untracked = git(project, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  if (untracked.some(path => !MANAGED.has(path))) fail('UPGRADE_UNTRACKED_SOURCE');
  const files = git(project, ['ls-files', '--cached', '-z']).split('\0').filter(Boolean);
  if (files.length > 100_000 || new Set(files).size !== files.length) fail('UPGRADE_SOURCE_INVENTORY_INVALID');
  const lockfiles = files.filter(path => path === 'bun.lock' || path === 'bun.lockb');
  if (lockfiles.length !== 1) fail('UPGRADE_ONE_LOCKFILE_REQUIRED');
  const manifest = JSON.parse(readFileSync(regularFile(project, 'zero-release.json'), 'utf8'));
  if (manifest.schema !== 1 || typeof manifest.version !== 'string' || typeof manifest.source !== 'string'
    || typeof manifest.commit !== 'string' || !COMMIT.test(manifest.commit)
    || typeof manifest.sha256 !== 'string' || !DIGEST.test(manifest.sha256)) fail('UPGRADE_RELEASE_INVALID');
  const pkg = JSON.parse(readFileSync(regularFile(project, 'package.json'), 'utf8'));
  if (pkg.dependencies?.['@zero/framework'] !== 'file:./.zero/framework/zero-framework.tgz') fail('UPGRADE_MANAGED_ARCHIVE_REQUIRED');
  const archive = regularFile(project, '.zero/framework/zero-framework.tgz');
  if (await digest(archive) !== manifest.sha256) fail('UPGRADE_ARCHIVE_HASH_MISMATCH');
  const fingerprints: SourceBaseline['files'] = [];
  for (const path of files.sort()) {
    if (MANAGED.has(path) || PRIVATE_ROOTS.some(prefix => path.startsWith(prefix))
      || /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$/.test(path)
      || /\.(?:key|pem|p12|pfx)$/.test(path)
      || path.split('/').some(part => part === '.env' || part.startsWith('.env.'))) continue;
    fingerprints.push({ path, sha256: await digest(regularFile(project, path)) });
  }
  return { schema: 1, kind: 'practiceiq-source', commit: git(project, ['rev-parse', 'HEAD']).trim(),
    release: { version: manifest.version, source: manifest.source, commit: manifest.commit, sha256: manifest.sha256 }, files: fingerprints };
}

/** Match public website/brand integration files and existing immutable migration bodies. */
export function protectedPath(path: string): boolean {
  return ['app/(public-site)/', 'components/public-site/', 'lib/public-site/', 'server/public-site/',
    'public/', 'assets/', 'server/endpoints/public-site-', 'server/plugins/public-site-',
    'scripts/public-site-', 'app/public-site-', 'lib/public-intake/public-intake-brand',
  ].some(prefix => path.startsWith(prefix))
    || ['app/layout.tsx', 'app/(public-intake)/layout.tsx', 'components/public-intake/public-intake-footer.tsx',
      'components/public-intake/public-intake-brand-bridge.tsx', 'db/migration-safety.ts'].includes(path)
    || (path.startsWith('db/migrations/') && path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('/index.ts'));
}

/** Validate a stored baseline before it can grant an apparently successful comparison. */
export function sourceBaseline(value: unknown): SourceBaseline {
  const input = value as SourceBaseline;
  if (!input || input.schema !== 1 || input.kind !== 'practiceiq-source' || !COMMIT.test(input.commit)
    || !input.release || typeof input.release.source !== 'string' || typeof input.release.version !== 'string'
    || !COMMIT.test(input.release.commit) || !DIGEST.test(input.release.sha256)
    || !Array.isArray(input.files) || !input.files.length || input.files.length > 100_000) fail('UPGRADE_BASELINE_INVALID');
  const paths = new Set<string>();
  for (const file of input.files) {
    if (!file || typeof file.path !== 'string' || !file.path || file.path.startsWith('/') || file.path.includes('\\')
      || file.path.split('/').some(part => !part || part === '..' || part === '.')
      || !DIGEST.test(file.sha256) || paths.has(file.path)) fail('UPGRADE_BASELINE_INVALID');
    paths.add(file.path);
  }
  if (!paths.has('package.json') || !paths.has('zero.config.ts')) fail('UPGRADE_BASELINE_INVALID');
  return input;
}

/**
 * Require the reviewed destination identity. Package-only mode permits changes
 * only to the excluded managed artifacts; protected mode permits deliberate
 * app work elsewhere, never changes/additions/removals in protected source.
 */
export function compareSource(before: SourceBaseline, after: SourceBaseline, mode: 'package' | 'protected', expected: { commit: string; sha256: string }): void {
  sourceBaseline(before); sourceBaseline(after);
  if (!COMMIT.test(expected.commit) || !DIGEST.test(expected.sha256)
    || after.release.commit !== expected.commit || after.release.sha256 !== expected.sha256
    || after.release.source !== 'refs/heads/main') fail('UPGRADE_DESTINATION_MISMATCH');
  const old = new Map(before.files.map(file => [file.path, file.sha256]));
  const current = new Map(after.files.map(file => [file.path, file.sha256]));
  for (const path of new Set([...old.keys(), ...current.keys()])) {
    if ((mode === 'package' || protectedPath(path)) && old.get(path) !== current.get(path)) fail('UPGRADE_SOURCE_CHANGED');
  }
}
