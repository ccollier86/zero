/** Read declared build file bytes after canonical containment and snapshot-hash admission. */
import { constants } from 'node:fs';
import { open, realpath, stat, type FileHandle } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { resolveAppOwnedPath } from './app-project-root';
import { AppPluginBuildError } from './server-plugin-build-error';
import type { ZeroPluginBuildFile } from './server-plugin-build-types';

/** Read an explicit source without allowing a stale compiler snapshot to publish changed bytes. */
export async function readPluginBuildFile(projectRoot: string, file: ZeroPluginBuildFile): Promise<{ readonly path: string; readonly bytes: Uint8Array; readonly hash: string }> {
  if (!(typeof file.path === 'string' || file.path instanceof URL)) throw invalid('Declared plugin file source must be a path or file URL.');
  if (file.sourceRoot !== undefined && !(typeof file.sourceRoot === 'string' || file.sourceRoot instanceof URL)) throw invalid('Declared plugin source root must be a path or file URL.');
  let handle: FileHandle | undefined;
  try {
    const path = resolveAppOwnedPath(projectRoot, file.path);
    const admittedPath = await realpath(path);
    const rootPath = file.sourceRoot === undefined ? undefined : resolveAppOwnedPath(projectRoot, file.sourceRoot);
    const root = rootPath === undefined ? undefined : await realpath(rootPath);
    if (root !== undefined) assertInside(root, admittedPath);
    const before = await stat(admittedPath, { bigint: true });
    if (!before.isFile()) throw invalid('Declared plugin file source must be a regular file.');
    // Bun has no native realpath/no-follow descriptor opener. Its Node-compatible
    // filesystem API supplies those safeguards; byte reads remain Bun-native.
    handle = await open(admittedPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat({ bigint: true });
    if (!sameSnapshot(before, opened)) throw changed();
    const bytes = new Uint8Array(await Bun.file(handle.fd).arrayBuffer());
    const after = await handle.stat({ bigint: true });
    const [currentPath, currentFile, currentRoot] = await Promise.all([
      realpath(path), stat(admittedPath, { bigint: true }), rootPath === undefined ? undefined : realpath(rootPath),
    ]);
    if (currentPath !== admittedPath || currentRoot !== root || !sameSnapshot(opened, after)
      || !sameSnapshot(opened, currentFile) || BigInt(bytes.byteLength) !== opened.size) throw changed();
    if (root !== undefined) assertInside(root, currentPath);
    const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    if (file.contentHash !== undefined && (typeof file.contentHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(file.contentHash) || file.contentHash !== hash)) throw changed();
    return Object.freeze({ path: admittedPath, bytes, hash });
  } catch (error) {
    if (error instanceof AppPluginBuildError) throw error;
    throw invalid('Declared plugin file source could not be admitted.');
  } finally {
    await handle?.close();
  }
}
function sameSnapshot(left: import('node:fs').BigIntStats, right: import('node:fs').BigIntStats): boolean {
  return right.isFile() && left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
function assertInside(root: string, candidate: string): void {
  const inside = relative(root, candidate);
  if (isAbsolute(inside) || inside === '..' || inside.startsWith('../')) throw invalid('Declared plugin file source escaped its admitted filesystem boundary.');
}
function changed(): AppPluginBuildError { return invalid('Declared plugin file changed after content compilation. Rebuild a coherent snapshot.'); }
function invalid(message: string): AppPluginBuildError { return new AppPluginBuildError('APP_PLUGIN_BUILD_CONFIG_INVALID', message); }
