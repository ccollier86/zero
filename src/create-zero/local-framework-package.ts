/**
 * local-framework-package.ts
 *
 * Packs the current Zero checkout for local package-mode app creation. The
 * archive follows the publish allowlist, keeping checkout-only files and
 * dependency instances out of generated applications.
 */

import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const LOCAL_FRAMEWORK_DEPENDENCY = 'file:./.zero/framework/zero-framework.tgz';

export interface LocalFrameworkPackage {
  archivePath: string;
  cleanup(): Promise<void>;
}

/** Pack the current framework checkout into a temporary publish-style archive. */
export async function packLocalFramework(frameworkDir: string): Promise<LocalFrameworkPackage> {
  const packDir = await mkdtemp(join(tmpdir(), 'zero-local-framework-'));

  try {
    const child = Bun.spawn(
      ['bun', 'pm', 'pack', '--destination', packDir, '--ignore-scripts', '--quiet'],
      {
        cwd: frameworkDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: Bun.env,
      }
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    if (exitCode !== 0) {
      throw new Error(
        `[create-zero] Failed to pack the local framework:\n${stdout}${stderr}`.trimEnd()
      );
    }

    const archiveName = (await readdir(packDir)).find((entry) => entry.endsWith('.tgz'));
    if (!archiveName) throw new Error('[create-zero] Local framework pack did not produce an archive.');

    return {
      archivePath: join(packDir, archiveName),
      cleanup: () => rm(packDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(packDir, { recursive: true, force: true });
    throw error;
  }
}

/** Copy a prepared framework archive into the generated app's ignored cache. */
export async function installLocalFrameworkArchive(
  archivePath: string,
  targetDir: string
): Promise<void> {
  const destinationDir = join(targetDir, '.zero', 'framework');
  await mkdir(destinationDir, { recursive: true });
  await copyFile(archivePath, join(destinationDir, 'zero-framework.tgz'));
}
