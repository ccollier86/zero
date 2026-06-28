/**
 * local-adapter.ts
 *
 * Local filesystem byte adapter for storage blobs. This file owns
 * content-addressed file persistence and checksum calculation only; storage
 * metadata, permissions, and route behavior remain in the service/plugin layer.
 */

import { resolve, dirname, join } from 'path';
import { mkdirSync, existsSync, renameSync, unlinkSync, statSync, readdirSync } from 'fs';
import type { StorageAdapter } from './types';

// ─── Content-Addressable Local Adapter ───────────────────────────────────

/**
 * Store files on local filesystem using content-addressable storage.
 *
 * Layout: `{baseDir}/blobs/{aa}/{bb}/{aabbcc...rest}`
 *
 * Two-level directory sharding by SHA-256 prefix prevents
 * any single directory from growing too large.
 *
 * Deduplication is automatic — same content = same checksum = one file on disk.
 */
export class LocalStorageAdapter implements StorageAdapter {
  private baseDir: string;
  private blobDir: string;
  private tmpDir: string;

  constructor(baseDir: string = '.storage') {
    this.baseDir = resolve(baseDir);
    this.blobDir = join(this.baseDir, 'blobs');
    this.tmpDir = join(this.baseDir, 'tmp');

    for (const dir of [this.baseDir, this.blobDir, this.tmpDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    // Clean orphaned temp files from previous crashes
    this.cleanupTmpDir();
  }

  async writeBlob(
    data: ReadableStream<Uint8Array> | Uint8Array | Blob,
    maxSize?: number
  ): Promise<{ checksum: string; size: number; headBytes: Uint8Array }> {
    // Collect bytes and compute SHA-256 in one pass
    const bytes = await toBytes(data, maxSize);
    const checksum = await sha256(bytes);

    // Return first 512 bytes for MIME detection (avoids re-read)
    const headBytes = bytes.slice(0, Math.min(512, bytes.length));

    // If blob already exists, skip the write
    const blobPath = this.blobPath(checksum);
    if (existsSync(blobPath)) {
      return { checksum, size: bytes.length, headBytes };
    }

    // Write to temp file first, then rename (atomic)
    const tmpPath = join(this.tmpDir, `upload_${crypto.randomUUID()}`);
    const dir = dirname(blobPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    await Bun.write(tmpPath, bytes);

    // Atomic move — if another process wrote the same blob concurrently, that's fine
    try {
      renameSync(tmpPath, blobPath);
    } catch {
      // Blob appeared between our exists check and rename — clean up temp
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    }

    return { checksum, size: bytes.length, headBytes };
  }

  async readBlob(checksum: string): Promise<ReadableStream<Uint8Array> | null> {
    const path = this.blobPath(checksum);
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    return file.stream();
  }

  async readBlobRange(
    checksum: string,
    start: number,
    end: number
  ): Promise<ReadableStream<Uint8Array> | null> {
    const path = this.blobPath(checksum);
    const file = Bun.file(path);
    if (!(await file.exists())) return null;

    // Bun.file().slice() returns a Blob for the byte range — zero-copy
    const slice = file.slice(start, end + 1);
    return slice.stream();
  }

  async removeBlob(checksum: string): Promise<void> {
    const path = this.blobPath(checksum);
    if (existsSync(path)) unlinkSync(path);
  }

  async blobExists(checksum: string): Promise<boolean> {
    return Bun.file(this.blobPath(checksum)).exists();
  }

  async blobSize(checksum: string): Promise<number> {
    const path = this.blobPath(checksum);
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
  }

  /**
   * Resolve a checksum to a filesystem path with 2-level sharding.
   * e.g., "aabbccdd..." → "{blobDir}/aa/bb/aabbccdd..."
   */
  private blobPath(checksum: string): string {
    const a = checksum.slice(0, 2);
    const b = checksum.slice(2, 4);
    return join(this.blobDir, a, b, checksum);
  }

  private cleanupTmpDir(): void {
    try {
      const files = readdirSync(this.tmpDir);
      for (const f of files) {
        try { unlinkSync(join(this.tmpDir, f)); } catch {}
      }
    } catch {}
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function toBytes(
  data: ReadableStream<Uint8Array> | Uint8Array | Blob,
  maxSize?: number
): Promise<Uint8Array> {
  if (data instanceof Uint8Array) {
    if (maxSize && data.length > maxSize) {
      throw new Error(`File size ${data.length} exceeds limit of ${maxSize} bytes`);
    }
    return data;
  }
  if (data instanceof Blob) {
    if (maxSize && data.size > maxSize) {
      throw new Error(`File size ${data.size} exceeds limit of ${maxSize} bytes`);
    }
    return new Uint8Array(await data.arrayBuffer());
  }

  // ReadableStream — count bytes as we go
  const chunks: Uint8Array[] = [];
  const reader = data.getReader();
  let totalLen = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalLen += value.length;
    if (maxSize && totalLen > maxSize) {
      reader.cancel();
      throw new Error(`File size exceeds limit of ${maxSize} bytes`);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
