/**
 * Synthetic qualification of bounded Funnel cohort rollups through existing
 * chart-query subscriptions and authorization boundaries. No live database,
 * app configuration, backend aggregate API or alternate transport is used.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { buildFunnelModel, computeFunnelSnapshot, normalizeFunnelView } from '../../components/charts/funnel/funnel-model';
import type { FunnelData, FunnelView } from '../../components/charts/funnel/funnel-types';
import type { ClientTableDef, Row } from '../../sync/types';
import type { AuthClient } from './auth-client';
import { AuthorizationDataBoundaryController } from './authorization-data-boundary';
import { useChartQuery, type ChartQueryResult } from './chart-query';
import { ClientProvider } from './client-context';
import type { Collection } from './collection';
import type { Client, InternalClient } from './sdk';
import { createHookContainer, installMinimalHookDom } from './test-fixtures/react-hook-dom';

type FunnelRollupRow = Row & { id: string; stage_id: string; stage_label: string; stage_ordinal: number;
  segment_id: string; segment_label: string; segment_ordinal: number; value: number };
const roots = new Set<Root>();
let restoreDom: () => void;
beforeEach(() => { restoreDom = installMinimalHookDom(); });
afterEach(async () => { for (const root of roots) await act(async () => root.unmount()); roots.clear(); restoreDom(); });

const rollup = (stage: string, ordinal: number, segment: string, value: number, segmentOrdinal = segment === 'mobile' ? 1 : 2): FunnelRollupRow =>
  ({ id: `${stage}:${segment}`, stage_id: stage, stage_label: stage, stage_ordinal: ordinal,
    segment_id: segment, segment_label: segment, segment_ordinal: segmentOrdinal, value });
const initialRows = (): FunnelRollupRow[] => [rollup('start', 0, 'mobile', 100), rollup('start', 0, 'desktop', 80),
  rollup('middle', 1, 'mobile', 50), rollup('middle', 1, 'desktop', 30)];

/** Pure application projection owns rollup ordering; model admission rejects malformed cohorts. */
function projectRollups(rows: readonly FunnelRollupRow[]): FunnelData {
  const ordered = rows.slice().sort((a, b) => a.stage_ordinal - b.stage_ordinal || a.stage_id.localeCompare(b.stage_id));
  const segmentRows = rows.slice().sort((a, b) => a.segment_ordinal - b.segment_ordinal || a.segment_id.localeCompare(b.segment_id));
  const segments = Array.from(new Map(segmentRows.map(row => [row.segment_id, { id: row.segment_id, label: row.segment_label }])).values());
  const stages = new Map<string, { id: string; label: string; values: Record<string, number> }>();
  for (const row of ordered) {
    const stage = stages.get(row.stage_id) ?? { id: row.stage_id, label: row.stage_label, values: Object.create(null) as Record<string, number> };
    if (Object.hasOwn(stage.values, row.segment_id)) throw new Error('Duplicate stage/segment aggregate.');
    stage.values[row.segment_id] = row.value; stages.set(stage.id, stage);
  }
  const data: FunnelData = { segments, stages: Array.from(stages.values()) };
  buildFunnelModel(data);
  return data;
}

describe('Funnel reactive cohort rollup qualification', () => {
  test('actual row inserts, updates and deletions recompute complete cohort totals and retention', async () => {
    const fixture = createFixture(); fixture.load(initialRows().reverse());
    const capture = await renderFunnelQuery(fixture.client, projectRollups);
    expect(capture.current()).toMatchObject({ error: null, connected: true, readable: true, rowCount: 4 });
    const initial = computeFunnelSnapshot(buildFunnelModel(capture.current().data!));
    expect(initial.values.map(row => [row.stage.id, row.value])).toEqual([['start', 180], ['middle', 80]]);
    expect(initial.conversionRate).toBeCloseTo(80 / 180);
    await act(async () => fixture.insert(rollup('end', 2, 'mobile', 10), rollup('end', 2, 'desktop', 5)));
    const inserted = computeFunnelSnapshot(buildFunnelModel(capture.current().data!));
    expect(inserted.values.map(row => row.value)).toEqual([180, 80, 15]);
    expect(inserted.values[2]!.keptFromPrevious).toBeCloseTo(15 / 80);
    await act(async () => fixture.update('middle:mobile', { value: 60 }));
    const updated = computeFunnelSnapshot(buildFunnelModel(capture.current().data!));
    expect(updated.values.map(row => row.value)).toEqual([180, 90, 15]);
    expect(updated.values[2]!.dropOff).toBeCloseTo(1 - 15 / 90);
    await act(async () => fixture.remove('end:mobile', 'end:desktop'));
    const deleted = computeFunnelSnapshot(buildFunnelModel(capture.current().data!));
    expect(deleted.values.map(row => row.stage.id)).toEqual(['start', 'middle']);
    expect(deleted.conversionRate).toBe(0.5); expect(capture.current().rowCount).toBe(4);
  });

  test('segment-ID view projection survives reordered cohorts and retires a removed segment', async () => {
    const fixture = createFixture(); fixture.load(initialRows());
    const capture = await renderFunnelQuery(fixture.client, projectRollups);
    const selected: FunnelView = { kind: 'segment', id: 'mobile' };
    expect(computeFunnelSnapshot(buildFunnelModel(capture.current().data!), selected).values.map(row => row.value)).toEqual([100, 50]);
    await act(async () => fixture.load(initialRows().map(row => ({ ...row, segment_ordinal: row.segment_id === 'mobile' ? 2 : 1 }))));
    const reordered = buildFunnelModel(capture.current().data!);
    expect(reordered.segments.map(segment => segment.id)).toEqual(['desktop', 'mobile']);
    expect(normalizeFunnelView(reordered, selected)).toEqual(selected);
    expect(computeFunnelSnapshot(reordered, selected).values.map(row => row.value)).toEqual([100, 50]);
    await act(async () => fixture.remove('start:mobile', 'middle:mobile'));
    const retired = buildFunnelModel(capture.current().data!);
    expect(normalizeFunnelView(retired, selected)).toEqual({ kind: 'total' });
    expect(computeFunnelSnapshot(retired, selected).values.map(row => row.value)).toEqual([80, 30]);
  });

  test('scope retirement masks the old cohort without projecting unreadable fallback rows', async () => {
    const fixture = createFixture(), projected: string[][] = []; fixture.load(initialRows());
    const capture = await renderFunnelQuery(fixture.client, rows => { projected.push(rows.map(row => row.id)); return projectRollups(rows); });
    expect(capture.current().data!.stages).toHaveLength(2);
    await act(async () => fixture.retireScope());
    expect(capture.current()).toEqual({ data: null, error: null, rowCount: 0, connected: false, readable: false });
    expect(projected).toHaveLength(1);
    await act(async () => fixture.replaceScope([rollup('approved', 0, 'desktop', 7)]));
    expect(capture.current().data!.stages.map(stage => stage.id)).toEqual(['approved']);
    expect(computeFunnelSnapshot(buildFunnelModel(capture.current().data!)).baseline).toBe(7);
    expect(projected).toHaveLength(2);
  });

  test('same-scope authority purge masks stale cohort counts until a revalidated replacement is readable', async () => {
    const fixture = createFixture(); fixture.load(initialRows());
    const capture = await renderFunnelQuery(fixture.client, projectRollups);
    await act(async () => fixture.retireAuthority());
    expect(capture.current()).toEqual({ data: null, error: null, rowCount: 0, connected: false, readable: false });
    await act(async () => fixture.revalidateAuthority([rollup('replacement', 0, 'mobile', 4)]));
    expect(capture.current().readable).toBe(true); expect(capture.current().data!.stages.map(stage => stage.id)).toEqual(['replacement']);
    expect(computeFunnelSnapshot(buildFunnelModel(capture.current().data!)).baseline).toBe(4);
  });

  test('increased or otherwise invalid cohort replacements fail admission and never retain the old chart', async () => {
    const fixture = createFixture(); fixture.load(initialRows());
    const capture = await renderFunnelQuery(fixture.client, projectRollups);
    await act(async () => fixture.update('middle:mobile', { value: 101 }));
    expect(capture.current().data).toBeNull(); expect(capture.current().error?.code).toBe('CHART_QUERY_PROJECTION_FAILED');
    await act(async () => fixture.update('middle:mobile', { value: 25 }));
    expect(capture.current().error).toBeNull();
    expect(computeFunnelSnapshot(buildFunnelModel(capture.current().data!)).values.map(row => row.value)).toEqual([180, 55]);
    await act(async () => fixture.update('middle:desktop', { value: NaN }));
    expect(capture.current().data).toBeNull(); expect(capture.current().error?.code).toBe('CHART_QUERY_PROJECTION_FAILED');
    expect(fixture.subscriptions()).toEqual({ rows: 1, connection: 1, authority: 3 });
    await act(async () => capture.root.unmount()); roots.delete(capture.root);
    expect(fixture.subscriptions()).toEqual({ rows: 0, connection: 0, authority: 0 });
  });
});

async function renderFunnelQuery(client: Client, project: (rows: readonly FunnelRollupRow[]) => FunnelData) {
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(createHookContainer()); roots.add(root);
  let current!: ChartQueryResult<FunnelData>;
  function Capture() { current = useChartQuery<FunnelRollupRow, FunnelData>({ table: 'funnel_rollups', project }); return null; }
  await act(async () => root.render(createElement(ClientProvider, { client, children: createElement(Capture) })));
  return { root, current: () => current };
}

/** SDK-shaped collection and authorization stubs; this is not a server integration fixture. */
function createFixture() {
  let byId: Record<string, FunnelRollupRow> = {};
  const rowListeners = new Set<() => void>(), connectionListeners = new Set<() => void>(), authorityListeners = new Set<() => void>();
  const dataBoundary = new AuthorizationDataBoundaryController();
  const auth = {
    authorizationScopeKey: 'scope-a', user: { userId: 'user-a' }, activeTenant: { tenantId: 'tenant-a' },
    isLoading: false, isAuthenticated: true, isRestoring: false, authorizationState: { status: 'ready' },
    sessionTransition: { phase: 'idle', operation: null, revision: 0, recoverable: false, error: null },
    subscribe(callback: () => void) { authorityListeners.add(callback); return () => { authorityListeners.delete(callback); }; },
    subscribeAuthorization(callback: () => void) { authorityListeners.add(callback); return () => { authorityListeners.delete(callback); }; },
  } as unknown as AuthClient;
  const collection = {
    name: 'funnel_rollups', primaryKey: 'id', getAll: () => byId,
    subscribe(callback: () => void) { rowListeners.add(callback); return () => { rowListeners.delete(callback); }; },
  } as unknown as Collection<FunnelRollupRow>;
  const client = {
    auth, collection: () => collection, connected: true,
    onConnectionChange(callback: () => void) { connectionListeners.add(callback); return () => { connectionListeners.delete(callback); }; },
    _syncClient: { tables: { funnel_rollups: { _pk: 'id', _sync: 'full' as ClientTableDef['_sync'] } } },
    _authorizationDataBoundary: dataBoundary,
  } as unknown as InternalClient;
  const publish = () => { for (const callback of rowListeners) callback(); };
  const setRows = (rows: FunnelRollupRow[]) => { byId = Object.fromEntries(rows.map(row => [row.id, row])); };
  return {
    client,
    load(rows: FunnelRollupRow[]) { setRows(rows); publish(); },
    insert(...rows: FunnelRollupRow[]) { byId = { ...byId, ...Object.fromEntries(rows.map(row => [row.id, row])) }; publish(); },
    update(id: string, fields: Partial<FunnelRollupRow>) { byId = { ...byId, [id]: { ...byId[id]!, ...fields } }; publish(); },
    remove(...ids: string[]) { byId = { ...byId }; for (const id of ids) delete byId[id]; publish(); },
    retireScope() {
      Object.assign(auth, { sessionTransition: { ...auth.sessionTransition, phase: 'preparing', revision: 1 } });
      for (const callback of authorityListeners) callback();
    },
    replaceScope(rows: FunnelRollupRow[]) {
      Object.assign(auth, { authorizationScopeKey: 'scope-b', user: { userId: 'user-b' }, activeTenant: { tenantId: 'tenant-b' },
        sessionTransition: { ...auth.sessionTransition, phase: 'idle', revision: 2 } });
      setRows(rows); for (const callback of authorityListeners) callback();
    },
    retireAuthority() { Object.assign(auth, { authorizationState: { status: 'revoked' } }); dataBoundary.invalidate(); },
    revalidateAuthority(rows: FunnelRollupRow[]) {
      setRows(rows); Object.assign(auth, { authorizationState: { status: 'ready' } });
      for (const callback of authorityListeners) callback();
    },
    subscriptions: () => ({ rows: rowListeners.size, connection: connectionListeners.size, authority: authorityListeners.size }),
  };
}
