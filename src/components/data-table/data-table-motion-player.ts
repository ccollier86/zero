/** Owned WAAPI geometry/playback only. React owns every row node and all removal; this player never reparents DOM. */
import type { DataTableMotionRow } from './data-table-motion-model';
import { DATA_TABLE_MOTION as M, dataTableMoveDuration } from './data-table-motion-tokens';

interface RowGeometry { top: number; left: number; width: number; height: number; opacity: number; cells: number[] }
export interface DataTableMotionSnapshot { rows: Map<string, RowGeometry>; containerHeight: number }
export type DataTableMotionKind = 'none' | 'reflow' | 'initial' | 'page' | 'skeleton';
interface Handles { node: HTMLTableRowElement; move?: Animation; enter?: Animation; exit?: Animation }
interface Pinned { row: Record<string, string>; cells: { cell: HTMLTableCellElement; width: string }[] }

/** Frame-local player with exact-element animation ownership and cancellation-safe finish callbacks. */
export class DataTableMotionPlayer {
  private handles = new Map<string, Handles>();
  private pins = new Map<HTMLTableRowElement, Pinned>();
  private layers = new Map<HTMLTableRowElement, string>();
  private page?: Animation;
  private height?: Animation;
  private overflow: string | undefined;
  private live = true;
  constructor(private readonly body: () => HTMLTableSectionElement | null,
    private readonly container: () => HTMLDivElement | null,
    private readonly nodes: () => ReadonlyMap<string, HTMLTableRowElement>) {}

  /** StrictMode re-admission is explicit; disposal never leaves a live animation continuation. */
  activate() { this.live = true; }

  /** Capture current transformed positions before React mutates children, then retire previous moves. */
  snapshot(nextLiveIds?: ReadonlySet<string>): DataTableMotionSnapshot | null {
    const body = this.body();
    if (!body) return null;
    const origin = body.getBoundingClientRect(), rows = new Map<string, RowGeometry>();
    const containerHeight = this.container()?.getBoundingClientRect().height ?? 0;
    for (const [id, node] of this.nodes()) {
      if (!node.isConnected) continue;
      if (this.pins.has(node) && !nextLiveIds?.has(id)) continue;
      const rect = node.getBoundingClientRect();
      rows.set(id, { top: rect.top - origin.top, left: rect.left - origin.left, width: rect.width, height: rect.height,
        opacity: Number.parseFloat(getComputedStyle(node).opacity) || 0, cells: [...node.cells].map(cell => cell.getBoundingClientRect().width) });
    }
    for (const handles of this.handles.values()) {
      if (handles.exit) continue;
      handles.move?.cancel(); handles.move = undefined; handles.enter?.cancel(); handles.enter = undefined; this.restoreLayer(handles.node);
    }
    this.height?.cancel(); this.height = undefined; this.restoreOverflow();
    return { rows, containerHeight };
  }

  /** Fade the existing page while its real source loads; cancelled finished promises are expected retirement. */
  async pageOut(factor: number, reduced: boolean): Promise<void> {
    const body = this.body();
    const opacity = body ? Number.parseFloat(getComputedStyle(body).opacity) : 1;
    this.restoreBody();
    if (!body || reduced || typeof body.animate !== 'function') return;
    const animation = body.animate([{ opacity: Number.isFinite(opacity) ? opacity : 1 }, { opacity: 0 }],
      { duration: M.pageOut * factor, easing: 'linear', fill: 'forwards' });
    this.page = animation;
    await animation.finished.catch(() => undefined);
  }

  /** Restore the CSS-owned page opacity when query priority, errors or reduced motion retire navigation. */
  restoreBody() { this.page?.cancel(); this.page = undefined; }

  /** Play one committed presentation frame, keeping one exit per still-leaving identity. */
  async play<T>(snapshot: DataTableMotionSnapshot | null, rows: readonly DataTableMotionRow<T>[], options: {
    kind: DataTableMotionKind; direction: number; factor: number; reduced: boolean; enterDelay: number; onExit(id: string): void;
  }): Promise<void> {
    this.restoreBody();
    const body = this.body(), pending: Promise<unknown>[] = [];
    if (!body || !this.live) return;
    const wait = (animation: Animation) => pending.push(animation.finished.catch(() => undefined));
    // Retire leavers from native table flow before measuring the new live rows;
    // otherwise their old cell contents can still influence auto column sizing.
    for (const item of rows) {
      const node = this.nodes().get(item.row.id), before = snapshot?.rows.get(item.row.id);
      if (!node) continue;
      if (item.leaving && before) this.pin(node, before);
      else if (!item.leaving) this.unpin(node);
    }
    const origin = body.getBoundingClientRect();
    for (const [index, item] of rows.entries()) {
      const id = item.row.id, node = this.nodes().get(id);
      if (!node) continue;
      const existing = this.handles.get(id);
      if (existing && existing.node !== node) this.forget(id, existing.node);
      const handles = this.handles.get(id) ?? { node }; this.handles.set(id, handles);
      const before = options.kind === 'initial' ? undefined : snapshot?.rows.get(id);
      if (item.leaving) {
        if (handles.exit) { wait(handles.exit); continue; }
        if (before) this.pin(node, before);
        if (options.reduced || typeof node.animate !== 'function') { queueMicrotask(() => { if (this.live) options.onExit(id); }); continue; }
        const animation = node.animate([{ opacity: before?.opacity ?? 1 }, { opacity: 0 }], { duration: M.fast, easing: 'linear', fill: 'forwards' });
        handles.exit = animation;
        animation.onfinish = () => {
          if (!this.live || this.handles.get(id)?.exit !== animation) return;
          handles.exit = undefined; options.onExit(id);
        };
        wait(animation); continue;
      }
      handles.exit?.cancel(); handles.exit = undefined; this.unpin(node);
      if (options.reduced || options.kind === 'none' || typeof node.animate !== 'function') continue;
      if (options.kind === 'page' || options.kind === 'skeleton') continue;
      const after = node.getBoundingClientRect();
      const dy = before ? before.top - (after.top - origin.top) : 0;
      if (before && Math.abs(dy) >= .5) {
        if (!this.layers.has(node)) this.layers.set(node, node.style.zIndex);
        node.style.zIndex = '2';
        const animation = node.animate([{ transform: `translateY(${dy}px)`, opacity: before.opacity }, { transform: 'none', opacity: 1 }], { duration: dataTableMoveDuration(dy), easing: M.ease });
        handles.move = animation; wait(animation);
        void animation.finished.catch(() => undefined).then(() => { if (this.handles.get(id)?.move === animation) { handles.move = undefined; this.restoreLayer(node); } });
      } else if (before && before.opacity < .999) {
        const animation = node.animate([{ opacity: before.opacity }, { opacity: 1 }], { duration: M.base, easing: M.ease });
        handles.enter = animation; wait(animation);
      } else if (!before) {
        const initial = options.kind === 'initial';
        const animation = node.animate([{ opacity: 0, transform: `translateY(${initial ? -4 : -3}px)` }, { opacity: 1, transform: 'none' }],
          { duration: M.base, delay: initial ? index * M.stagger : options.enterDelay, easing: M.ease, fill: 'backwards' });
        handles.enter = animation; wait(animation);
      }
    }
    if (!options.reduced && typeof body.animate === 'function' && (options.kind === 'page' || options.kind === 'skeleton')) {
      const skeleton = options.kind === 'skeleton';
      const animation = body.animate([{ opacity: 0, transform: skeleton ? 'none' : `translateX(${options.direction * 8}px)` }, { opacity: 1, transform: 'none' }],
        { duration: skeleton ? M.pageOut : M.base * options.factor, easing: skeleton ? 'linear' : M.ease });
      this.page = animation; wait(animation);
    }
    const container = this.container(), afterHeight = container?.getBoundingClientRect().height ?? 0;
    if (!options.reduced && snapshot && container && typeof container.animate === 'function' && Math.abs(snapshot.containerHeight - afterHeight) >= .5) {
      this.overflow ??= container.style.overflow; container.style.overflow = 'hidden';
      const animation = container.animate([{ height: `${snapshot.containerHeight}px` }, { height: `${afterHeight}px` }], { duration: M.height, easing: M.ease });
      this.height = animation; wait(animation);
      void animation.finished.catch(() => undefined).then(() => { if (this.height === animation) { this.height = undefined; this.restoreOverflow(); } });
    }
    await Promise.all(pending);
  }

  /** A detached or replaced row can retire only animations registered for that exact element. */
  forget(id: string, node: HTMLTableRowElement) {
    const handles = this.handles.get(id);
    if (handles?.node === node) { handles.move?.cancel(); handles.enter?.cancel(); handles.exit?.cancel(); this.handles.delete(id); }
    this.unpin(node); this.restoreLayer(node);
  }

  /** Retire all animation handles and restore only the styles owned by this player. */
  dispose() {
    this.live = false; this.restoreBody(); this.height?.cancel(); this.height = undefined; this.restoreOverflow();
    for (const [id, handles] of this.handles) this.forget(id, handles.node);
    for (const node of this.pins.keys()) this.unpin(node);
    for (const node of this.layers.keys()) this.restoreLayer(node);
  }
  private restoreLayer(node: HTMLTableRowElement) { const value = this.layers.get(node); if (value === undefined) return; node.style.zIndex = value; this.layers.delete(node); }
  private restoreOverflow() { const container = this.container(); if (container && this.overflow !== undefined) container.style.overflow = this.overflow; this.overflow = undefined; }
  private pin(node: HTMLTableRowElement, geometry: RowGeometry) {
    if (this.pins.has(node)) return;
    const keys = ['position', 'top', 'left', 'width', 'display', 'table-layout', 'pointer-events', 'z-index'];
    this.pins.set(node, { row: Object.fromEntries(keys.map(key => [key, node.style.getPropertyValue(key)])), cells: [...node.cells].map(cell => ({ cell, width: cell.style.width })) });
    Object.assign(node.style, { position: 'absolute', top: `${geometry.top}px`, left: `${geometry.left}px`, width: `${geometry.width}px`, display: 'table', tableLayout: 'fixed', pointerEvents: 'none', zIndex: '0' });
    [...node.cells].forEach((cell, index) => { cell.style.width = `${geometry.cells[index] ?? cell.getBoundingClientRect().width}px`; });
  }
  private unpin(node: HTMLTableRowElement) {
    const pin = this.pins.get(node); if (!pin) return;
    for (const [key, value] of Object.entries(pin.row)) value ? node.style.setProperty(key, value) : node.style.removeProperty(key);
    for (const { cell, width } of pin.cells) cell.style.width = width;
    this.pins.delete(node);
  }
}
