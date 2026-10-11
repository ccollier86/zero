'use client';
/** Composes Race Bar history, paint runtime, playback/timeline and Zero inspection. Source subscriptions belong to useChartQuery, never this renderer. */
import * as React from 'react';
import { chartSeriesPaint, CHART_CATEGORICAL_COLORS } from '../chart-tokens';
import { buildRaceBarModel, computeRaceBarSnapshot, inspectRaceBarItem, RACE_BAR_LIMITS } from './race-bar-model';
import { computeRaceBarLayout } from './race-bar-layout';
import { RaceBarPaintRuntime, type RaceBarFrameReason, type RaceBarRuntimeOptions } from './race-bar-runtime';
import { RaceBarPlaybackButton, RaceBarTimeline } from './race-bar-controls';
import { RaceBarInspector, RaceBarItemTooltip, type RaceBarItemTooltipContext } from './race-bar-inspection';
import type { RaceBarData, RaceBarModel, RaceBarSnapshot, RaceBarLayout } from './race-bar-types';

const formatDefault = (value: number) => Math.round(value).toLocaleString('en-US');
/** Imperative React ref actions request state changes; data and settings remain declarative props. */
export interface RaceBarChartHandle {
  play(): void; pause(): void; toggle(): void; replay(): void; seek(position: number): void; next(): void; prev(): void;
  readonly frame: number; readonly playing: boolean;
}
export interface RaceBarSelectionInteraction { via: 'pointer' | 'touch' | 'keyboard'; }
/** Complete reference settings, controlled playback/inspection and safe React-only customization. */
export interface RaceBarChartProps extends Omit<React.ComponentPropsWithoutRef<'figure'>, 'children' | 'onChange' | 'title'> {
  data: RaceBarData; label: string; title?: string; subtitle?: string; bars?: number; frameDuration?: number; autoPlay?: boolean; loop?: boolean;
  defaultFrame?: number;
  /** Controlled requested fractional period. onFrame reports the rounded displayed period separately. */
  frame?: number; onFrameChange?: (position: number, interaction: { reason: RaceBarFrameReason }) => void;
  onFrame?: (index: number, snapshot: RaceBarSnapshot) => void;
  playing?: boolean; onPlayingChange?: (playing: boolean) => void;
  selectedId?: string | null; defaultSelectedId?: string | null; onSelectionChange?: (id: string | null, interaction: RaceBarSelectionInteraction) => void;
  highlight?: string | null; totalLabel?: string; showTotal?: boolean; showLegend?: boolean; showControls?: boolean; showTimeline?: boolean;
  motion?: boolean; formatValue?: (value: number) => string; formatTick?: (value: number) => string; emptyLabel?: string;
  /** Undefined uses the default inspector; null deliberately hides it. */
  renderItemTooltip?: (context: RaceBarItemTooltipContext) => React.ReactNode;
}
const clamp = (value: number, max: number) => Math.max(0, Math.min(Math.max(0, max), value));
/** Ranking-over-time organism. All interpolation is presentation of caller-supplied history, never autonomous source data. */
export const RaceBarChart = React.forwardRef<RaceBarChartHandle, RaceBarChartProps>(function RaceBarChart({ data, label, title = '', subtitle = '', bars = 8,
  frameDuration = 1400, autoPlay = true, loop = false, defaultFrame = 0, frame, onFrameChange, onFrame, playing, onPlayingChange,
  selectedId, defaultSelectedId = null, onSelectionChange, highlight = null, totalLabel = 'Total', showTotal = true, showLegend = true,
  showControls = true, showTimeline = true, motion = true, formatValue = formatDefault, formatTick = formatValue,
  emptyLabel = 'No rankings yet', renderItemTooltip, className, style, ...figureProps }, ref) {
  if (!Number.isInteger(bars) || bars < 1 || bars > RACE_BAR_LIMITS.visibleBars) throw new RangeError(`Race Bar bars must be an integer between 1 and ${RACE_BAR_LIMITS.visibleBars}.`);
  if (!Number.isFinite(frameDuration) || frameDuration < 100 || frameDuration > 600_000) throw new RangeError('Race Bar frameDuration must be finite and between 100 and 600000 milliseconds.');
  if (!Number.isFinite(defaultFrame) || (frame !== undefined && !Number.isFinite(frame))) throw new RangeError('Race Bar frame positions must be finite.');
  const model = React.useMemo(() => buildRaceBarModel(data), [data]);
  const [localSelection, setLocalSelection] = React.useState(defaultSelectedId);
  const [pointerPosition, setPointerPosition] = React.useState<number | null>(null);
  const selection = selectedId === undefined ? localSelection : selectedId;
  const activeId = selection !== null && model.byId.has(selection) ? selection : null;
  const [paint, setPaint] = React.useState<{ snapshot: RaceBarSnapshot; layout: RaceBarLayout; anchor: readonly [number, number] | null; playing: boolean; wanted: boolean }>(() => ({
    snapshot: computeRaceBarSnapshot(model, clamp(frame ?? defaultFrame, model.frames.length - 1)), layout: computeRaceBarLayout(model, { width: 600, bars, formatValue }), anchor: null, playing: false, wanted: playing ?? false,
  }));
  const figure = React.useRef<HTMLElement | null>(null), plot = React.useRef<HTMLDivElement | null>(null), rows = React.useRef<HTMLDivElement | null>(null),
    axis = React.useRef<HTMLDivElement | null>(null), grid = React.useRef<HTMLDivElement | null>(null), period = React.useRef<HTMLDivElement | null>(null),
    total = React.useRef<HTMLElement | null>(null), fill = React.useRef<HTMLDivElement | null>(null), thumb = React.useRef<HTMLDivElement | null>(null), slider = React.useRef<HTMLInputElement | null>(null);
  const runtime = React.useRef<RaceBarPaintRuntime | null>(null), keyboard = React.useRef(false), pinned = React.useRef(false), pointerX = React.useRef<number | null>(null);
  const latest = React.useRef({ model, activeId, onFrameChange, onFrame, onPlayingChange, onSelectionChange }); latest.current = { model, activeId, onFrameChange, onFrame, onPlayingChange, onSelectionChange };
  const callbacks = React.useMemo(() => ({ onFrameChange: (position: number, reason: RaceBarFrameReason) => latest.current.onFrameChange?.(position, { reason }),
    onFrame: (index: number, snapshot: RaceBarSnapshot) => latest.current.onFrame?.(index, snapshot),
    onPlayingChange: (next: boolean) => latest.current.onPlayingChange?.(next),
    onPaint: (snapshot: RaceBarSnapshot, layout: RaceBarLayout, anchor: readonly [number, number] | null, nextPlaying: boolean) => {
      const wanted = runtime.current?.playing ?? false;
      setPaint(old => latest.current.activeId !== null || old.snapshot.frameIndex !== snapshot.frameIndex || old.layout.W !== layout.W || old.layout.n !== layout.n ||
        old.playing !== nextPlaying || old.wanted !== wanted || (old.anchor !== null) !== (anchor !== null)
        ? { snapshot, layout, anchor, playing: nextPlaying, wanted } : old);
    } }), []);
  const options = React.useMemo<RaceBarRuntimeOptions>(() => ({ bars, frameDuration, autoPlay, loop, defaultFrame, frame, playing, motion, highlight, selectedId: activeId,
    formatValue, formatTick, ...callbacks }), [bars, frameDuration, autoPlay, loop, defaultFrame, frame, playing, motion, highlight, activeId, formatValue, formatTick, callbacks]);
  const latestOptions = React.useRef(options); latestOptions.current = options;
  React.useLayoutEffect(() => {
    const paint = new RaceBarPaintRuntime({ figure: figure.current!, plot: plot.current!, rows: rows.current!, axis: axis.current!, grid: grid.current!,
      period: period.current!, total: total.current!, fill: fill.current, thumb: thumb.current, slider: slider.current }, latestOptions.current);
    runtime.current = paint;
    return () => { paint.destroy(); if (runtime.current === paint) runtime.current = null; };
  }, []);
  React.useLayoutEffect(() => { runtime.current?.attachTimeline(fill.current, thumb.current, slider.current); }, [showControls, showTimeline]);
  React.useLayoutEffect(() => { runtime.current?.update(model, options); }, [model, options, showControls, showTimeline]);
  React.useImperativeHandle(ref, () => ({ play: () => runtime.current?.play(), pause: () => runtime.current?.pause(), toggle: () => runtime.current?.toggle(),
    replay: () => runtime.current?.replay(), seek: position => { if (!Number.isFinite(position)) throw new RangeError('Race Bar seek requires a finite frame.'); runtime.current?.seek(position); },
    next: () => runtime.current?.next(), prev: () => runtime.current?.prev(), get frame() { return runtime.current?.frame ?? 0; }, get playing() { return runtime.current?.playing ?? false; } }), []);
  React.useEffect(() => { if (selection !== null && !model.byId.has(selection)) { if (localSelection !== null) setLocalSelection(null); pinned.current = false; keyboard.current = false; pointerX.current = null; setPointerPosition(null); } }, [model, selection, localSelection]);
  const requestSelection = (id: string | null, via: RaceBarSelectionInteraction['via']) => {
    if (id !== activeId) { if (selectedId === undefined) setLocalSelection(id); onSelectionChange?.(id, { via }); }
  };
  const clear = (via: RaceBarSelectionInteraction['via'] = 'keyboard') => { pinned.current = false; keyboard.current = false; pointerX.current = null; setPointerPosition(null); requestSelection(null, via); };
  const onKey = (event: React.KeyboardEvent<HTMLInputElement | HTMLDivElement>) => {
    if (!runtime.current || model.frames.length === 0) return;
    const key = event.key;
    if (key === ' ' || key === 'Enter') runtime.current.toggle(); else if (key === 'ArrowRight') runtime.current.next();
    else if (key === 'ArrowLeft') runtime.current.prev(); else if (event.currentTarget === slider.current && key === 'ArrowUp') runtime.current.next();
    else if (event.currentTarget === slider.current && key === 'ArrowDown') runtime.current.prev(); else if (key === 'Home') runtime.current.seek(0); else if (key === 'End') runtime.current.seek(model.frames.length - 1);
    else if ((key === 'ArrowDown' || key === 'ArrowUp') && event.currentTarget === plot.current) {
      const snapshot = runtime.current.currentSnapshot, visible = snapshot?.rows.slice(0, runtime.current.currentLayout?.n ?? bars) ?? [];
      if (!visible.length) return; const rank = keyboard.current ? visible.findIndex(row => row.item.id === activeId) : -1;
      const index = clamp(rank + (key === 'ArrowDown' ? 1 : -1), visible.length - 1);
      keyboard.current = true; pinned.current = true; pointerX.current = null; setPointerPosition(null); requestSelection(visible[index]!.item.id, 'keyboard');
    } else if (key === 'Escape') { event.stopPropagation(); clear(); } else return;
    event.preventDefault();
  };
  const hit = (event: React.PointerEvent<HTMLDivElement>) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.zero-race-bar__row') : null;
    return row?.dataset.inTop === 'true' && row.style.visibility !== 'hidden' ? row.dataset.itemId ?? null : null;
  };
  // A replacement model must never be inspected using the prior model's numeric index/vector ordering.
  const currentSnapshot = runtime.current?.currentSnapshot ?? computeRaceBarSnapshot(model, frame ?? defaultFrame);
  const snapshot = currentSnapshot.rows.every(row => model.byId.get(row.item.id) === row.item) ? currentSnapshot : computeRaceBarSnapshot(model, frame ?? defaultFrame);
  const inspected = activeId ? inspectRaceBarItem(model, snapshot, activeId) : null;
  const visible = inspected && inspected.rank < paint.layout.n && paint.anchor !== null;
  let content: React.ReactNode = null;
  if (inspected) { const context = { ...inspected, model, formatValue, totalLabel }; const custom = renderItemTooltip?.(context); content = custom === undefined ? <RaceBarItemTooltip {...context} /> : custom; }
  const description = React.useId();
  const announcement = React.useMemo(() => {
    const period = model.frames[snapshot.frameIndex];
    if (!activeId || !period) return period?.period ?? 'No periods';
    const exact = inspectRaceBarItem(model, computeRaceBarSnapshot(model, snapshot.frameIndex), activeId);
    return exact ? `${period.period}. ${exact.item.label}, ${formatValue(exact.value)}, rank ${exact.rank + 1} of ${model.items.length}.` : period.period;
  }, [model, activeId, snapshot.frameIndex, formatValue]);
  return <figure {...figureProps} ref={figure} data-slot="race-bar-chart" className={['zero-race-bar', className].filter(Boolean).join(' ')} style={style}>
    {(title || subtitle) && <header className="zero-race-bar__head">{title && <div className="zero-race-bar__title">{title}</div>}{subtitle && <div className="zero-race-bar__subtitle">{subtitle}</div>}</header>}
    <div className="zero-race-bar__top"><div className="zero-race-bar__period" ref={period} aria-hidden="true" />
      <div className="zero-race-bar__total" aria-hidden="true" hidden={!showTotal}>{totalLabel} <b ref={total} /></div></div>
    <div className="zero-race-bar__plot" ref={plot} role="group" tabIndex={0} aria-label={`${label}. ${model.items.length} items over ${model.frames.length} periods.`}
      aria-describedby={description} onKeyDown={onKey} onBlur={() => { if (keyboard.current) clear(); }}
      onPointerMove={event => { if (event.pointerType !== 'mouse' || pinned.current) return; const id = hit(event); pointerX.current = event.clientX - event.currentTarget.getBoundingClientRect().left;
        if (id) { setPointerPosition(pointerX.current); keyboard.current = false; requestSelection(id, 'pointer'); } else if (activeId) clear('pointer'); }}
      onPointerLeave={event => { if (event.pointerType === 'mouse' && !pinned.current) clear('pointer'); }}
      onPointerUp={event => { if (event.pointerType === 'mouse') return; const id = hit(event); pointerX.current = null;
        if (!id || id === activeId) clear('touch'); else { setPointerPosition(null); pinned.current = true; requestSelection(id, 'touch'); } }}>
      <div ref={grid} className="zero-race-bar__grid" aria-hidden="true" /><div ref={axis} className="zero-race-bar__axis" aria-hidden="true" /><div ref={rows} className="zero-race-bar__rows" />
      {(model.frames.length === 0 || model.items.length === 0) && <div className="zero-race-bar__empty">{emptyLabel}</div>}
      <RaceBarInspector open={!!visible} point={[pointerPosition ?? paint.anchor?.[0] ?? 0, paint.anchor?.[1] ?? 0]} content={content} onDismiss={() => clear()} />
    </div>
    {showLegend && model.groups.length > 0 && <RaceBarLegend model={model} />}
    {showControls && <><div className="zero-race-bar__controls"><RaceBarPlaybackButton playing={playing ?? paint.wanted} atEnd={snapshot.frameIndex >= model.frames.length - 1 && model.frames.length > 1}
      disabled={model.frames.length < 2} onToggle={() => runtime.current?.toggle()} />
      {showTimeline && <RaceBarTimeline model={model} sliderRef={slider} fillRef={fill} thumbRef={thumb} onKeyDown={onKey}
        onScrub={position => runtime.current?.scrub(position)} onEndScrub={() => runtime.current?.endScrub()} />}</div>
      {showTimeline && <div className="zero-race-bar__ends" aria-hidden="true"><span>{model.frames[0]?.period}</span><span>{model.frames.length > 1 && model.frames[model.frames.length - 1]?.period}</span></div>}</>}
    <div id={description} className="zero-race-bar__sr">Space or Enter plays and pauses. Left and Right step periods; Home and End jump. Up and Down inspect bars by rank; Escape clears. Values between periods are interpolated.</div>
    <div className="zero-race-bar__sr" aria-live="polite" aria-atomic="true">{announcement}</div>
    <MemoRaceBarHistoryTable model={model} label={label} formatValue={formatValue} />
  </figure>;
});

/** Stable group ordering maps to the shared named palette, with Race Bar-specific overrides taking precedence. */
export function RaceBarLegend({ model }: { model: RaceBarModel }) {
  return <div className="zero-race-bar__legend" aria-label="Series groups">{model.groups.map(group => <span key={group.id}>
    <i aria-hidden="true" style={{ '--c': chartSeriesPaint(group.series, CHART_CATEGORICAL_COLORS, '--zero-race-bar-series-') } as React.CSSProperties} />{group.label}</span>)}</div>;
}
/** Exact history fallback is server rendered; screen readers do not need to chase an animated ranking. */
export function RaceBarHistoryTable({ model, label, formatValue = formatDefault }: { model: RaceBarModel; label: string; formatValue?: (value: number) => string }) {
  return <div className="zero-race-bar__sr"><table><caption>{label}</caption><thead><tr><th scope="col">Item</th>{model.frames.map(frame => <th key={frame.id} scope="col">{frame.period}</th>)}</tr></thead>
    <tbody>{model.items.map(item => <tr key={item.id}><th scope="row">{item.label}</th>{model.frames.map(frame => <td key={frame.id}>{formatValue(frame.values[item.index]!)}</td>)}</tr>)}</tbody></table></div>;
}
const MemoRaceBarHistoryTable = React.memo(RaceBarHistoryTable);
