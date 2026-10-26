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
