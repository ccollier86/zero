/** Narrow filesystem boundary for immutable offline input and fresh private output. */
import { constants, lstatSync, realpathSync } from 'node:fs';
import { open, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { failLegacyState } from './contracts';

export function canonicalPath(path: string): string {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') || resolve(path) !== path) failLegacyState('LEGACY_STATE_INPUT_INVALID');
  return path;
}

export function canonicalDirectory(path: string): string {
  canonicalPath(path);
  try { if (!lstatSync(path).isDirectory() || realpathSync(path) !== path) throw 0; }
  catch { failLegacyState('LEGACY_STATE_DESTINATION_INVALID'); }
  return path;
}

export function sourceFile(path: string): string {
  canonicalPath(path);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(path) !== path || stat.size < 512) throw 0;
    for (const suffix of ['-wal', '-shm', '-journal']) if (exists(path + suffix)) throw 0;
  } catch { failLegacyState('LEGACY_STATE_SOURCE_INVALID'); }
  return path;
}

export function exists(path: string): boolean {
  try { lstatSync(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return false;
  }
}

export async function fileSha256(path: string): Promise<string> {
  const hash = new Bun.CryptoHasher('sha256');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk); }
  finally { await file.close(); }
  return hash.digest('hex');
}

export async function createGeneration(path: string, source: string): Promise<void> {
  canonicalPath(path);
  const parent = canonicalDirectory(dirname(path));
  const inside = relative(path, source);
  if (path === source || inside === '' || (!inside.startsWith('..' + sep) && inside !== '..' && !isAbsolute(inside))
    || exists(path) || (lstatSync(parent).mode & 0o077) !== 0) failLegacyState('LEGACY_STATE_DESTINATION_INVALID');
  await mkdir(path, { mode: 0o700 });
}

export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); }
  finally { await file.close(); }
}

/** Receipts contain metadata only; never treat arbitrary or unbounded files as receipts. */
export async function readPrivateJson(path: string): Promise<unknown> {
  canonicalPath(path);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 2 || stat.size > 64 * 1024
      || (stat.mode & 0o077) !== 0 || realpathSync(path) !== path) failLegacyState('LEGACY_STATE_MANIFEST_INVALID');
    return JSON.parse(await file.readFile('utf8'));
  } finally { await file.close(); }
}

/** Commit the final snapshots before the receipt, then the containing directory. */
export async function syncPrivatePath(path: string): Promise<void> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await file.sync(); } finally { await file.close(); }
}

/** Only fixed, framework-chosen file names below a validated generation are used. */
export async function copyPrivateFile(source: string, destination: string): Promise<void> {
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let output: Awaited<ReturnType<typeof open>> | undefined;
  try {
    output = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      let offset = 0;
      while (offset < bytesRead) {
        const written = (await output.write(buffer, offset, bytesRead - offset, null)).bytesWritten;
        if (!written) failLegacyState('LEGACY_STATE_STAGE_FAILED');
        offset += written;
      }
    }
    await output.sync();
  } finally { await input.close(); await output?.close(); }
}
