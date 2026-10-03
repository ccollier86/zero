/**
 * data-studio-access.test.ts
 *
 * Locks the opt-in Guardian permission and reusable role-fragment contract.
 */

import { describe, expect, test } from 'bun:test';
import {
  DATA_STUDIO_EDITOR_ROLE_FRAGMENT,
  DATA_STUDIO_MANAGER_ROLE_FRAGMENT,
  DATA_STUDIO_MANAGE_PERMISSION,
  DATA_STUDIO_PERMISSION_REGISTRY,
  DATA_STUDIO_READ_PERMISSION,
  DATA_STUDIO_ROLE_FRAGMENTS,
  DATA_STUDIO_VIEWER_ROLE_FRAGMENT,
  DATA_STUDIO_WRITE_PERMISSION,
} from './index';

describe('Data Studio Guardian fragments', () => {
  test('declares a closed tenant-scoped permission registry', () => {
    expect(Object.keys(DATA_STUDIO_PERMISSION_REGISTRY)).toEqual([
      DATA_STUDIO_READ_PERMISSION,
      DATA_STUDIO_WRITE_PERMISSION,
      DATA_STUDIO_MANAGE_PERMISSION,
    ]);
    expect(Object.values(DATA_STUDIO_PERMISSION_REGISTRY).every(
      (permission) => permission.scope === 'tenant',
    )).toBe(true);
    expect(Object.isFrozen(DATA_STUDIO_PERMISSION_REGISTRY)).toBe(true);
    expect(Object.values(DATA_STUDIO_PERMISSION_REGISTRY).every(Object.isFrozen)).toBe(true);
  });

  test('keeps row editing separate from schema management', () => {
    expect(DATA_STUDIO_VIEWER_ROLE_FRAGMENT.permissions).toEqual([
      DATA_STUDIO_READ_PERMISSION,
    ]);
    expect(DATA_STUDIO_EDITOR_ROLE_FRAGMENT.permissions).toEqual([
      DATA_STUDIO_READ_PERMISSION,
      DATA_STUDIO_WRITE_PERMISSION,
    ]);
    expect(DATA_STUDIO_MANAGER_ROLE_FRAGMENT.permissions).toEqual([
      DATA_STUDIO_MANAGE_PERMISSION,
      DATA_STUDIO_READ_PERMISSION,
      DATA_STUDIO_WRITE_PERMISSION,
    ]);
    expect(DATA_STUDIO_EDITOR_ROLE_FRAGMENT.permissions).not.toContain(
      DATA_STUDIO_MANAGE_PERMISSION,
    );
    expect(Object.isFrozen(DATA_STUDIO_ROLE_FRAGMENTS)).toBe(true);
    expect(Object.values(DATA_STUDIO_ROLE_FRAGMENTS).every(Object.isFrozen)).toBe(true);
  });
});
