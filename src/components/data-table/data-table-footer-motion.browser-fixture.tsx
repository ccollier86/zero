/** Isolated real TanStack controls and WAAPI digit observations; no application services, credentials, or global shortcuts. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { getCoreRowModel, getPaginationRowModel, useReactTable, type PaginationState, type SortingState } from '@tanstack/react-table';
import { DataTablePagination } from './data-table-pagination';
import { DataTableColumnHeader } from './data-table-column-header';
import { DataTableRollingNumber } from './data-table-rolling-number';
import { configureFrontendObservability } from '../../frontend/client/observability';
type Mode = 'local' | 'offset' | 'cursor';
type MotionRecord = { value: string | undefined; character: string | null; frames: Keyframe[]; options: KeyframeAnimationOptions };
const animations: MotionRecord[] = [], prefetched: number[] = [], navigations: { page: number; origin: string }[] = [];
const observed: { code: string; metadata?: Record<string, unknown> }[] = [];
configureFrontendObservability({ sink: { emit: event => { observed.push({ code: event.code, metadata: event.metadata }); } } });
let holdPrefetch = false, rejectPrefetch: ((cause: unknown) => void) | undefined;
let updateValue: (value: number) => void, updateMode: (mode: Mode) => void, updateMotion: (enabled: boolean) => void,
  updateLoading: (loading: boolean) => void, latestPage = 0;
const nativeAnimate = Element.prototype.animate;
Element.prototype.animate = function (frames, options) {
  if (this.parentElement?.getAttribute('data-slot') === 'data-table-digit') animations.push({
    value: this.closest<HTMLElement>('[data-slot="data-table-rolling-number"]')?.dataset.value,
    character: this.textContent, frames: frames as Keyframe[], options: options as KeyframeAnimationOptions,
  });
  return nativeAnimate.call(this, frames, options);
};
function Fixture() {
  const [value, setValue] = React.useState(99), [mode, setMode] = React.useState<Mode>('local');
  const [motion, setMotion] = React.useState(true), [loading, setLoading] = React.useState(false), [held, setHeld] = React.useState(12);
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [sorting, setSorting] = React.useState<SortingState>([]);
  updateValue = setValue; updateMode = next => { setMode(next); setPagination({ pageIndex: 0, pageSize: 10 }); };
  updateMotion = setMotion; updateLoading = setLoading; latestPage = pagination.pageIndex;
  const data = React.useMemo(() => Array.from({ length: mode === 'local' ? 25 : 7 }, (_, index) => ({ id: String(index), name: `Record ${index}` })), [mode]);
  const table = useReactTable({ data, columns: [{ accessorKey: 'name' }], state: { pagination, sorting },
    onPaginationChange: setPagination, onSortingChange: setSorting, manualPagination: mode !== 'local',
    getCoreRowModel: getCoreRowModel(), getPaginationRowModel: getPaginationRowModel() });
  return <main style={{ margin: 12, minWidth: 0 }}>
    <label>Outside editor <input aria-label="Outside editor" /></label>
    <div style={{ marginBlock: 16 }}><DataTableColumnHeader column={table.getColumn('name')!} title="Name" motionEnabled={motion} /></div>
    <div data-testid="roller" style={{ marginBlock: 16 }}><DataTableRollingNumber value={value} motionEnabled={motion} /></div>
    <DataTablePagination table={table} motionEnabled={motion} keyboardNavigation loading={loading}
      serverPage={mode === 'local' ? undefined : mode === 'offset' ? { mode: 'offset', offset: 40, hasMore: true }
        : { mode: 'cursor', total: 35, hasMore: true, nextCursor: 'opaque' }}
      newCount={held} onRevealNew={() => setHeld(0)} onPrefetchPage={page => {
        prefetched.push(page); if (holdPrefetch) return new Promise<void>((_, reject) => { rejectPrefetch = reject; });
      }}
      onPageNavigate={(page, origin) => navigations.push({ page, origin })} />
  </main>;
}
declare global { interface Window { __tableFooterMotion: {
  value(value: number): void; mode(mode: Mode): void; motion(enabled: boolean): void; loading(enabled: boolean): void;
  animations(): MotionRecord[]; clear(): void; page(): number; prefetch(): number[]; navigation(): { page: number; origin: string }[];
  holdPrefetch(): void; rejectPrefetch(): void; observed(): typeof observed;
} } }
window.__tableFooterMotion = { value: value => updateValue(value), mode: mode => updateMode(mode), motion: value => updateMotion(value),
  loading: value => updateLoading(value), animations: () => animations, clear: () => { animations.length = 0; },
  page: () => latestPage, prefetch: () => prefetched, navigation: () => navigations,
  holdPrefetch: () => { holdPrefetch = true; }, rejectPrefetch: () => rejectPrefetch?.(new Error('PRIVATE_PREFETCH_CAUSE')),
  observed: () => observed };
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
