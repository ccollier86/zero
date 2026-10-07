/** React-owned row/page presentation queue. Sources own network, identity, counts and authority; this hook owns no fetches. */
'use client';
import * as React from 'react';
import type { Row as TableRow } from '@tanstack/react-table';
import { DATA_TABLE_MOTION as M } from './data-table-motion-tokens';
import { dataTableMotionRowsMatch, dataTableMotionTargetChange, reconcileDataTableMotionRows, type DataTableMotionRow, type DataTableMotionTarget } from './data-table-motion-model';
import { DataTableMotionPlayer, type DataTableMotionKind, type DataTableMotionSnapshot } from './data-table-motion-player';

export interface UseDataTableMotionOptions<T> extends DataTableMotionTarget {
  readonly rows: readonly TableRow<T>[];
  readonly loading: boolean;
  readonly error?: boolean;
  readonly enabled?: boolean;
  /** Keep acknowledged editors mounted and visible during a pending refetch. */
  readonly allowSkeleton?: boolean;
  readonly navigationOrigin?: 'pointer' | 'keyboard';
  readonly onBusyChange?: (busy: boolean) => void;
  readonly freshRowIds?: ReadonlySet<string>;
}
interface Presentation<T> {
  rows: DataTableMotionRow<T>[]; frameKey: number; showSkeleton: boolean; initialReveal: boolean;
  kind: DataTableMotionKind; direction: number; factor: number; enterDelay: number;
}
interface Operation { id: number; kind: 'page' | 'query'; exited: boolean; startedAt: number; loaderScheduled?: boolean; loaderVisibleAt?: number }

/** One latest-target queue; changes of criteria preempt navigation and every asynchronous continuation is retired on unmount. */
export function useDataTableMotion<T>(options: UseDataTableMotionOptions<T>) {
  const bodyRef = React.useRef<HTMLTableSectionElement>(null), containerRef = React.useRef<HTMLDivElement>(null);
  const nodes = React.useRef(new Map<string, HTMLTableRowElement>()), rowCallbacks = React.useRef(new Map<string, React.RefCallback<HTMLTableRowElement>>());
  const playerRef = React.useRef<DataTableMotionPlayer | null>(null);
  if (!playerRef.current) playerRef.current = new DataTableMotionPlayer(() => bodyRef.current, () => containerRef.current, () => nodes.current);
  const player = playerRef.current;
  const [view, setView] = React.useState<Presentation<T>>(() => ({ rows: options.rows.map(row => ({ row, leaving: false })), frameKey: 0,
    showSkeleton: options.enabled !== false && options.allowSkeleton !== false && options.loading, initialReveal: options.enabled !== false && !options.loading && options.rows.length > 0,
    kind: options.enabled !== false && !options.loading ? 'initial' : 'none', direction: 0, factor: 1, enterDelay: 0 }));
  const current = React.useRef(view), accepted = React.useRef<DataTableMotionTarget>(options), desired = React.useRef(options);
  const callback = React.useRef(options.onBusyChange), live = React.useRef(false), reducedRef = React.useRef(false);
  const [reduced, setReduced] = React.useState(false), [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false), operation = React.useRef<Operation | null>(null), serial = React.useRef(0);
  const timers = React.useRef(new Set<ReturnType<typeof setTimeout>>()), readyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = React.useRef<() => void>(() => {});
  const lifetime = React.useRef(0);
  const committedSkeleton = React.useRef(false);

  function publish(next: Presentation<T>) { current.current = next; if (live.current) setView(next); }
  function notifyBusy(value: boolean) {
    if (!live.current || busyRef.current === value) return;
    busyRef.current = value; setBusy(value); callback.current?.(value);
  }
  function clearTimers() { for (const timer of timers.current) clearTimeout(timer); timers.current.clear(); readyTimer.current = null; }
  function schedule(action: () => void, duration: number) {
    const timer = setTimeout(() => { timers.current.delete(timer); if (live.current) action(); }, Math.max(0, duration));
    timers.current.add(timer); return timer;
  }
  function retireOperation(restoreBody = true) { serial.current++; operation.current = null; clearTimers(); if (restoreBody) player.restoreBody(); }
  function armLoader(pending: Operation) {
    if (!desired.current.loading || desired.current.allowSkeleton === false || current.current.showSkeleton || pending.loaderScheduled) return;
    pending.loaderScheduled = true;
    schedule(() => {
      pending.loaderScheduled = false;
      if (operation.current !== pending || !desired.current.loading || desired.current.allowSkeleton === false) return;
      const previous = current.current;
      publish({ ...previous, rows: previous.rows.filter(item => !item.leaving), frameKey: previous.frameKey + 1,
        showSkeleton: true, initialReveal: false, kind: 'skeleton' });
    }, M.loaderDelay - (performance.now() - pending.startedAt));
  }

  function attemptAccept() {
    if (!live.current) return;
    const input = desired.current, pending = operation.current;
    if (!pending || input.loading) return;
    if (input.error) {
      retireOperation();
      const previous = current.current;
      publish({ ...previous, showSkeleton: false, initialReveal: false, kind: 'none', frameKey: previous.frameKey + 1 });
      notifyBusy(false); return;
    }
    if (!pending.exited) return;
    if (current.current.showSkeleton && pending.loaderVisibleAt === undefined) return;
    const minimumRemaining = reducedRef.current || pending.loaderVisibleAt === undefined ? 0 : M.loaderMinimum - (performance.now() - pending.loaderVisibleAt);
    if (minimumRemaining > 0) {
      if (!readyTimer.current) readyTimer.current = schedule(() => { readyTimer.current = null; attemptRef.current(); }, minimumRemaining);
      return;
    }
    const previous = current.current, target = accepted.current;
    const change = dataTableMotionTargetChange(target, input);
    const kind: DataTableMotionKind = reducedRef.current ? 'none' : pending.kind === 'page' ? 'page' : previous.showSkeleton ? 'initial' : 'reflow';
    const direction = Math.sign(input.pageIndex - target.pageIndex);
    const factor = input.navigationOrigin === 'keyboard' ? M.keyboardFactor : 1;
    accepted.current = { queryKey: input.queryKey, pageIndex: input.pageIndex, pageSize: input.pageSize };
    operation.current = null; clearTimers();
    publish({ rows: reconcileDataTableMotionRows(input.rows, previous.rows, kind === 'reflow'), frameKey: previous.frameKey + 1,
      showSkeleton: false, initialReveal: kind === 'initial', kind, direction, factor, enterDelay: change === 'query' ? M.enterDelay : 0 });
  }

  function begin(kind: 'query' | 'page') {
    const visibleAt = operation.current?.loaderVisibleAt;
    // A replacement page captures the current faded opacity inside pageOut
    // before retiring the previous page animation; query priority restores it.
    retireOperation(kind !== 'page' || reducedRef.current);
    const pending: Operation = { id: ++serial.current, kind, exited: kind !== 'page' || reducedRef.current, startedAt: performance.now(),
      ...(current.current.showSkeleton && visibleAt !== undefined ? { loaderVisibleAt: visibleAt } : {}) };
    operation.current = pending; notifyBusy(true);
    armLoader(pending);
    if (!pending.exited) {
      const factor = desired.current.navigationOrigin === 'keyboard' ? M.keyboardFactor : 1;
      void player.pageOut(factor, reducedRef.current).then(() => {
        if (!live.current || operation.current !== pending) return;
        pending.exited = true; attemptRef.current();
      });
    }
    attemptRef.current();
  }

  React.useLayoutEffect(() => {
    live.current = true; lifetime.current++; player.activate();
    const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    reducedRef.current = media?.matches ?? false; setReduced(reducedRef.current);
    const change = () => {
      reducedRef.current = media?.matches ?? false; setReduced(reducedRef.current);
      if (!reducedRef.current) return;
      player.dispose(); player.activate();
      if (operation.current) operation.current.exited = true;
      const previous = current.current;
      publish({ ...previous, rows: previous.rows.filter(item => !item.leaving), initialReveal: false, kind: 'none', frameKey: previous.frameKey + 1 });
      attemptRef.current(); if (!operation.current) notifyBusy(false);
    };
    media?.addEventListener('change', change);
    return () => {
      live.current = false; lifetime.current++; serial.current++; operation.current = null; clearTimers(); player.dispose();
      media?.removeEventListener('change', change);
    };
  }, [player]);

  React.useLayoutEffect(() => {
    // Only committed inputs enter async ownership; speculative renders never replace the target.
    desired.current = options; callback.current = options.onBusyChange; attemptRef.current = attemptAccept;
    if (options.allowSkeleton === false && current.current.showSkeleton) {
      if (operation.current) operation.current.loaderVisibleAt = undefined;
      const previous = current.current;
      publish({ ...previous, showSkeleton: false, initialReveal: false, kind: 'none', frameKey: previous.frameKey + 1 });
    }
    if (options.enabled === false) {
      retireOperation(); player.dispose(); player.activate(); notifyBusy(false);
      const previous = current.current;
      if (previous.showSkeleton || previous.rows.some(item => item.leaving) || dataTableMotionTargetChange(accepted.current, options) || !dataTableMotionRowsMatch(previous.rows, options.rows)) {
        accepted.current = options;
        publish({ ...previous, rows: reconcileDataTableMotionRows(options.rows, previous.rows, false), showSkeleton: false, initialReveal: false, kind: 'none', frameKey: previous.frameKey + 1 });
      }
      return;
    }
    const targetChange = dataTableMotionTargetChange(accepted.current, options), pending = operation.current;
    if (pending) {
      armLoader(pending);
      // Query/size changes override an outstanding page, while page targets coalesce in-place.
      if (pending.kind === 'page' && targetChange === 'query') begin('query');
      else attemptAccept();
    } else if (targetChange || options.loading) begin(targetChange === 'page' ? 'page' : 'query');
    else if (!options.error && !dataTableMotionRowsMatch(current.current.rows, options.rows)) begin('query');
  }, [options.rows, options.queryKey, options.pageIndex, options.pageSize, options.loading, options.error, options.enabled, options.allowSkeleton, options.navigationOrigin, options.onBusyChange]);

  const rowRef = React.useCallback((id: string): React.RefCallback<HTMLTableRowElement> => {
    let callback = rowCallbacks.current.get(id);
    if (!callback) {
      let attached: HTMLTableRowElement | null = null;
      callback = node => {
        const previous = attached ?? nodes.current.get(id);
        if (node && previous && previous !== node) player.forget(id, previous);
        attached = node;
        if (node) nodes.current.set(id, node);
        else if (previous) queueMicrotask(() => {
          // StrictMode can detach/re-attach the same native node after a move.
          // Retire only a detach that still owns this exact element at the end
          // of the commit, not that transient development lifecycle replay.
          if (attached || nodes.current.get(id) !== previous) return;
          player.forget(id, previous); nodes.current.delete(id);
        });
      };
      rowCallbacks.current.set(id, callback);
    }
    return callback;
  }, [player]);
  React.useEffect(() => {
    // Ref detachment during a commit must not replace a retained row's ref.
    // Prune only identities no longer owned by the committed presentation.
    const ids = new Set(view.rows.map(item => item.row.id));
    for (const id of rowCallbacks.current.keys()) if (!ids.has(id)) rowCallbacks.current.delete(id);
  }, [view.rows]);
  const snapshotBeforeUpdate = React.useCallback(() => {
    const snapshot = player.snapshot(new Set(view.rows.filter(item => !item.leaving).map(item => item.row.id)));
    // The real tbody stays mounted while an independent skeleton covers it.
    // Its covered geometry is not the visual starting position of a reveal.
    if (committedSkeleton.current) snapshot?.rows.clear();
    return snapshot;
  }, [player, view.frameKey]);
  const commitSnapshot = React.useCallback((snapshot: DataTableMotionSnapshot | null) => {
    if (!live.current) return;
    const capturedLifetime = lifetime.current;
    const frame = current.current;
    committedSkeleton.current = frame.showSkeleton;
    if (frame.showSkeleton && operation.current && operation.current.loaderVisibleAt === undefined) {
      operation.current.loaderVisibleAt = performance.now(); attemptRef.current();
    }
    void player.play(snapshot, frame.rows, { kind: frame.kind, direction: frame.direction, factor: frame.factor,
      reduced: reducedRef.current || desired.current.enabled === false, enterDelay: frame.enterDelay,
      onExit(id) {
        if (!live.current || lifetime.current !== capturedLifetime || !current.current.rows.some(item => item.row.id === id && item.leaving)) return;
        publish({ ...current.current, rows: current.current.rows.filter(item => item.row.id !== id) });
      },
    }).then(() => {
      if (!live.current || lifetime.current !== capturedLifetime || current.current.frameKey !== frame.frameKey) return;
      if (current.current.initialReveal) publish({ ...current.current, initialReveal: false });
      if (!operation.current) notifyBusy(false);
    });
  }, [player]);

  React.useLayoutEffect(() => {
    // A child's componentDidMount runs before its parent's layout effects.
    // Admit frame zero here after lifecycle/reduced-motion ownership is active.
    if (current.current.kind === 'initial') notifyBusy(true);
    commitSnapshot(null);
  }, [commitSnapshot]);

  return { rows: view.rows, bodyRef, containerRef, rowRef, snapshotBeforeUpdate, commitSnapshot, frameKey: view.frameKey,
    showSkeleton: view.showSkeleton, initialReveal: view.initialReveal, busy, reducedMotion: reduced,
    pending: operation.current !== null, freshRowIds: options.freshRowIds };
}
