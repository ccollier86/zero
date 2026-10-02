/** Committed-branch package snapshots, independent of the developer working tree. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export interface ToolsConfig {
  repo: string;
  releases: string;
  scratch: string;
}

export interface StableRelease {
  schema: 1;
  source: string;
  branch: string;
  commit: string;
  version: string;
  sha256: string;
  createdAt: string;
}

export async function command(argv: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(argv, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (code !== 0) throw new Error(`${argv[0]} failed (${code}): ${stderr || stdout}`);
  return stdout.trim();
}

export function archivePath(config: ToolsConfig, release: StableRelease): string {
  const sourceIdentity = createHash('sha256').update(release.source).digest('hex');
  return join(config.releases, release.version, release.commit, sourceIdentity, 'zero-framework.tgz');
}

export function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function validateRelease(value: StableRelease): void {
  if (value.schema !== 1 || !isStoredBranchName(value.branch)
    || value.source !== `refs/heads/${value.branch}`
    || !/^[a-f0-9]{40,64}$/.test(value.commit)
    || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value.version)
    || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error('Invalid stable release metadata. Run zero-release [branch] to publish a committed local branch.');
  }
}

function isStoredBranchName(branch: unknown): branch is string {
  return typeof branch === 'string' && branch.length > 0 && !branch.startsWith('-')
    && branch !== '@' && !branch.includes('@{') && !branch.includes('..')
    && !branch.startsWith('/') && !branch.endsWith('/') && !branch.endsWith('.')
    && !branch.includes('//') && !/[\x00-\x20\x7f~^:?*[\\]/.test(branch)
    && branch.split('/').every((part) => !part.startsWith('.') && !part.endsWith('.lock'));
}

export async function validateLocalBranch(repo: string, branch: string): Promise<string> {
  if (!isStoredBranchName(branch)) throw new Error(`Invalid local branch: ${JSON.stringify(branch)}`);
  let checked: string;
  try {
    checked = await command(['git', 'check-ref-format', '--branch', branch], repo);
  } catch {
    throw new Error(`Invalid local branch: ${JSON.stringify(branch)}`);
  }
  // check-ref-format expands revision shorthand such as @{-1}; never publish an
  // interpretation different from the exact local branch the caller named.
  if (checked !== branch) throw new Error(`Ambiguous local branch: ${JSON.stringify(branch)}`);
  return branch;
}

export async function verifyRelease(config: ToolsConfig, release: StableRelease): Promise<Buffer> {
  validateRelease(release);
  const bytes = await readFile(archivePath(config, release));
  if (digest(bytes) !== release.sha256) throw new Error('Stable archive checksum mismatch; refusing to use it.');
  return bytes;
}

export async function readStableRelease(config: ToolsConfig): Promise<StableRelease> {
  let release: StableRelease;
  try {
    release = JSON.parse(await readFile(join(config.releases, 'stable.json'), 'utf8'));
  } catch {
    throw new Error('No saved stable release. Run zero-release first. The working tree will not be used.');
  }
  await verifyRelease(config, release);
  return release;
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function resolveBranchCommit(config: ToolsConfig, branch: string, source: string): Promise<string> {
  try {
    return await command(['git', 'rev-parse', '--verify', '--end-of-options', `${source}^{commit}`], config.repo);
  } catch {
    throw new Error(`Local branch ${JSON.stringify(branch)} does not exist or does not name a commit.`);
  }
}

/** Only Git objects reachable at the exact local branch are packed; no checkout or stash is needed. */
export async function publishBranch(config: ToolsConfig, requestedBranch = 'main'): Promise<StableRelease> {
  const branch = await validateLocalBranch(config.repo, requestedBranch);
  const sourceRef = `refs/heads/${branch}`;
  await mkdir(config.releases, { recursive: true });
  await mkdir(config.scratch, { recursive: true });
  const lock = join(config.releases, '.publish-lock');
  try {
    await mkdir(lock);
  } catch {
    throw new Error(`Another release may be publishing (${lock}); stable was not changed.`);
  }
  let staging: string | undefined;
  try {
    const commit = await resolveBranchCommit(config, branch, sourceRef);
    const manifest = JSON.parse(await command(['git', 'show', `${commit}:package.json`], config.repo));
    const release: StableRelease = {
      schema: 1, source: sourceRef, branch, commit, version: manifest.version,
      sha256: '0'.repeat(64), createdAt: new Date().toISOString(),
    };
    validateRelease(release);
    if (manifest.name !== '@zero/framework') throw new Error(`${branch} is not an @zero/framework package.`);
    const destination = dirname(archivePath(config, release));
    const savedManifest = join(destination, 'release.json');
    if (await Bun.file(savedManifest).exists()) {
      const saved: StableRelease = await Bun.file(savedManifest).json();
      if (saved.commit !== commit || saved.version !== release.version
        || saved.source !== sourceRef || saved.branch !== branch) {
        throw new Error('Saved release identity mismatch.');
      }
      await verifyRelease(config, saved);
      if (await resolveBranchCommit(config, branch, sourceRef) !== commit) {
        throw new Error(`${branch} changed during packaging; rerun zero-release ${branch}. Previous stable was retained.`);
      }
      await writeJsonAtomic(join(config.releases, 'stable.json'), saved);
      return saved;
    }

    staging = await mkdtemp(join(config.scratch, 'publish-'));
    const source = join(staging, 'source');
    await mkdir(source);
    await command(['git', 'archive', '--format=tar', '--output', join(staging, 'source.tar'), commit], config.repo);
    await command(['tar', '-xf', join(staging, 'source.tar'), '-C', source], config.repo);
    const packagePath = join(staging, 'zero-framework.tgz');
    await command(['bun', 'pm', 'pack', '--filename', packagePath, '--ignore-scripts', '--quiet'], source);
    const bytes = await readFile(packagePath);
    await packageFiles(bytes); // Validate the package before making it active.
    release.sha256 = digest(bytes);
    if (await resolveBranchCommit(config, branch, sourceRef) !== commit) {
      throw new Error(`${branch} changed during packaging; rerun zero-release ${branch}. Previous stable was retained.`);
    }
    await mkdir(dirname(destination), { recursive: true });
    const prepared = await mkdtemp(join(dirname(destination), '.release-'));
    try {
      await writeFile(join(prepared, 'zero-framework.tgz'), bytes);
      await writeJsonAtomic(join(prepared, 'release.json'), release);
      await rename(prepared, destination);
    } finally {
      await rm(prepared, { recursive: true, force: true });
    }
    await writeJsonAtomic(join(config.releases, 'stable.json'), release);
    return release;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

/** Main remains the default stable channel and the only automatic hook target. */
export function publishMain(config: ToolsConfig): Promise<StableRelease> {
  return publishBranch(config, 'main');
}

async function packageFiles(bytes: Uint8Array): Promise<Map<string, File>> {
  const files = await new Bun.Archive(bytes).files();
  for (const name of files.keys()) {
    const parts = name.split('/');
    if (parts[0] !== 'package' || parts.length < 2
      || parts.some((part) => !part || part === '.' || part === '..') || name.includes('\\')) {
      throw new Error(`Unexpected package archive entry: ${name}`);
    }
  }
  for (const required of [
    'package.json', 'src/create-zero/scaffold.ts', 'src/create-zero/cli-args.ts',
    'src/create-zero/cli-output.ts', 'src/update/run.ts', 'examples/package-mode/zero.config.ts',
  ]) {
    if (!files.has(`package/${required}`)) throw new Error(`Stable package is missing ${required}`);
  }
  return files;
}

/** Each invocation extracts verified bytes, so an editable cache is never authoritative. */
export async function withStablePackage<T>(
  config: ToolsConfig,
  run: (directory: string, release: StableRelease, archive: string) => Promise<T>,
): Promise<T> {
  const release = await readStableRelease(config);
  const bytes = await verifyRelease(config, release);
  const files = await packageFiles(bytes);
  await mkdir(config.scratch, { recursive: true });
  const temporary = await mkdtemp(join(config.scratch, 'use-stable-'));
  try {
    for (const [name, file] of files) {
      const destination = resolve(temporary, name);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, new Uint8Array(await file.arrayBuffer()));
    }
    // Copy the checked bytes once; concurrent publication cannot change this invocation.
    const snapshot = join(temporary, 'zero-framework.tgz');
    await writeFile(snapshot, bytes);
    return await run(join(temporary, 'package'), release, snapshot);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
