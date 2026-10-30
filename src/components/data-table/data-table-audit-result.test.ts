import { expect, test } from 'bun:test';
import { DataTableAuditResult } from './data-table-audit-result';
const receipt = (id: string) => ({ id, digest: 'a'.repeat(64), kind: 'list' as const, table: 'records', count: 1, expiresAt: 1000 });
test('only actual committed result rows are associated; held arrivals and helper reads are not displayed', () => {
  const owner = new DataTableAuditResult(), old = [{ id: 'one', value: 'old' }], next = [{ id: 'two', value: 'new' }];
  owner.remember(old, receipt('first'));
  expect(owner.displayed(old)?.id).toBe('first');
  owner.remember(next, receipt('prefetch'));
  expect(owner.displayed(old)?.id).toBe('first');
  expect(owner.displayed(next)?.id).toBe('prefetch');
  expect(owner.displayed([{ id: 'fake', value: 'not-returned' }])).toBeUndefined();
});
test('identical live refreshes do not manufacture new display revisions; changes do', () => {
  const owner = new DataTableAuditResult(), one = [{ id: 'one', state: 'draft' }];
  owner.remember(one, receipt('first')); expect(owner.displayed(one)?.id).toBe('first');
  const same = [{ id: 'one', state: 'draft' }]; owner.remember(same, receipt('background-refresh'));
  expect(owner.displayed(same)?.id).toBe('first');
  const changed = [{ id: 'one', state: 'approved' }]; owner.remember(changed, receipt('changed'));
  expect(owner.displayed(changed)?.id).toBe('changed');
});
