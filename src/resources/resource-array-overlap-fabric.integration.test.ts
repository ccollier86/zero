/** Real HTTP and Fabric IPC acceptance: overlap applies before page/search/count and cannot be ORed away by clients. */
import { describe, expect, test } from 'bun:test';
import type { DatabaseFindFilter } from '../databases/database-operations';
import {
  arrayPolicyEscapedGroup, arrayPolicyExpected, arrayPolicyOrganizations, arrayPolicyScopes,
  createArrayPolicyFixture, type ArrayPolicyScope,
} from './test-fixtures/array-policy-fixture';

const TIMEOUT = 30_000;
const visibleFilter = (groups: readonly string[]): readonly DatabaseFindFilter[] => [{ type: 'allOf', filters: [
  { type: 'field', field: 'access_groups', operator: 'arrayOverlaps', value: groups },
  { type: 'anyOf', filters: [
    { type: 'field', field: 'state', operator: 'eq', value: 'published' },
    { type: 'field', field: 'state', operator: 'eq', value: 'review' },
  ] },
] }];

describe('array overlap physical tenant HTTP and Fabric boundary', () => {
  test('all member scopes see exact IDs and page counts in both physical organizations', async () => {
    const fixture = await createArrayPolicyFixture();
    try {
      for (const organization of arrayPolicyOrganizations) for (const scope of Object.keys(arrayPolicyScopes) as ArrayPolicyScope[]) {
        for (const path of ['/api/resources/records?order=id&dir=asc&limit=100', '/api/data?table=records&order=id&dir=asc&limit=100']) {
          const response = await fixture.request(organization, scope, path);
          expect(response.status).toBe(200);
          const body = await response.json() as { rows: Array<{ id: string; title: string }>; page: { count: number; hasMore: boolean } };
          expect(body.rows.map(row => row.id)).toEqual([...arrayPolicyExpected[scope]]);
          expect(body.page.count).toBe(arrayPolicyExpected[scope].length);
          expect(body.page.hasMore).toBeFalse();
          expect(body.rows.every(row => row.title.startsWith(organization + ' '))).toBeTrue();
        }
      }
      // The same IDs reside in two files; no default shadow exists.
      expect(fixture.manager.appRuntime.db.hasTable('records')).toBeFalse();
      const one = await fixture.getTenantClient(arrayPolicyOrganizations[0]).get('records', '01-a');
      const two = await fixture.getTenantClient(arrayPolicyOrganizations[1]).get('records', '01-a');
      expect(one.value?.title).not.toBe(two.value?.title);
      fixture.setGroups(arrayPolicyOrganizations[0], 'a', [arrayPolicyEscapedGroup]);
      const escaped = await fixture.request(arrayPolicyOrganizations[0], 'a', '/api/data?table=records&order=id');
      expect(escaped.status).toBe(200);
      expect(await escaped.json()).toMatchObject({ rows: [{ id: '16-escaped' }], page: { count: 1 } });
    } finally { await fixture.close(); }
  }, TIMEOUT);

  test('search, sorting, bounded pages, filters and malicious tenant/OR inputs retain policy authority', async () => {
    const fixture = await createArrayPolicyFixture();
    try {
      const organization = arrayPolicyOrganizations[0];
      for (const offset of [0, 2]) {
        const response = await fixture.request(organization, 'a', `/api/data?table=records&search=Needle&searchField=title&sort=id:desc&limit=2&offset=${offset}`);
        expect(response.status).toBe(200);
        const body = await response.json() as { rows: Array<{ id: string }>; page: { count: number; hasMore: boolean; nextOffset: number | null } };
        expect(body.rows.map(row => row.id)).toEqual(offset === 0 ? ['05-duplicates', '04-second'] : ['03-ab', '01-a']);
        expect(body.page).toMatchObject({ count: 2, hasMore: offset === 0, nextOffset: offset === 0 ? 2 : null });
      }
      for (const query of ['filter=id:02-b', 'filter=access_groups:%5B%22B%22%5D', 'filter=state:disabled']) {
        const response = await fixture.request(organization, 'a', `/api/data?table=records&${query}`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ rows: [], page: { count: 0, hasMore: false } });
      }
      const adversarialOr = encodeURIComponent(JSON.stringify({ type: 'anyOf', filters: [
        { type: 'field', field: 'id', operator: 'eq', value: '02-b' },
        { type: 'field', field: 'state', operator: 'eq', value: 'published' },
      ] }));
      const invalid = await fixture.request(organization, 'a', `/api/data?table=records&filter=${adversarialOr}`);
      expect(invalid.status).toBe(400);
      const selector = await fixture.request(organization, 'a', `/api/data?table=records&order=id&dir=asc&tenantId=${arrayPolicyOrganizations[1]}`);
      expect(selector.status).toBe(200);
      const selected = await selector.json() as { rows: Array<{ id: string; title: string }> };
      expect(selected.rows.map(row => row.id)).toEqual([...arrayPolicyExpected.a]);
      expect(selected.rows.every(row => row.title.startsWith(organization + ' '))).toBeTrue();
    } finally { await fixture.close(); }
  }, TIMEOUT);

  test('guarded get/update/delete cannot access hidden records and allowed changes stay inside the tenant', async () => {
    const fixture = await createArrayPolicyFixture();
    try {
      const organization = arrayPolicyOrganizations[0];
      for (const init of [undefined, { method: 'PATCH', body: JSON.stringify({ title: 'Unauthorized edit' }) }, { method: 'DELETE' }]) {
        const response = await fixture.request(organization, 'a', '/api/resources/records/02-b', init);
        expect([403, 404]).toContain(response.status);
      }
      expect((await fixture.getTenantClient(organization).get('records', '02-b')).value?.title).toBe(`${organization} Needle 02-b`);
      const update = await fixture.request(organization, 'a', '/api/resources/records/01-a', { method: 'PATCH', body: JSON.stringify({ title: 'Accepted A edit' }) });
      expect(update.status).toBe(200);
      expect((await fixture.getTenantClient(organization).get('records', '01-a')).value?.title).toBe('Accepted A edit');
      expect((await fixture.getTenantClient(arrayPolicyOrganizations[1]).get('records', '01-a')).value?.title).toBe(`${arrayPolicyOrganizations[1]} Needle 01-a`);
      const denyGroupEdit = await fixture.request(organization, 'a', '/api/resources/records/01-a', { method: 'PATCH', body: JSON.stringify({ access_groups: '["B"]' }) });
      expect(denyGroupEdit.status).toBe(400);
      const deleted = await fixture.request(organization, 'a', '/api/resources/records/05-duplicates', { method: 'DELETE' });
      expect(deleted.status).toBe(200);
      expect((await fixture.getTenantClient(organization).get('records', '05-duplicates')).value).toBeNull();
    } finally { await fixture.close(); }
  }, TIMEOUT);

  test('bound finds and filtered cursor lists retain exact semantics through real writer and reader executors', async () => {
    const fixture = await createArrayPolicyFixture();
    try {
      for (const organization of arrayPolicyOrganizations) for (const scope of Object.keys(arrayPolicyScopes) as ArrayPolicyScope[]) {
        const client = fixture.getTenantClient(organization);
        for (const consistency of ['strong', 'snapshot'] as const) {
          const found = await client.find('records', { filters: visibleFilter(arrayPolicyScopes[scope]), order: [{ field: 'id', direction: 'asc' }], limit: 100 }, { consistency: { mode: consistency } });
          expect(found.value.map(row => row.id)).toEqual([...arrayPolicyExpected[scope]]);
        }
        const first = await client.list('records', { limit: 2, filters: visibleFilter(arrayPolicyScopes[scope]) });
        const second = await client.list('records', { limit: 100, ...(first.value.nextCursor ? { after: first.value.nextCursor } : {}), filters: visibleFilter(arrayPolicyScopes[scope]) });
        const ids = first.value.nextCursor ? [...first.value.rows, ...second.value.rows] : first.value.rows;
        expect(ids.map(row => row.id)).toEqual([...arrayPolicyExpected[scope]]);
      }
      const escaped = await fixture.getTenantClient(arrayPolicyOrganizations[0]).find('records', { limit: 100, filters: visibleFilter([arrayPolicyEscapedGroup]) });
      expect(escaped.value.map(row => row.id)).toEqual(['16-escaped']);
      const explicitEmptyString = await fixture.getTenantClient(arrayPolicyOrganizations[0]).find('records', { limit: 100, filters: visibleFilter(['']) });
      expect(explicitEmptyString.value.map(row => row.id)).toEqual(['15-sentinel']);
      expect(fixture.executorRoles).toContain('writer'); expect(fixture.executorRoles).toContain('reader');
      expect(fixture.executorDispatches.some(dispatch => dispatch.role === 'writer' && dispatch.type === 'find')).toBeTrue();
      expect(fixture.executorDispatches.some(dispatch => dispatch.role === 'reader' && dispatch.type === 'find')).toBeTrue();
      expect(fixture.executorDispatches.some(dispatch => dispatch.role === 'reader' && dispatch.type === 'list')).toBeTrue();
    } finally { await fixture.close(); }
  }, TIMEOUT);
});
