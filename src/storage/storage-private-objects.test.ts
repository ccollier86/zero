/** Real provider files and disposable SYSTEM metadata; artifacts never become drives/Sync objects. */
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReactiveDB } from '../sync/reactive-db';
import { LocalStorageAdapter } from './local-adapter';
import { defineStorageTables, StorageService } from './storage-service';

test('private artifacts use normal CAS references but no drive, object, signed URL or Sync registration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'storage-private-'));
  const db = createReactiveDB({ mode: 'memory' }); defineStorageTables(db);
  const adapter = new LocalStorageAdapter(root), service = new StorageService(db, adapter);
  try {
    const bytes = new TextEncoder().encode('synthetic private evidence');
    const first = await service.privateObjects.put('zero.logging', 'export-one', bytes, 'application/x-ndjson');
    expect(await service.privateObjects.put('zero.logging', 'export-one', bytes, 'application/x-ndjson')).toEqual(first);
    await service.privateObjects.put('zero.logging', 'export-two', bytes, 'application/x-ndjson');
    expect(service.listDrives()).toEqual([]);
    expect(db.list('storage_objects')).toEqual([]);
    expect(db.getTableNames()).not.toContain('_storage_private_objects');
    expect(db.prepare('SELECT ref_count FROM _storage_blobs WHERE checksum=?').get(first.checksum)).toMatchObject({ ref_count: 2 });
    const opened = await service.privateObjects.get('zero.logging', 'export-one', () => {});
    expect(await new Response(opened!.stream).text()).toBe('synthetic private evidence');
    expect(await service.privateObjects.get('zero.other', 'export-one', () => {})).toBeNull();
    await expect(service.privateObjects.get('zero.logging', 'export-one', () => { throw new Error('Forbidden'); })).rejects.toThrow('Forbidden');
    await expect(service.privateObjects.put('zero.logging', 'export-one', new Uint8Array([1]), 'application/x-ndjson')).rejects.toMatchObject({ code: 'STORAGE_CONFLICT' });
    await service.privateObjects.delete('zero.logging', 'export-one'); await service.retryBlobCleanup();
    expect(await adapter.blobExists(first.checksum)).toBe(true);
    await service.privateObjects.delete('zero.logging', 'export-two'); await service.retryBlobCleanup();
    expect(await adapter.blobExists(first.checksum)).toBe(false);
    expect(await service.privateObjects.delete('zero.logging', 'export-two')).toBe(false);
  } finally { await service.stop(); db.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('private artifact commit failure publishes no reference and cannot damage an existing shared blob', async () => {
  const root = await mkdtemp(join(tmpdir(), 'storage-private-failure-'));
  const db = createReactiveDB({ mode: 'memory' }); defineStorageTables(db);
  const adapter = new LocalStorageAdapter(root), service = new StorageService(db, adapter);
  try {
    const bytes = new Uint8Array([1, 2, 3]);
    const kept = await service.privateObjects.put('zero.logging', 'kept', bytes, 'application/octet-stream');
    await expect(service.privateObjects.put('zero.logging', 'rejected', bytes, 'application/octet-stream', () => { throw new Error('Revoked'); })).rejects.toThrow('Revoked');
    expect(await service.privateObjects.get('zero.logging', 'rejected', () => {})).toBeNull();
    expect(await adapter.blobExists(kept.checksum)).toBe(true);
    expect(db.prepare('SELECT ref_count FROM _storage_blobs WHERE checksum=?').get(kept.checksum)).toMatchObject({ ref_count: 1 });
  } finally { await service.stop(); db.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('private object identifiers support export IDs and invalid stored metadata cannot reach a provider read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'storage-private-metadata-'));
  const db = createReactiveDB({ mode: 'memory' }); defineStorageTables(db);
  const adapter = new LocalStorageAdapter(root), service = new StorageService(db, adapter);
  try {
    await service.privateObjects.put('zero.logging', 'export.with-dot', new Uint8Array([1]), 'application/octet-stream');
    const original = adapter.readBlob.bind(adapter); let reads = 0;
    adapter.readBlob = async checksum => { reads++; return original(checksum); };
    db.prepare('UPDATE _storage_private_objects SET checksum=? WHERE id=?').run('../not-a-checksum', 'export.with-dot');
    await expect(service.privateObjects.get('zero.logging', 'export.with-dot', () => {})).rejects.toMatchObject({ code: 'STORAGE_PROVIDER_UNAVAILABLE' });
    expect(reads).toBe(0);
  } finally { await service.stop(); db.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('streamed private files verify exact bytes before publication and preserve the bounded legacy put contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'storage-private-stream-'));
  const db = createReactiveDB({ mode: 'memory' }); defineStorageTables(db);
  const adapter = new LocalStorageAdapter(root), service = new StorageService(db, adapter);
  try {
    const bytes = new TextEncoder().encode('Synthetic streamed attachment'), checksum = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    const input = { checksum, sizeBytes: bytes.byteLength, maxBytes: 1024 };
    const source = () => new Blob([Uint8Array.from(bytes).buffer]).stream();
    await expect(service.privateObjects.putStream('zero.messaging.attachments', 'bad-digest', source(), 'text/plain', { ...input, checksum: '0'.repeat(64) }, () => {})).rejects.toMatchObject({ code: 'STORAGE_INPUT_INVALID' });
    await expect(service.privateObjects.putStream('zero.messaging.attachments', 'bad-size', source(), 'text/plain', { ...input, sizeBytes: 1 }, () => {})).rejects.toMatchObject({ code: 'STORAGE_INPUT_INVALID' });
    expect(await service.privateObjects.get('zero.messaging.attachments', 'bad-digest', () => {})).toBeNull();
    expect(await service.privateObjects.get('zero.messaging.attachments', 'bad-size', () => {})).toBeNull();
    await expect(service.privateObjects.putStream('zero.messaging.attachments', 'revoked', source(), 'text/plain', input, () => { throw new Error('Synthetic revoked stream'); })).rejects.toThrow('Synthetic revoked stream');
    const accepted = await service.privateObjects.putStream('zero.messaging.attachments', 'accepted', source(), 'text/plain', input, () => {});
    expect(accepted).toMatchObject({ checksum, sizeBytes: bytes.byteLength });
    expect(service.listDrives()).toEqual([]); expect(db.list('storage_objects')).toEqual([]);
    expect(await service.privateObjects.putStream('zero.messaging.attachments', 'accepted', source(), 'text/plain', input, () => {})).toEqual(accepted);
    await expect(service.privateObjects.put('zero.logging', 'still-bounded', new Uint8Array(8 * 1024 * 1024 + 16385), 'application/octet-stream')).rejects.toMatchObject({ code: 'STORAGE_INPUT_INVALID' });
    const large = new Uint8Array(9 * 1024 * 1024), largeChecksum = new Bun.CryptoHasher('sha256').update(large).digest('hex');
    await service.privateObjects.putStream('zero.messaging.attachments', 'large-stream', new Blob([large.buffer]).stream(), 'application/octet-stream', { checksum: largeChecksum, sizeBytes: large.byteLength, maxBytes: 16 * 1024 * 1024 }, () => {});
    const loaded = await service.privateObjects.get('zero.messaging.attachments', 'large-stream', () => {});
    expect(loaded?.object.sizeBytes).toBe(large.byteLength); await loaded?.stream.cancel();
  } finally { await service.stop(); db.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('private object authorization cannot yield before I/O or inside its publication transaction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'storage-private-yield-'));
  const db = createReactiveDB({ mode: 'memory' }); defineStorageTables(db);
  const adapter = new LocalStorageAdapter(root), service = new StorageService(db, adapter);
  try {
    const bytes = new Uint8Array([1, 2, 3]), input = { sizeBytes: 3, checksum: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'), maxBytes: 3 };
    let writes = 0; const write = adapter.writeBlob.bind(adapter);
    adapter.writeBlob = (...args) => { writes++; return write(...args); };
    const yielded = async () => { throw new Error('Synthetic delayed authority rejection'); };
    await expect(service.privateObjects.putStream('zero.messaging.attachments', 'before-io', bytes, 'application/octet-stream', input, yielded)).rejects.toMatchObject({ code: 'AUTH_STATE_INVARIANT_FAILED' });
    expect(writes).toBe(0);
    let checks = 0;
    await expect(service.privateObjects.putStream('zero.messaging.attachments', 'at-commit', bytes, 'application/octet-stream', input,
      () => { if (++checks > 1) return yielded(); })).rejects.toMatchObject({ code: 'AUTH_STATE_INVARIANT_FAILED' });
    expect(await service.privateObjects.get('zero.messaging.attachments', 'at-commit', () => {})).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM _storage_private_objects').get()).toMatchObject({ n: 0 });
    await service.privateObjects.put('zero.logging', 'kept', bytes, 'application/octet-stream');
    await expect(service.privateObjects.get('zero.logging', 'kept', yielded)).rejects.toMatchObject({ code: 'AUTH_STATE_INVARIANT_FAILED' });
    await expect(service.privateObjects.delete('zero.logging', 'kept', yielded)).rejects.toMatchObject({ code: 'AUTH_STATE_INVARIANT_FAILED' });
    expect(await service.privateObjects.get('zero.logging', 'kept', () => {})).not.toBeNull();
  } finally { await service.stop(); db.dispose(); await rm(root, { recursive: true, force: true }); }
});
