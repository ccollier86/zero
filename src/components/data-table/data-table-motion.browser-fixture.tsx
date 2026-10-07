/** Real React/TanStack/native-table engine fixture; no platform transport, backend, theme or live data. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useDataTableMotion } from './use-data-table-motion';
import { DataTableMotionSnapshotBridge } from './data-table-motion-snapshot';

interface RecordRow { id: string; name: string }
interface Inputs { rows: RecordRow[]; queryKey: string; pageIndex: number; loading: boolean; error: boolean; enabled: boolean; allowSkeleton: boolean; navigationOrigin: 'pointer' | 'keyboard' }
const initialRows = ['a', 'b', 'c'].map(id => ({ id, name: 'Record ' + id }));
const savedNodes = new Map<string, Element>(), busyEvents: boolean[] = [];
let change: (patch: Partial<Inputs>) => void, scope: () => void, unmount: () => void;
let capturedIds: string[] = [];
const captureBusy = (value: boolean) => busyEvents.push(value);
function Grid({ initialLoading }: { initialLoading: boolean }) {
  const [input, setInput] = React.useState<Inputs>({ rows: initialLoading ? [] : initialRows, queryKey: 'initial', pageIndex: 0,
    loading: initialLoading, error: false, enabled: true, allowSkeleton: true, navigationOrigin: 'pointer' });
  change = patch => setInput(previous => ({ ...previous, ...patch }));
  const table = useReactTable({ data: input.rows, columns: [{ accessorKey: 'name' }], getCoreRowModel: getCoreRowModel(), getRowId: row => row.id });
  const motion = useDataTableMotion({ ...input, rows: table.getRowModel().rows, pageSize: 3, onBusyChange: captureBusy });
  return <div ref={motion.containerRef} data-frame data-busy={motion.busy} data-skeleton={motion.showSkeleton} data-reveal={motion.initialReveal} data-pending={motion.pending}>
    <table><thead><tr><th>Name</th></tr></thead>
      <DataTableMotionSnapshotBridge frameKey={motion.frameKey} capture={() => {
        const snapshot = motion.snapshotBeforeUpdate(); capturedIds = [...(snapshot?.rows.keys() ?? [])]; return snapshot;
      }} commit={motion.commitSnapshot}>
        <tbody ref={motion.bodyRef} style={{ display: motion.showSkeleton ? 'none' : undefined }} inert={motion.showSkeleton || undefined} aria-hidden={motion.showSkeleton || undefined}>
          {motion.rows.map(({ row, leaving }) => <tr key={row.id} ref={motion.rowRef(row.id)} data-row-id={row.id} data-leaving={leaving || undefined}
              aria-hidden={leaving || undefined} inert={leaving || undefined}>
              <td><input aria-label={'Name ' + row.id} defaultValue={row.original.name} disabled={leaving} /><span>{row.original.name}</span></td>
            </tr>)}
        </tbody>
        {motion.showSkeleton && <tbody data-skeleton-body>
          {Array.from({ length: 3 }, (_, index) => <tr key={'sk-' + index} data-skeleton-row><td>Loading row</td></tr>)}
        </tbody>}
      </DataTableMotionSnapshotBridge>
    </table>
  </div>;
}
function App() {
  const [generation, setGeneration] = React.useState(0), [visible, setVisible] = React.useState(true);
  scope = () => setGeneration(previous => previous + 1); unmount = () => setVisible(false);
  return visible ? <Grid key={generation} initialLoading={document.documentElement.dataset.initialLoading === 'true'} /> : <p>Unmounted</p>;
}
declare global {
  interface Window {
    __motionEngine: {
      change(patch: Partial<Inputs>): void;
      save(id: string): void;
      same(id: string): boolean;
      scope(): void;
      unmount(): void;
      busyEvents(): boolean[];
      capturedIds(): string[];
    };
  }
}
window.__motionEngine = {
  change: patch => change(patch), save: id => { const node = document.querySelector(`[data-row-id="${id}"]`); if (node) savedNodes.set(id, node); },
  same: id => savedNodes.get(id) === document.querySelector(`[data-row-id="${id}"]`), scope: () => scope(), unmount: () => unmount(), busyEvents: () => busyEvents, capturedIds: () => capturedIds,
};
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
