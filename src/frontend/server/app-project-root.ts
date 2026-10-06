/** Capture app-owned build paths once; later cwd changes cannot retarget a plugin. */
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve explicit config origin, an absolute app directory, or the ordinary launch root. */
export function resolveAppProjectRoot(config: { projectRoot?: string | URL; appDir?: string }): string {
  if (config.projectRoot !== undefined) {
    const input = config.projectRoot;
    const path = input instanceof URL || input.startsWith('file:')
      ? fileURLToPath(input)
      : input;
    if (!isAbsolute(path)) throw new TypeError('App projectRoot must be an absolute path or file URL.');
    return resolve(path);
  }
  if (config.appDir && isAbsolute(config.appDir)) return dirname(resolve(config.appDir));
  return resolve(process.cwd());
}

/** Resolve one app-owned path from immutable config origin without consulting ambient cwd. */
export function resolveAppOwnedPath(projectRoot: string, path: string | URL): string {
  if (path instanceof URL || path.startsWith('file:')) return resolve(fileURLToPath(path));
  return resolve(projectRoot, path);
}
