import { describe, expect, test } from 'bun:test';

import {
  SyncTenantSnapshotBudget,
  SyncTenantSnapshotBudgetError,
} from './sync-tenant-snapshot-budget';

describe('Tenant Sync snapshot aggregate budget', () => {
  test('bounds page attempts, including retries', () => {
    const budget = new SyncTenantSnapshotBudget({ maxPageRequests: 2 });
    budget.beginPageRequest();
    budget.beginPageRequest();
    expect(() => budget.beginPageRequest()).toThrow(SyncTenantSnapshotBudgetError);
    try {
      budget.beginPageRequest();
    } catch (error) {
      expect(error).toMatchObject({ reason: 'pages' });
    }
  });

  test('bounds pre-filter row count and aggregate source/projected bytes', () => {
    const rows = new SyncTenantSnapshotBudget({ maxRows: 1 });
    expect(() => rows.observePage([{ id: '1' }, { id: '2' }]))
      .toThrow(SyncTenantSnapshotBudgetError);

    const bytes = new SyncTenantSnapshotBudget({ maxObservedBytes: 20 });
    bytes.observePage([{ id: '1' }]);
    expect(() => bytes.observeProjectedRow({ value: 'expanded-value' }))
      .toThrow(SyncTenantSnapshotBudgetError);
  });

  test('uses one deadline across all pages and drain boundaries', () => {
    let now = 100;
    const budget = new SyncTenantSnapshotBudget({
      now: () => now,
      deadlineMs: 50,
    });
    budget.beginPageRequest();
    now = 151;
    expect(() => budget.assertWithinDeadline()).toThrow(
      SyncTenantSnapshotBudgetError,
    );
    try {
      budget.assertWithinDeadline();
    } catch (error) {
      expect(error).toMatchObject({ reason: 'deadline' });
    }
  });
});
