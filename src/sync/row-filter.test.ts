import { describe, expect, test } from 'bun:test';
import type { Change, SyncRowFilter } from './types';
import { filterSyncRows, projectSyncChange } from './row-filter';

describe('Sync row filtering and projection', () => {
  const ownerProjection: SyncRowFilter = {
    matches: (row) => row.owner_id === 'owner-1',
    project(row) {
      const { server_secret: _serverSecret, ...publicRow } = row;
      return publicRow;
    },
  };

  test('authorizes snapshots against full rows and projects only visible rows', () => {
    const rows = [
      { id: 'visible', owner_id: 'owner-1', server_secret: 'hidden' },
      { id: 'foreign', owner_id: 'owner-2', server_secret: 'hidden' },
    ];

    expect(filterSyncRows(rows, ownerProjection)).toEqual([
      { id: 'visible', owner_id: 'owner-1' },
    ]);
    expect(rows[0]).toHaveProperty('server_secret', 'hidden');
  });

  test('uses the same projection for inserts and updates', () => {
    const inserted = projectSyncChange(change({
      op: 'INSERT',
      row: { id: 'row-1', owner_id: 'owner-1', server_secret: 'hidden' },
    }), ownerProjection);
    const updated = projectSyncChange(change({
      op: 'UPDATE',
      row: { id: 'row-1', owner_id: 'owner-1', server_secret: 'changed' },
      previousRow: { id: 'row-1', owner_id: 'owner-1', server_secret: 'hidden' },
    }), ownerProjection);

    expect(inserted?.row).toEqual({ id: 'row-1', owner_id: 'owner-1' });
    expect(updated?.row).toEqual({ id: 'row-1', owner_id: 'owner-1' });
  });

  test('evaluates scope transitions before projection', () => {
    const leaving = projectSyncChange(change({
      op: 'UPDATE',
      row: { id: 'row-1', owner_id: 'owner-2', server_secret: 'hidden' },
      previousRow: { id: 'row-1', owner_id: 'owner-1', server_secret: 'hidden' },
    }), ownerProjection);

    expect(leaving).toMatchObject({ op: 'DELETE', row: null });
  });
});

function change(overrides: Partial<Change>): Change {
  return {
    seq: 1,
    table: 'records',
    op: 'INSERT',
    rowId: 'row-1',
    row: null,
    ts: 1,
    ...overrides,
  };
}
