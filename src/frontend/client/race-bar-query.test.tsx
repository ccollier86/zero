/**
 * Synthetic qualification of bounded Race Bar rollups through existing chart
 * query subscriptions. Null-rendering hook tests use no server aggregate
 * implementation, live databases, app configuration or alternate transport.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import type { RaceBarData } from '../../components/charts/race-bar/race-bar-types';
import { buildRaceBarModel, computeRaceBarSnapshot, preserveRaceBarFramePosition } from '../../components/charts/race-bar/race-bar-model';
import type { ClientTableDef, Row } from '../../sync/types';
import type { AuthClient } from './auth-client';
import { AuthorizationDataBoundaryController } from './authorization-data-boundary';
import { useChartQuery, type ChartQueryResult } from './chart-query';
import { ClientProvider } from './client-context';
import type { Collection } from './collection';
import type { Client, InternalClient } from './sdk';
import { createHookContainer, installMinimalHookDom } from './test-fixtures/react-hook-dom';

type RaceRollupRow = Row & { id: string; period_id: string; period: string; ordinal: number; alpha: number; beta: number };
const items = [{ id: 'alpha', label: 'Alpha' }, { id: 'beta', label: 'Beta' }] as const;
const roots = new Set<Root>();
let restoreDom: () => void;
beforeEach(() => { restoreDom = installMinimalHookDom(); });
afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount());
  roots.clear(); restoreDom();
});

function rollup(id: string, ordinal: number, alpha: number, beta: number): RaceRollupRow {
  return { id: `row-${id}`, period_id: id, period: id, ordinal, alpha, beta };
}

/** Projection orders authorized aggregate rows and admits the complete matrix. */
function projectRollups(rows: readonly RaceRollupRow[]): RaceBarData {
  const data: RaceBarData = { items, frames: rows.slice().sort((a, b) => a.ordinal - b.ordinal || a.period_id.localeCompare(b.period_id))
    .map(row => ({ id: row.period_id, period: row.period, values: { alpha: row.alpha, beta: row.beta } })) };
  buildRaceBarModel(data);
  return data;
}

describe('Race Bar reactive rollup qualification', () => {
  test('actual collection updates admit ordered frames and change ranking and all-item total', async () => {
    const fixture = createFixture();
    fixture.load([rollup('February', 2, 80, 120), rollup('January', 1, 100, 80)]);
    const capture = await renderRaceQuery(fixture.client, projectRollups);
    expect(capture.current()).toMatchObject({ error: null, connected: true, readable: true, rowCount: 2 });
    const initial = buildRaceBarModel(capture.current().data!);
    expect(initial.frames.map(frame => frame.id)).toEqual(['January', 'February']);
    expect(computeRaceBarSnapshot(initial, 1).rows.map(row => [row.item.id, row.value])).toEqual([['beta', 120], ['alpha', 80]]);
    expect(computeRaceBarSnapshot(initial, 1).total).toBe(200);
    await act(async () => fixture.load([rollup('March', 3, 200, 80), rollup('February', 2, 80, 150), rollup('January', 1, 100, 80)]));
    const updated = buildRaceBarModel(capture.current().data!);
    expect(updated.frames.map(frame => frame.id)).toEqual(['January', 'February', 'March']);
    expect(computeRaceBarSnapshot(updated, 1).total).toBe(230);
    expect(computeRaceBarSnapshot(updated, 2).rows.map(row => [row.item.id, row.value])).toEqual([['alpha', 200], ['beta', 80]]);
    expect(computeRaceBarSnapshot(updated, 2).total).toBe(280);
    expect(capture.current().rowCount).toBe(3);
  });

  test('reactive prepend and retention trimming preserve stable presentation-period identity', async () => {
    const fixture = createFixture();
    fixture.load([rollup('January', 1, 100, 80), rollup('February', 2, 80, 120)]);
    const capture = await renderRaceQuery(fixture.client, projectRollups);
    const initial = buildRaceBarModel(capture.current().data!);
    await act(async () => fixture.load([rollup('December', 0, 60, 70), rollup('February', 2, 80, 120), rollup('January', 1, 100, 80)]));
    const prepended = buildRaceBarModel(capture.current().data!);
    const retained = preserveRaceBarFramePosition(initial, prepended, 1);
    expect(retained).toBe(2); expect(prepended.frames[retained]!.id).toBe('February');
    const fraction = preserveRaceBarFramePosition(initial, prepended, .35);
    expect(fraction).toBeCloseTo(1.35, 10);
    expect(computeRaceBarSnapshot(initial, .35).rows.map(row => row.value)).toEqual(computeRaceBarSnapshot(prepended, fraction).rows.map(row => row.value));
    await act(async () => fixture.load([rollup('March', 3, 200, 80), rollup('February', 2, 80, 120)]));
    const trimmed = buildRaceBarModel(capture.current().data!);
    const trimmedPosition = preserveRaceBarFramePosition(prepended, trimmed, retained);
    expect(trimmedPosition).toBe(0); expect(trimmed.frames[trimmedPosition]!.id).toBe('February');
    expect(computeRaceBarSnapshot(trimmed, trimmedPosition).total).toBe(200);
  });

  test('scope retirement masks the complete history without projecting unreadable fallback rows', async () => {
    const fixture = createFixture(), projected: string[][] = [];
    fixture.load([rollup('January', 1, 100, 80)]);
    const project = (rows: readonly RaceRollupRow[]) => { projected.push(rows.map(row => row.period_id)); return projectRollups(rows); };
    const capture = await renderRaceQuery(fixture.client, project);
    expect(capture.current().data!.frames[0]!.id).toBe('January');
    await act(async () => fixture.retireScope());
    expect(capture.current()).toEqual({ data: null, error: null, rowCount: 0, connected: false, readable: false });
    expect(projected).toEqual([['January']]);
    await act(async () => fixture.replaceScope([rollup('New scope period', 1, 7, 3)]));
    expect(capture.current().data!.frames.map(frame => frame.id)).toEqual(['New scope period']);
    expect(computeRaceBarSnapshot(buildRaceBarModel(capture.current().data!), 0).total).toBe(10);
    expect(projected).toEqual([['January'], ['New scope period']]);
  });

  test('same-scope authority retirement masks history until a revalidated replacement is readable', async () => {
    const fixture = createFixture(); fixture.load([rollup('January', 1, 100, 80)]);
    const capture = await renderRaceQuery(fixture.client, projectRollups);
    await act(async () => fixture.retireAuthority());
    expect(capture.current()).toEqual({ data: null, error: null, rowCount: 0, connected: false, readable: false });
    await act(async () => fixture.revalidateAuthority([rollup('Approved period', 1, 4, 5)]));
    expect(capture.current().data!.frames.map(frame => frame.id)).toEqual(['Approved period']);
    expect(capture.current().readable).toBe(true);
    expect(computeRaceBarSnapshot(buildRaceBarModel(capture.current().data!), 0).total).toBe(9);
  });

  test('invalid replacement aggregates fail admission and do not retain a previous readable history', async () => {
    const fixture = createFixture(); fixture.load([rollup('January', 1, 100, 80)]);
    const capture = await renderRaceQuery(fixture.client, projectRollups);
    await act(async () => fixture.load([rollup('Invalid period', 1, -1, 80)]));
    expect(capture.current().data).toBeNull(); expect(capture.current().error?.code).toBe('CHART_QUERY_PROJECTION_FAILED');
    await act(async () => fixture.load([rollup('Valid replacement', 1, 4, 3)]));
    expect(capture.current().error).toBeNull();
    expect(capture.current().data!.frames[0]!.id).toBe('Valid replacement');
    expect(fixture.subscriptions()).toEqual({ rows: 1, connection: 1, authority: 3 });
    await act(async () => capture.root.unmount()); roots.delete(capture.root);
    expect(fixture.subscriptions()).toEqual({ rows: 0, connection: 0, authority: 0 });
  });
});

async function renderRaceQuery(client: Client, project: (rows: readonly RaceRollupRow[]) => RaceBarData) {
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(createHookContainer()); roots.add(root);
  let current!: ChartQueryResult<RaceBarData>;
  function Capture() { current = useChartQuery<RaceRollupRow, RaceBarData>({ table: 'race_rollups', project }); return null; }
  await act(async () => root.render(createElement(ClientProvider, { client, children: createElement(Capture) })));
  return { root, current: () => current };
}

/** Same SDK-shaped subscription/authority stubs used by chart-query.test.tsx. */
function createFixture() {
  let byId: Record<string, RaceRollupRow> = {};
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
    name: 'race_rollups', primaryKey: 'id', getAll: () => byId,
    subscribe(callback: () => void) { rowListeners.add(callback); return () => { rowListeners.delete(callback); }; },
  } as unknown as Collection<RaceRollupRow>;
  const client = {
    auth, collection: () => collection, connected: true,
    onConnectionChange(callback: () => void) { connectionListeners.add(callback); return () => { connectionListeners.delete(callback); }; },
    _syncClient: { tables: { race_rollups: { _pk: 'id', _sync: 'full' as ClientTableDef['_sync'] } } },
    _authorizationDataBoundary: dataBoundary,
  } as unknown as InternalClient;
  const setRows = (rows: RaceRollupRow[]) => { byId = Object.fromEntries(rows.map(row => [row.id, row])); };
  return {
    client,
    load(rows: RaceRollupRow[]) { setRows(rows); for (const callback of rowListeners) callback(); },
    retireScope() {
      Object.assign(auth, { sessionTransition: { ...auth.sessionTransition, phase: 'preparing', revision: 1 } });
      for (const callback of authorityListeners) callback();
    },
    replaceScope(rows: RaceRollupRow[]) {
      Object.assign(auth, { authorizationScopeKey: 'scope-b', user: { userId: 'user-b' }, activeTenant: { tenantId: 'tenant-b' },
        sessionTransition: { ...auth.sessionTransition, phase: 'idle', revision: 2 } });
      setRows(rows); for (const callback of authorityListeners) callback();
    },
    retireAuthority() { Object.assign(auth, { authorizationState: { status: 'revoked' } }); dataBoundary.invalidate(); },
    revalidateAuthority(rows: RaceRollupRow[]) {
      setRows(rows); Object.assign(auth, { authorizationState: { status: 'ready' } });
      for (const callback of authorityListeners) callback();
    },
    subscriptions: () => ({ rows: rowListeners.size, connection: connectionListeners.size, authority: authorityListeners.size }),
  };
}
