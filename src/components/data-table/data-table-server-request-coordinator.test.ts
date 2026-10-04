import { describe, expect, test } from 'bun:test';
import { DataTableServerRequestCoordinator } from './data-table-server-request-coordinator';
import { dataTableServerSourceIdentity } from './data-table-server-source-identity';
import {
  dataTableServerStateMatches,
  projectDataTableServerRows,
} from './use-data-table-server-source';

describe('DataTableServerRequestCoordinator', () => {
  test('aborts the previous query and rejects a reverse-order response', async () => {
    const coordinator = new DataTableServerRequestCoordinator();
    const accepted: string[] = [];
    const first = coordinator.begin('tenant-a', 'query-alpha');
    const second = coordinator.begin('tenant-a', 'query-beta');

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);

    await Promise.resolve();
    if (coordinator.isCurrent(second, 'tenant-a', true)) accepted.push(second.queryKey);
    if (coordinator.isCurrent(first, 'tenant-a', true)) accepted.push(first.queryKey);

    expect(accepted).toEqual(['query-beta']);
  });

  test('fences each query id independently from authorization scope changes', () => {
    const coordinator = new DataTableServerRequestCoordinator();
    const request = coordinator.begin('tenant-a', 'same-shape');

    expect(coordinator.isCurrent(request, 'tenant-a', true)).toBe(true);
    expect(coordinator.isCurrent(request, 'tenant-b', true)).toBe(false);
    expect(coordinator.isCurrent(request, 'tenant-a', false)).toBe(false);

    coordinator.finish(request);
    expect(coordinator.isCurrent(request, 'tenant-a', true)).toBe(false);
  });

  test('keeps response order independent from row identity', () => {
    const rows = projectDataTableServerRows([
      { document_id: 'doc-b', title: 'Second' },
      { document_id: 'doc-a', title: 'First' },
    ], 'document_id');

    expect(rows.orderedIds).toEqual(['doc-b', 'doc-a']);
    expect(rows.byId['doc-a']).toEqual({ document_id: 'doc-a', title: 'First' });
  });

  test('treats prototype-like primary keys as ordinary isolated row ids', () => {
    const rows = projectDataTableServerRows([
      { document_id: '__proto__', title: 'Prototype safe' },
      { document_id: 'constructor', title: 'Constructor safe' },
    ], 'document_id');

    expect(Object.getPrototypeOf(rows.byId)).toBeNull();
    expect(rows.orderedIds).toEqual(['__proto__', 'constructor']);
    expect(rows.byId.__proto__).toEqual({
      document_id: '__proto__',
      title: 'Prototype safe',
    });
  });

  test('retains accepted rows during same-query refresh and masks them on query change', () => {
    const accepted = { boundaryKey: 'tenant-a', signature: 'query-alpha' };

    // Loading is deliberately not part of the visibility check: a manual or
    // live refresh of the same query keeps the accepted page on screen.
    expect(dataTableServerStateMatches(
      accepted,
      'tenant-a',
      'query-alpha',
      true,
    )).toBe(true);
    expect(dataTableServerStateMatches(
      accepted,
      'tenant-a',
      'query-beta',
      true,
    )).toBe(false);
    expect(dataTableServerStateMatches(
      accepted,
      'tenant-b',
      'query-alpha',
      true,
    )).toBe(false);
  });

  test('partitions accepted rows when a custom adapter is replaced', () => {
    const first = { query: async () => ({ rows: [], page: { mode: 'offset' as const, offset: 0, hasMore: false } }) };
    const second = { query: first.query };

    expect(dataTableServerSourceIdentity({ type: 'server', table: 'docs', adapter: first }))
      .toBe(dataTableServerSourceIdentity({ type: 'server', table: 'docs', adapter: first }));
    expect(dataTableServerSourceIdentity({ type: 'server', table: 'docs', adapter: first }))
      .not.toBe(dataTableServerSourceIdentity({ type: 'server', table: 'docs', adapter: second }));
  });
});
