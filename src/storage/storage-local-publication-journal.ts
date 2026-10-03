/** Durable local-provider staging ownership and crash-publication receipts. */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  type Dirent,
} from 'node:fs';
import { open, rename } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { hostname } from 'node:os';
import type { StoragePendingBlobPublication } from './types';
import { StorageDomainError } from './storage-domain-error';

const RUNTIME_DIRECTORY_PREFIX = 'runtime_';
const RECOVERY_DIRECTORY_PREFIX = 'recovery_';
const RUNTIME_OWNER_FILE = '.owner.json';
const PUBLICATION_PREFIX = 'publication_';
const PUBLICATION_SUFFIX = '.json';
const MAX_RUNTIME_RECLAIM_PER_START = 32;
const RUNTIME_HEARTBEAT_MS = 10_000;
const RUNTIME_LEASE_MS = 60_000;
const SHA256_CHECKSUM = /^[a-f0-9]{64}$/u;

/** Owns one runtime staging namespace and durable pre-publication receipts. */
export class LocalPublicationJournal {
  readonly runtimeTmpDir: string;
  private readonly tmpRoot: string;
  private readonly ownerToken = crypto.randomUUID();
  private readonly recoveryDirectories = new Set<string>();
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor(baseDir: string) {
    this.tmpRoot = join(baseDir, 'tmp');
    ensureDirectoryDurableSync(baseDir);
    ensureDirectoryDurableSync(this.tmpRoot);
    this.runtimeTmpDir = join(
      this.tmpRoot,
      `${RUNTIME_DIRECTORY_PREFIX}${crypto.randomUUID()}`,
    );
    ensureDirectoryDurableSync(this.runtimeTmpDir, 0o700);
    this.writeOwner(this.runtimeTmpDir, process.pid, Date.now());
    this.claimStaleRuntimeDirectories();
    this.heartbeat = setInterval(() => {
      try {
        this.writeOwner(this.runtimeTmpDir, process.pid, Date.now());
        for (const directory of this.recoveryDirectories) {
          this.writeOwner(directory, process.pid, Date.now());
        }
      } catch { /* an ownership check fences work before physical publication */ }
    }, RUNTIME_HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  async create(checksum: string, size: number): Promise<string> {
    this.assertOwned();
    const name = `${PUBLICATION_PREFIX}${crypto.randomUUID()}${PUBLICATION_SUFFIX}`;
    const path = join(this.runtimeTmpDir, name);
    const temporary = join(this.runtimeTmpDir, `.pending_${crypto.randomUUID()}`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify({ checksum, size }), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    await syncDirectory(this.runtimeTmpDir);
    this.assertOwned();
    return `${basename(this.runtimeTmpDir)}/${name}`;
  }

  /** Fence a paused writer after another runtime has atomically claimed it. */
  assertOwned(): void {
    const owner = readRuntimeOwner(join(this.runtimeTmpDir, RUNTIME_OWNER_FILE));
    if (!owner || owner.token !== this.ownerToken) {
      throw publicationOwnershipLost();
    }
  }

  /** Return a bounded batch from atomically claimed stale runtimes. */
  list(limit = 32): {
    readonly items: readonly StoragePendingBlobPublication[];
    readonly remaining: boolean;
  } {
    this.claimStaleRuntimeDirectories();
    const maximum = Math.max(1, Math.min(limit, 128));
    const items: StoragePendingBlobPublication[] = [];
    let remaining = false;
    for (const directory of [...this.recoveryDirectories].sort()) {
      for (const name of publicationNames(directory)) {
        const parsed = readPublication(join(directory, name));
        if (!parsed) continue;
        if (items.length >= maximum) {
          remaining = true;
          return Object.freeze({ items: Object.freeze(items), remaining });
        }
        items.push(Object.freeze({
          publicationId: `${basename(directory)}/${name}`,
          checksum: parsed.checksum,
          size: parsed.size,
        }));
      }
    }
    return Object.freeze({ items: Object.freeze(items), remaining });
  }

  settle(publicationId: string): void {
    const path = this.resolvePublication(publicationId);
    try {
      unlinkSync(path);
      syncDirectorySync(dirname(path));
    } catch (cause) {
      if (!isNodeError(cause, 'ENOENT')) throw cause;
    }
    this.removeDeadDirectoryIfEmpty(dirname(path));
  }

  stop(): void {
    clearInterval(this.heartbeat);
    for (const directory of [this.runtimeTmpDir, ...this.recoveryDirectories]) {
      const pending = publicationNames(directory);
      if (pending.length === 0) {
        rmSync(directory, { recursive: true, force: true });
        continue;
      }
      // Preserve unsettled receipts while making the directory immediately
      // claimable by another runtime on the next bounded recovery pass.
      this.writeOwner(directory, 2_147_483_647, 0);
    }
    syncDirectorySync(this.tmpRoot);
  }

  private writeOwner(directory: string, pid: number, heartbeatAt: number): void {
    const path = join(directory, RUNTIME_OWNER_FILE);
    const temporary = join(directory, `.owner_${crypto.randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, JSON.stringify({
        pid,
        host: hostname(),
        heartbeatAt,
        token: this.ownerToken,
      }), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      const handle = openSync(temporary, 'r');
      try { fsyncSync(handle); } finally { closeSync(handle); }
      renameSync(temporary, path);
      syncDirectorySync(directory);
    } catch (cause) {
      try { unlinkSync(temporary); } catch { /* best-effort private temp cleanup */ }
      throw cause;
    }
  }

  private claimStaleRuntimeDirectories(): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(this.tmpRoot, { withFileTypes: true });
    } catch {
      return;
    }
    let claimed = 0;
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (claimed >= MAX_RUNTIME_RECLAIM_PER_START) break;
      if (!entry.isDirectory()
        || (!entry.name.startsWith(RUNTIME_DIRECTORY_PREFIX)
          && !entry.name.startsWith(RECOVERY_DIRECTORY_PREFIX))) continue;
      const source = join(this.tmpRoot, entry.name);
      if (source === this.runtimeTmpDir || this.recoveryDirectories.has(source)) continue;
      const owner = readRuntimeOwner(join(source, RUNTIME_OWNER_FILE));
      if (!owner || !runtimeOwnerIsStale(owner)) continue;
      const target = join(
        this.tmpRoot,
        `${RECOVERY_DIRECTORY_PREFIX}${this.ownerToken}_${crypto.randomUUID()}`,
      );
      try {
        // Directory rename is the writer fence. A paused writer retains its
        // open inode but every later path-based publication/ownership check
        // against the old runtime namespace fails closed.
        renameSync(source, target);
        syncDirectorySync(this.tmpRoot);
        this.writeOwner(target, process.pid, Date.now());
        this.recoveryDirectories.add(target);
        claimed += 1;
        if (publicationNames(target).length === 0) {
          rmSync(target, { recursive: true, force: true });
          this.recoveryDirectories.delete(target);
          syncDirectorySync(this.tmpRoot);
        }
      } catch {
        // Another runtime may have won the atomic claim. A later pass retries
        // genuine provider failures without risking concurrent ownership.
      }
    }
  }

  private resolvePublication(publicationId: string): string {
    const parts = publicationId.split('/');
    if (parts.length !== 2
      || (!parts[0]?.startsWith(RUNTIME_DIRECTORY_PREFIX)
        && !parts[0]?.startsWith(RECOVERY_DIRECTORY_PREFIX))
      || !parts[1]?.startsWith(PUBLICATION_PREFIX)
      || !parts[1]?.endsWith(PUBLICATION_SUFFIX)) {
      throw new TypeError('Local storage publication receipt is invalid.');
    }
    const directory = join(this.tmpRoot, parts[0]);
    if (directory !== this.runtimeTmpDir && !this.recoveryDirectories.has(directory)) {
      throw publicationOwnershipLost();
    }
    return join(directory, parts[1]);
  }

  private removeDeadDirectoryIfEmpty(directory: string): void {
    if (directory === this.runtimeTmpDir || publicationNames(directory).length > 0) return;
    const owner = readRuntimeOwner(join(directory, RUNTIME_OWNER_FILE));
    if (!owner || owner.token !== this.ownerToken) return;
    rmSync(directory, { recursive: true, force: true });
    this.recoveryDirectories.delete(directory);
    syncDirectorySync(this.tmpRoot);
  }
}

/** Create a directory chain and durably link every new entry into its parent. */
export function ensureDirectoryDurableSync(path: string, mode = 0o755): void {
  const parent = dirname(path);
  if (existsSync(path)) {
    if (parent !== path) syncDirectorySync(parent);
    return;
  }
  if (parent !== path) ensureDirectoryDurableSync(parent, mode);
  try {
    mkdirSync(path, { recursive: false, mode });
  } catch (cause) {
    if (!isNodeError(cause, 'EEXIST')) throw cause;
  }
  syncDirectorySync(parent);
}

export async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

export function syncDirectorySync(path: string): void {
  const handle = openSync(path, 'r');
  try { fsyncSync(handle); } finally { closeSync(handle); }
}

function publicationNames(directory: string): string[] {
  try {
    return readdirSync(directory)
      .filter((name) => name.startsWith(PUBLICATION_PREFIX)
        && name.endsWith(PUBLICATION_SUFFIX))
      .sort();
  } catch {
    return [];
  }
}

function readPublication(path: string): { checksum: string; size: number } | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (typeof value.checksum !== 'string' || !SHA256_CHECKSUM.test(value.checksum)) return null;
    if (!Number.isSafeInteger(value.size) || (value.size as number) < 0) return null;
    return { checksum: value.checksum, size: value.size as number };
  } catch {
    return null;
  }
}

function readRuntimeOwner(path: string): {
  readonly pid: number;
  readonly host: string;
  readonly heartbeatAt: number | null;
  readonly token: string | null;
} | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (!Number.isSafeInteger(value.pid) || (value.pid as number) < 1) return null;
    if (typeof value.host !== 'string' || value.host.length < 1 || value.host.length > 255) return null;
    const heartbeatAt = Number.isSafeInteger(value.heartbeatAt)
      && (value.heartbeatAt as number) >= 0
      ? value.heartbeatAt as number
      : null;
    const token = typeof value.token === 'string' && value.token.length > 0
      ? value.token
      : null;
    return { pid: value.pid as number, host: value.host, heartbeatAt, token };
  } catch {
    return null;
  }
}

function runtimeOwnerIsStale(owner: {
  readonly pid: number;
  readonly host: string;
  readonly heartbeatAt: number | null;
  readonly token: string | null;
}): boolean {
  if (owner.host === hostname()) return !processIsAlive(owner.pid);
  return owner.heartbeatAt !== null
    && Date.now() - owner.heartbeatAt >= RUNTIME_LEASE_MS;
}

function publicationOwnershipLost(): Error {
  return new StorageDomainError(
    'STORAGE_PROVIDER_UNAVAILABLE',
    'Local storage publication ownership changed; retry the upload.',
    { retryable: true, outcome: 'not-committed' },
  );
}

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (cause) { return !isNodeError(cause, 'ESRCH'); }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error
    && (error as Error & { code?: unknown }).code === code;
}
