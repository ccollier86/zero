/** Public row pages preserve the exact Fabric read token without a second query. */
import { expect, test } from 'bun:test';
import type { AsyncDatabaseClient } from '../databases/database-operations';
import { DataStudioService } from './data-studio-service';
import { parseRowPage } from '../frontend/client/data-studio-response';

test('one strong, scope-bound read yields rows and their sequence', async () => {
  let calls = 0;
  const data = {
    async query(_name: string, _input: unknown, options: unknown) {
      calls += 1;
      expect(options).toMatchObject({ consistency: { mode: 'strong' } });
      return { sequence: { seq: 42 }, value: { ok: true,
        value: { rows: [], total: 0, limit: 25, offset: 0, nextOffset: null } } };
    },
  } as unknown as AsyncDatabaseClient;
  const service = new DataStudioService({ data, actor: { userId: 'user-one', membershipId: 'membership-one' } });
  const page = await service.listRows({ tableId: 'table-one' });
  expect(page.readSequence).toBe(42);
  expect(parseRowPage(page).readSequence).toBe(42);
  expect(calls).toBe(1);
});
test('portable parser preserves compatibility while rejecting malformed optional tokens', () => {
  const old = { rows: [], total: 0, limit: 50, offset: 0, nextOffset: null };
  expect(parseRowPage(old).readSequence).toBeUndefined();
  for (const readSequence of [-1, 1.5, '42', Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => parseRowPage({ ...old, readSequence })).toThrow();
  }
});
