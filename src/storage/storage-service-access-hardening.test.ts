/**
 * Regression coverage for additive hierarchical Storage ACL resolution.
 * Drive, ancestor-folder, and exact-object grants compose without allowing a
 * file or a missing unrelated branch to become an authorization parent.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { defineStorageTables, StorageService } from './storage-service';
import type { StorageAdapter } from './types';

let db: ReactiveDB;
let storage: StorageService;

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory' });
  defineStorageTables(db);
  storage = new StorageService(db, inertAdapter);
});

afterEach(() => {
  db.dispose();
});

describe('storage hierarchical access', () => {
  test('combines drive, ancestor, and exact grants and inherits nearest parents', () => {
    const drive = storage.createDrive('owner', { name: 'Access drive' });
    storage.createFolder(drive.drive_id, '/projects', 'owner');
    storage.createFolder(drive.drive_id, '/projects/alpha', 'owner');
    storage.createFolder(drive.drive_id, '/projects/alpha/report', 'owner');
    storage.createFolder(drive.drive_id, '/other', 'owner');

    const driveGrant = storage.grantPermission(drive.drive_id, {
      grantType: 'user',
      grantValue: 'drive-reader',
      permission: 'read',
    });
    const ancestorGrant = storage.grantPermission(drive.drive_id, {
      objectPath: '/projects',
      grantType: 'user',
      grantValue: 'project-editor',
      permission: 'write',
    });
    const exactGrant = storage.grantPermission(drive.drive_id, {
      objectPath: '/projects/alpha/report',
      grantType: 'user',
      grantValue: 'report-admin',
      permission: 'admin',
    });

    expect(can(drive.drive_id, '/projects/alpha/report', 'drive-reader', 'read')).toBe(true);
    expect(can(drive.drive_id, '/projects/alpha/report', 'project-editor', 'write')).toBe(true);
    expect(can(drive.drive_id, '/projects/alpha/report', 'report-admin', 'admin')).toBe(true);
    expect(can(drive.drive_id, '/projects/new/file', 'project-editor', 'write')).toBe(true);
    expect(can(drive.drive_id, '/other/file', 'project-editor', 'read')).toBe(false);

    const considered = storage.listPermissions(drive.drive_id, {
      objectPath: '/projects/alpha/report',
    });
    expect(considered).toHaveLength(3);
    expect(new Set(considered.map((permission) => permission.permission_id))).toEqual(
      new Set([
        driveGrant.permission_id,
        ancestorGrant.permission_id,
        exactGrant.permission_id,
      ]),
    );
  });

  test('does not treat a file as the parent of a nonexistent destination', () => {
    const drive = storage.createDrive('owner', { name: 'File boundary' });
    storage.createFolder(drive.drive_id, '/projects', 'owner');
    storage.createFolder(drive.drive_id, '/projects/file', 'owner');
    const fileRecord = db.prepare(
      'SELECT * FROM storage_objects WHERE drive_id = ? AND path = ?',
    ).get(drive.drive_id, '/projects/file') as { object_id: string };
    db.prepare(
      "UPDATE storage_objects SET type = 'file', mime_type = 'text/plain' WHERE object_id = ?",
    ).run(fileRecord.object_id);
    storage.grantPermission(drive.drive_id, {
      objectPath: '/projects/file',
      grantType: 'user',
      grantValue: 'file-editor',
      permission: 'write',
    });

    expect(can(drive.drive_id, '/projects/file', 'file-editor', 'write')).toBe(true);
    expect(can(drive.drive_id, '/projects/file/child', 'file-editor', 'write')).toBe(false);
  });

  test('keeps role grants additive while requiring trusted property keys', () => {
    storage = new StorageService(db, inertAdapter, {
      isPolicyTrustedProperty: (key) => key === 'department',
    });
    const drive = storage.createDrive('owner', { name: 'Role drive' });
    storage.grantPermission(drive.drive_id, {
      grantType: 'role',
      grantValue: 'reviewer',
      permission: 'read',
    });
    storage.grantPermission(drive.drive_id, {
      grantType: 'property',
      grantKey: 'department',
      grantValue: 'clinical',
      permission: 'write',
    });

    expect(storage.checkAccess(
      drive.drive_id,
      '/not-yet-created',
      'member',
      ['member', 'reviewer'],
      {},
      'read',
    )).toBe(true);
    expect(storage.checkAccess(
      drive.drive_id,
      '/not-yet-created',
      'member',
      [],
      { department: 'clinical' },
      'write',
    )).toBe(true);
    expect(() => storage.grantPermission(drive.drive_id, {
      grantType: 'property',
      grantKey: 'untrusted',
      grantValue: 'yes',
      permission: 'read',
    })).toThrow();
  });
});

function can(
  driveId: string,
  path: string,
  userId: string,
  level: 'read' | 'write' | 'admin',
): boolean {
  return storage.checkAccess(driveId, path, userId, [], {}, level);
}

const inertAdapter: StorageAdapter = {
  writeShutdownSafety: 'cooperative',
  async writeBlob() {
    return { checksum: 'unused', size: 0, headBytes: new Uint8Array() };
  },
  async readBlob() { return null; },
  async readBlobRange() { return null; },
  async removeBlob() {},
  removeBlobSync() {},
  async blobExists() { return true; },
  async blobSize() { return 0; },
};
