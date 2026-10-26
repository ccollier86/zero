/** Real Bun HTTP streams and cleanup faults must not turn valid uploaded bytes into invalid input. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalStorageAdapter } from './local-adapter';

const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';

test('native HTTP upload persists exact bytes across async file writes and reader cleanup', async () => {
  await mkdir(scratch, { recursive: true }); const root = await mkdtemp(join(scratch, 'storage-http-stream-'));
  const adapter = new LocalStorageAdapter(root), bytes = new Uint8Array(70000).fill(37);
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    try { return Response.json(await adapter.writeBlob(request.body!, bytes.length), { status: 201 }); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.name : 'UNKNOWN' }, { status: 500 }); }
  } });
  try {
    const response = await fetch('http://127.0.0.1:' + server.port, { method: 'PUT', body: new Blob([bytes], { type: 'image/webp' }) });
    expect(response.status).toBe(201);
    const result = await response.json() as { checksum: string; size: number };
    expect(result.size).toBe(bytes.length);
    expect(result.checksum).toBe(new Bun.CryptoHasher('sha256').update(bytes).digest('hex'));
    expect(new Uint8Array(await new Response(await adapter.readBlob(result.checksum)).arrayBuffer())).toEqual(bytes);
  } finally { await server.stop(true); adapter.stop(); await rm(root, { recursive: true, force: true }); }
});

test('a reader release failure neither rejects completed bytes nor masks the substantive input failure', async () => {
  await mkdir(scratch, { recursive: true }); const root = await mkdtemp(join(scratch, 'storage-reader-cleanup-'));
  const adapter = new LocalStorageAdapter(root);
  const stream = (fail: boolean) => {
    let consumed = false;
    return { getReader: () => ({
      async read() {
        if (fail) throw new Error('Synthetic source failure');
        if (consumed) return { done: true, value: undefined };
        consumed = true; return { done: false, value: new Uint8Array([1, 2, 3]) };
      }, async cancel() {}, releaseLock() { throw new TypeError('Synthetic reader cleanup failure'); },
    }) } as unknown as ReadableStream<Uint8Array>;
  };
  try {
    expect((await adapter.writeBlob(stream(false), 10)).size).toBe(3);
    await expect(adapter.writeBlob(stream(true), 10)).rejects.toThrow('Synthetic source failure');
  } finally { adapter.stop(); await rm(root, { recursive: true, force: true }); }
});
