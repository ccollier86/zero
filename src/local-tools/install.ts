#!/usr/bin/env bun
/** Install self-contained stable-package tools and repository-local main hooks. */
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { command, publishMain, writeJsonAtomic } from './stable-release';
import type { ToolsConfig } from './stable-release';

const MARKER = '# Zero stable package tools';
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function isManaged(path: string): Promise<boolean> {
  if (!await exists(path)) return true;
  const text = await readFile(path, 'utf8').catch(() => '');
  return text.includes(MARKER) || text.includes('ZERO_FRAMEWORK_DIR=');
}

async function backupCommand(source: string, destination: string): Promise<void> {
  try { await rename(source, destination); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await copyFile(source, destination);
    await unlink(source);
  }
}

export async function installTools(repo: string): Promise<void> {
  const drive = Bun.env.DEV_DRIVE ?? (await exists('/Volumes/code-bank') ? '/Volumes/code-bank' : undefined);
  const bin = resolve(Bun.env.ZERO_LOCAL_BIN_DIR ?? (drive ? join(drive, 'tools/bin') : join(homedir(), '.local/bin')));
  const library = resolve(Bun.env.ZERO_LOCAL_TOOLS_DIR ?? join(dirname(bin), 'lib/zero-stable'));
  const config: ToolsConfig = {
    repo: resolve(repo),
    releases: resolve(Bun.env.ZERO_RELEASE_DIR ?? (drive ? join(drive, 'artifacts/zero-platform/release') : join(repo, '.zero/releases'))),
    scratch: resolve(Bun.env.ZERO_TOOLS_SCRATCH_DIR ?? (drive ? join(drive, 'tmp/scratch/zero-platform') : join(repo, '.zero/scratch'))),
  };
  const commands = { 'zero-new': 'new', 'zero-update': 'update', 'zero-doctor': 'doctor', 'zero-release': 'release' };
  const legacyBin = Bun.env.ZERO_LOCAL_BIN_DIR ? undefined : join(homedir(), '.bin');
  for (const name of Object.keys(commands)) {
    for (const path of [join(bin, name), ...(legacyBin && legacyBin !== bin ? [join(legacyBin, name)] : [])]) {
      if (!await isManaged(path)) throw new Error(`Refusing to overwrite unrelated command: ${path}`);
    }
  }
  // Publish first: if main cannot be packaged, existing launchers stay untouched.
  const release = await publishMain(config);
  await mkdir(library, { recursive: true });
  await mkdir(bin, { recursive: true });
  const runtime = await mkdtemp(join(library, 'runtime-'));
  for (const name of ['run.ts', 'stable-release.ts']) await copyFile(join(import.meta.dir, name), join(runtime, name));
  await writeJsonAtomic(join(runtime, 'config.json'), config);
  const diagnostics = join(dirname(config.releases), 'diagnostics');
  await mkdir(diagnostics, { recursive: true });
  const backup = await mkdtemp(join(diagnostics, 'previous-tools-'));
  for (const [name, action] of Object.entries(commands)) {
    const destination = join(bin, name);
    const wrapper = `#!/usr/bin/env bash\n${MARKER}\nset -euo pipefail\nexport TMPDIR=${quote(config.scratch)}\nexec bun ${quote(join(runtime, 'run.ts'))} ${quote(action)} "$@"\n`;
    if (await exists(destination)) await backupCommand(destination, join(backup, name));
    await writeFile(destination, wrapper, { mode: 0o755 });
    // The old ~/.bin location precedes the shared tools directory on this machine.
    if (legacyBin && legacyBin !== bin && await exists(join(legacyBin, name))) {
      await backupCommand(join(legacyBin, name), join(backup, `legacy-${name}`));
      await symlink(destination, join(legacyBin, name));
    }
  }

  const hooksConfig = Bun.spawnSync(['git', 'config', '--get', 'core.hooksPath'], { cwd: repo });
  if (hooksConfig.exitCode === 0) {
    console.log('Custom core.hooksPath is configured; add zero-release to its main post-commit/post-merge hooks.');
  } else {
    const hooks = resolve(repo, await command(['git', 'rev-parse', '--git-path', 'hooks'], repo));
    await mkdir(hooks, { recursive: true });
    for (const name of ['post-commit', 'post-merge']) {
      const path = join(hooks, name);
      if (await exists(path) && !(await readFile(path, 'utf8')).includes(MARKER)) {
        console.log(`Existing ${name} retained; run zero-release after changes land on main.`);
        continue;
      }
      await writeFile(path, `#!/usr/bin/env bash\n${MARKER}\nif [[ "$(git symbolic-ref --short HEAD 2>/dev/null)" == main ]]; then\n  ${quote(join(bin, 'zero-release'))} || { echo 'Zero stable refresh failed; previous saved package is still active. Run zero-release.' >&2; exit 1; }\nfi\n`, { mode: 0o755 });
    }
  }
  console.log(`Installed stable Zero tools in ${bin}`);
  console.log(`Active package: ${release.version} / main ${release.commit}`);
  console.log(`Previous command files: ${backup}`);
  console.log('zero-release --status shows the saved archive. Feature checkouts never change it.');
}

if (import.meta.main) {
  try { await installTools(resolve(import.meta.dir, '../..')); } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
