/** Real Elysia/Bun sockets and actor files: full/lazy policy visibility, tracked projections and live authority replacement. */
import { describe, expect, test } from 'bun:test';
import {
  arrayPolicyExpected, arrayPolicyOrganizations, arrayPolicyScopes,
  createArrayPolicyFixture, syncedIds, waitForArrayPolicy, type ArrayPolicyScope,
} from '../resources/test-fixtures/array-policy-fixture';

const TIMEOUT = 30_000;
const sameIds = (actual: readonly string[], expected: readonly string[]) => JSON.stringify(actual) === JSON.stringify(expected);

describe('array overlap Fabric full and lazy Sync', () => {
  test('exact full snapshots and lazy HTTP baselines agree for A, B, A+B and no groups in two organizations', async () => {
    const fixture = await createArrayPolicyFixture();
    try {
      for (const organization of arrayPolicyOrganizations) for (const scope of Object.keys(arrayPolicyScopes) as ArrayPolicyScope[]) {
        for (const mode of ['full', 'lazy'] as const) {
          const connection = await fixture.sync(organization, scope, mode);
          if (mode === 'lazy') {
            expect(syncedIds(connection.client)).toEqual([]);
            await connection.load('records'); await connection.load('record_children');
          }
          expect(syncedIds(connection.client)).toEqual([...arrayPolicyExpected[scope]]);
          expect(syncedIds(connection.client, 'record_children')).toEqual(arrayPolicyExpected[scope].map(id => `child-${id}`));
          const rows = Object.values(connection.client.store.getSnapshot().context.records as Record<string, { title: string }>);
          expect(rows.every(row => row.title.startsWith(organization + ' '))).toBeTrue();
          connection.client.disconnect();
        }
      }
    } finally { await fixture.close(); }
  }, TIMEOUT);

  test('a tracked parent/child A+B to B change removes both from A, retains B, and reconnect cannot restore forbidden rows', async () => {
    const fixture = await createArrayPolicyFixture();
    try {
      const organization = arrayPolicyOrganizations[0], otherOrganization = arrayPolicyOrganizations[1];
      const aFull = await fixture.sync(organization, 'a', 'full'), aLazy = await fixture.sync(organization, 'a', 'lazy');
      const bFull = await fixture.sync(organization, 'b', 'full'), bLazy = await fixture.sync(organization, 'b', 'lazy');
      const noGroups = await fixture.sync(organization, 'none', 'full'), otherA = await fixture.sync(otherOrganization, 'a', 'full');
      await aLazy.load('records'); await aLazy.load('record_children'); await bLazy.load('records'); await bLazy.load('record_children');
      expect(syncedIds(aFull.client)).toEqual([...arrayPolicyExpected.a]);
      const before = await fixture.getTenantClient(organization).get('records', '03-ab', { consistency: { mode: 'strong' } });
      const commit = await fixture.getTenantClient(organization).command('records.relabel', { id: '03-ab', groups: ['B'] }, { idempotencyKey: 'tracked-relabel' });
      expect(commit.sequence.seq - before.sequence.seq).toBe(2);
      const expectedA = arrayPolicyExpected.a.filter(id => id !== '03-ab');
      for (const connection of [aFull, aLazy]) {
        await waitForArrayPolicy(() => sameIds(syncedIds(connection.client), expectedA), 'A removes relabelled parent');
        await waitForArrayPolicy(() => sameIds(syncedIds(connection.client, 'record_children'), expectedA.map(id => `child-${id}`)), 'A removes relabelled child');
        expect(connection.messages.some(message => message.type === 'sync.change' && message.table === 'records' && message.rowId === '03-ab' && message.op === 'DELETE')).toBeTrue();
      }
      for (const connection of [bFull, bLazy]) {
        await waitForArrayPolicy(() => {
          const context = connection.client.store.getSnapshot().context;
          return (context.records as Record<string, { access_groups: string }>)['03-ab']?.access_groups === '["B"]'
            && (context.record_children as Record<string, { access_groups: string }>)['child-03-ab']?.access_groups === '["B"]';
        }, 'B retains canonical parent and child');
        expect(syncedIds(connection.client)).toEqual([...arrayPolicyExpected.b]);
        expect(connection.messages.some(message => message.type === 'sync.change' && message.rowId === '03-ab' && message.op === 'DELETE')).toBeFalse();
      }
      expect(syncedIds(otherA.client)).toEqual([...arrayPolicyExpected.a]);
      // Send the real mutation protocol against a row the member can no longer read.
      await expect(aFull.client.updateAsync('records', '03-ab', { title: 'Forbidden after relabel' }, { timeoutMs: 3_000 })).rejects.toThrow();
      expect((await fixture.getTenantClient(organization).get('records', '03-ab')).value?.title).toBe(`${organization} Needle 03-ab`);
      aFull.client.reconnect(); await aFull.client.waitForAuthorizationBaseline(5_000);
      expect(syncedIds(aFull.client)).toEqual(expectedA);
      expect(syncedIds(aFull.client, 'record_children')).toEqual(expectedA.map(id => `child-${id}`));
      const reconnected = aFull.messages.filter(message => message.type === 'sync.catchup');
      expect(reconnected.length).toBeGreaterThan(0);

      await fixture.getTenantClient(organization).batch({ mutations: [
        { type: 'create', table: 'records', row: { id: 'live-a', title: 'Live A', access_groups: '["A"]', state: 'published' } },
        { type: 'create', table: 'records', row: { id: 'live-b', title: 'Live B', access_groups: '["B"]', state: 'published' } },
      ] }, { idempotencyKey: 'live-inserts' });
      await waitForArrayPolicy(() => syncedIds(aFull.client).includes('live-a') && syncedIds(bFull.client).includes('live-b'), 'allowed live inserts');
      expect(syncedIds(aFull.client)).not.toContain('live-b'); expect(syncedIds(bFull.client)).not.toContain('live-a');
      expect(syncedIds(noGroups.client)).toEqual([]); expect(syncedIds(otherA.client)).not.toContain('live-a');
      await fixture.getTenantClient(organization).batch({ mutations: [
        { type: 'delete', table: 'records', id: '01-a' }, { type: 'delete', table: 'record_children', id: 'child-01-a' },
      ] }, { idempotencyKey: 'tracked-deletes' });
      await waitForArrayPolicy(() => !syncedIds(aFull.client).includes('01-a') && !syncedIds(aLazy.client, 'record_children').includes('child-01-a'), 'authorized durable deletes');
    } finally { await fixture.close(); }
  }, TIMEOUT);

  test('trusted group broadening/narrowing purges stale full and lazy caches and live membership revocation remains denied', async () => {
    const fixture = await createArrayPolicyFixture();
    try {
      const organization = arrayPolicyOrganizations[0];
      const full = await fixture.sync(organization, 'a', 'full'), lazy = await fixture.sync(organization, 'a', 'lazy');
      const otherOrganization = await fixture.sync(arrayPolicyOrganizations[1], 'a', 'full');
      await lazy.load('records'); await lazy.load('record_children');
      const firstFullInvalidations = full.invalidations, firstLazyInvalidations = lazy.invalidations;
      fixture.setGroups(organization, 'a', ['A', 'B']);
      await waitForArrayPolicy(() => full.invalidations > firstFullInvalidations && full.client.connected
        && sameIds(syncedIds(full.client), arrayPolicyExpected.both), 'full policy broadening automatically reconnects');
      await waitForArrayPolicy(() => lazy.invalidations > firstLazyInvalidations && lazy.client.connected, 'lazy broadening purges and reconnects');
      expect(syncedIds(lazy.client)).toEqual([]);
      expect(syncedIds(lazy.client, 'record_children')).toEqual([]);
      await lazy.load('records'); await lazy.load('record_children');
      expect(syncedIds(lazy.client)).toEqual([...arrayPolicyExpected.both]);

      const broadFullInvalidations = full.invalidations, broadLazyInvalidations = lazy.invalidations;
      fixture.setGroups(organization, 'a', ['B']);
      await waitForArrayPolicy(() => full.invalidations > broadFullInvalidations && full.client.connected
        && sameIds(syncedIds(full.client), arrayPolicyExpected.b), 'full policy narrowing clears forbidden records');
      await waitForArrayPolicy(() => lazy.invalidations > broadLazyInvalidations && lazy.client.connected, 'lazy narrowing purges stale records');
      expect(syncedIds(lazy.client)).toEqual([]); expect(syncedIds(lazy.client, 'record_children')).toEqual([]);
      await lazy.load('records'); await lazy.load('record_children');
      expect(syncedIds(lazy.client)).toEqual([...arrayPolicyExpected.b]);
      expect(syncedIds(lazy.client, 'record_children')).toEqual(arrayPolicyExpected.b.map(id => `child-${id}`));
      expect(syncedIds(otherOrganization.client)).toEqual([...arrayPolicyExpected.a]);

      const verifierBarrier = fixture.holdNextResolution(organization, 'a');
      await verifierBarrier.started; fixture.revoke(organization, 'a'); verifierBarrier.release();
      await waitForArrayPolicy(() => !full.client.connected && !lazy.client.connected && syncedIds(full.client).length === 0 && syncedIds(lazy.client).length === 0, 'revocation purges all cached rows');
      expect([...full.authFailures, ...lazy.authFailures].every(message => message.includes('Auth context changed'))).toBeTrue();
      full.client.reconnect(); lazy.client.reconnect();
      await Bun.sleep(50); // Bounded negative observation after token lookup immediately returns null.
      expect(syncedIds(full.client)).toEqual([]); expect(syncedIds(lazy.client)).toEqual([]);
      const denied = await fixture.request(organization, 'a', '/api/data?table=records');
      expect([401, 403]).toContain(denied.status);
      expect(syncedIds(otherOrganization.client)).toEqual([...arrayPolicyExpected.a]);
    } finally { await fixture.close(); }
  }, TIMEOUT);

  test('already revoked durable membership is fenced before a bearer lookup can misclassify it as token expiry', async () => {
    const fixture = await createArrayPolicyFixture();
    try {
      const organization = arrayPolicyOrganizations[0], full = await fixture.sync(organization, 'a', 'full');
      expect(syncedIds(full.client)).toEqual([...arrayPolicyExpected.a]);
      const calls = fixture.resolutionCount(organization, 'a');
      fixture.revoke(organization, 'a');
      await waitForArrayPolicy(() => !full.client.connected && syncedIds(full.client).length === 0, 'durable pre-verifier revocation purges');
      expect(fixture.resolutionCount(organization, 'a')).toBe(calls);
      expect(full.authFailures).toEqual(['Auth failed (code 4001): Auth context changed']);
    } finally { await fixture.close(); }
  }, TIMEOUT);
});
