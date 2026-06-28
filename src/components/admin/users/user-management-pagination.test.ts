import { describe, expect, test } from 'bun:test';
import {
  buildAdminUserListParams,
  getAdminUserPageWindow,
} from './user-management-pagination';

describe('admin user-management pagination helpers', () => {
  test('builds compact backend list params from filters', () => {
    expect(buildAdminUserListParams(
      { search: '  ops ', role: 'admin', status: 'active' },
      25,
      50,
    )).toEqual({
      limit: 25,
      offset: 50,
      search: 'ops',
      role: 'admin',
      status: 'active',
    });
  });

  test('omits empty search, all-role, and all-status filters', () => {
    expect(buildAdminUserListParams(
      { search: '   ', role: '', status: 'all' },
      100,
      0,
    )).toEqual({
      limit: 100,
      offset: 0,
    });
  });

  test('returns navigation metadata for backend pages', () => {
    expect(getAdminUserPageWindow({
      limit: 25,
      offset: 25,
      count: 25,
      total: 80,
      hasMore: true,
      nextOffset: 50,
    })).toEqual({
      start: 26,
      end: 50,
      label: 'Showing 26-50 of 80',
      canPrevious: true,
      canNext: true,
      previousOffset: 0,
      nextOffset: 50,
    });
  });
});
