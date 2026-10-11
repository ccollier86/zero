/** Isolated lifecycle fixture: no SDK client, network, providers or databases. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useVectorVisualization } from './vector-visualization-hooks';
import type { VectorVisualizationAdapter, VectorVisualizationSnapshot } from '../../vector/visualization-types';

function snapshot(id: string): VectorVisualizationSnapshot {
  return { id, index: 'public', kind: 'search', status: 'running', revision: 1,
    createdAt: '2026-10-08T12:00:00Z', updatedAt: '2026-10-08T12:00:00Z', stages: [] };
}
const cancellations: string[] = [], history: Array<{ selected: string; presented: string | null }> = [];
const listeners = new Map<string, Set<(value: VectorVisualizationSnapshot | null) => void>>();
const adapter: VectorVisualizationAdapter = {
  get: async id => snapshot(id),
  subscribe(id, listener) { const group = listeners.get(id) ?? new Set(); listeners.set(id, group); group.add(listener); listener(snapshot(id));
    return () => { group.delete(listener); }; },
  cancel: async id => { cancellations.push(id); return { ...snapshot(id), revision: 2, status: 'cancelled' }; },
};
let switchSelection: (id: string) => void, latestCancel: () => Promise<VectorVisualizationSnapshot | null>, oldCancel: (() => Promise<VectorVisualizationSnapshot | null>) | null = null;
function Fixture() {
  const [id, setId] = React.useState('A'); switchSelection = setId;
  const observation = useVectorVisualization(id, { adapter }); latestCancel = observation.cancel;
  history.push({ selected: id, presented: observation.snapshot?.id ?? null });
  return <output data-selected={id}>{observation.snapshot?.id ?? 'none'}</output>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><Fixture /></React.StrictMode>);
declare global { interface Window { __vectorHookFixture: {
  select(id: string): void; saveCancel(): void; cancelOld(): Promise<string>; cancelCurrent(): Promise<string>;
  history(): typeof history; cancellations(): string[]; unmount(): void; subscriberCount(): number;
}; } }
async function result(action: () => Promise<unknown>) { try { await action(); return 'ok'; } catch (error) { return error instanceof Error ? error.name : 'unknown'; } }
window.__vectorHookFixture = {
  select(id) { flushSync(() => switchSelection(id)); }, saveCancel() { oldCancel = latestCancel; },
  cancelOld: () => result(() => oldCancel!()), cancelCurrent: () => result(() => latestCancel()),
  history: () => history, cancellations: () => cancellations,
  unmount() { flushSync(() => root.unmount()); }, subscriberCount: () => [...listeners.values()].reduce((count, group) => count + group.size, 0),
};
