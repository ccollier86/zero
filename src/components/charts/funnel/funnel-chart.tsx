'use client';
/** Composes Funnel's validated cohort model, owned paint clock, Zero controls and shared inspector. Queries and authorization remain outside rendering. */
import * as React from 'react';
import { MotionConfig, useReducedMotion } from 'motion/react';
import { buildFunnelModel, computeFunnelSnapshot, inspectFunnelStage, normalizeFunnelView } from './funnel-model';
import { computeFunnelLayout } from './funnel-layout';
import { funnelCompact, funnelPercent } from './funnel-math';
import { FunnelPaintRuntime, type FunnelRuntimeOptions } from './funnel-runtime';
import { FunnelControls } from './funnel-controls';
import { FunnelInspector, FunnelStageTooltip, type FunnelStageTooltipContext } from './funnel-inspection';
import type { FunnelData, FunnelLayout, FunnelModel, FunnelOrientation, FunnelView } from './funnel-types';

const DEFAULT_VIEW: FunnelView = { kind: 'total' };
const formatDefault = (value: number) => Math.round(value).toLocaleString('en-US');
/** Interaction metadata identifies user/programmatic requests without pretending particles are source events. */
export interface FunnelInteraction { via: 'pointer' | 'touch' | 'keyboard' | 'api'; }
/** Ref commands request the same controlled/uncontrolled state changes as built-in controls; data remains declarative. */
export interface FunnelChartHandle {
  setView(view: FunnelView): void; setFlow(flow: boolean): void; inspect(stageId: string | null): void; clear(): void;
  readonly view: FunnelView; readonly flow: boolean; readonly activeStageId: string | null;
}
/** Full reference settings plus independent controlled views, flow intent and stage inspection. */
export interface FunnelChartProps extends Omit<React.ComponentPropsWithoutRef<'figure'>, 'children' | 'title' | 'onChange'> {
  data: FunnelData; label: string; title?: string; period?: string; unit?: string; height?: number; orientation?: FunnelOrientation;
  view?: FunnelView; defaultView?: FunnelView; onViewChange?: (view: FunnelView) => void;
  flow?: boolean; defaultFlow?: boolean; onFlowChange?: (flow: boolean) => void;
  activeStageId?: string | null; defaultActiveStageId?: string | null;
  onActiveStageChange?: (id: string | null, interaction: FunnelInteraction) => void;
  controls?: boolean; showViewControl?: boolean; showFlowControl?: boolean; showDropOff?: boolean;
  motion?: boolean; emptyLabel?: string; formatValue?: (value: number) => string; formatCompact?: (value: number) => string;
  /** Undefined uses the default aggregate inspector; null deliberately hides it. */
  renderStageTooltip?: (context: FunnelStageTooltipContext) => React.ReactNode;
}

/** Responsive tapered conversion organism. Dots illustrate supplied cohort probabilities, never individual observed events. */
export const FunnelChart = React.forwardRef<FunnelChartHandle, FunnelChartProps>(function FunnelChart({ data, label, title = '', period = '', unit = '',
  height = 170, orientation = 'auto', view, defaultView = DEFAULT_VIEW, onViewChange, flow, defaultFlow = true, onFlowChange,
  activeStageId, defaultActiveStageId = null, onActiveStageChange, controls = true, showViewControl = true, showFlowControl = true, showDropOff = true,
  motion = true, emptyLabel = 'No data', formatValue = formatDefault, formatCompact = funnelCompact, renderStageTooltip, className, style, ...figureProps }, ref) {
  const model = React.useMemo(() => buildFunnelModel(data), [data]);
  const reduced = useReducedMotion(), staticMotion = !motion || !!reduced;
  // Validate layout policy even in SSR before a browser can measure its container.
  const initialLayout = React.useMemo(() => computeFunnelLayout(model.stageCount, { width: 600, height, orientation }), [model, height, orientation]);
  const [localView, setLocalView] = React.useState(defaultView), [localFlow, setLocalFlow] = React.useState(defaultFlow),
    [localActive, setLocalActive] = React.useState(defaultActiveStageId), [announcedStageId, setAnnouncedStageId] = React.useState<string | null>(null);
  const requestedView = view ?? localView;
  const selectedView = React.useMemo(() => normalizeFunnelView(model, requestedView), [model, requestedView]);
  const selectedFlow = flow ?? localFlow, requestedActive = activeStageId === undefined ? localActive : activeStageId;
  const activeId = requestedActive !== null && model.stageById.has(requestedActive) ? requestedActive : null;
  const pending = React.useRef({ view: selectedView, flow: selectedFlow, active: activeId }); pending.current = { view: selectedView, flow: selectedFlow, active: activeId };
  const notifying = React.useRef({ view: 0, flow: 0, active: 0 });
  const [paint, setPaint] = React.useState<{ layout: FunnelLayout; anchor: readonly [number, number] | null }>({ layout: initialLayout, anchor: null });
  const figure = React.useRef<HTMLElement | null>(null), plot = React.useRef<HTMLDivElement | null>(null), steps = React.useRef<HTMLDivElement | null>(null),
    drops = React.useRef<HTMLDivElement | null>(null), svg = React.useRef<SVGSVGElement | null>(null), bands = React.useRef<SVGGElement | null>(null),
    accents = React.useRef<SVGGElement | null>(null), clip = React.useRef<SVGRectElement | null>(null), canvas = React.useRef<HTMLCanvasElement | null>(null),
    column = React.useRef<HTMLDivElement | null>(null), subtitle = React.useRef<HTMLDivElement | null>(null);
  const runtime = React.useRef<FunnelPaintRuntime | null>(null), keyboard = React.useRef(false), touch = React.useRef<number | null>(null), timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = React.useRef({ model, activeId, view, selectedView, selectedFlow, flow, activeStageId, formatValue, unit, onViewChange, onFlowChange, onActiveStageChange });
  latest.current = { model, activeId, view, selectedView, selectedFlow, flow, activeStageId, formatValue, unit, onViewChange, onFlowChange, onActiveStageChange };
  const onPaint = React.useCallback((layout: FunnelLayout, anchor: readonly [number, number] | null) => setPaint(old =>
    old.layout !== layout || (old.anchor?.[0] ?? null) !== (anchor?.[0] ?? null) || (old.anchor?.[1] ?? null) !== (anchor?.[1] ?? null) ? { layout, anchor } : old), []);
  const options = React.useMemo<FunnelRuntimeOptions>(() => ({ height, orientation, view: selectedView, flow: selectedFlow, activeStageId: activeId,
    motion, formatCompact, period, onPaint }), [height, orientation, selectedView, selectedFlow, activeId, motion, formatCompact, period, onPaint]);
  const latestOptions = React.useRef(options); latestOptions.current = options;
  const cancelTouchClear = React.useCallback(() => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; }, []);
  const requestActive = React.useCallback((id: string | null, via: FunnelInteraction['via']) => {
    const current = latest.current, next = id !== null && current.model.stageById.has(id) ? id : null;
    // Only retain an identity. Announcement counts are derived from the current source/view below, never captured after user callbacks.
    setAnnouncedStageId(via === 'keyboard' ? next : null);
    if ((next === current.activeId && next === pending.current.active) || (notifying.current.active > 0 && next === pending.current.active)) return;
    pending.current.active = next;
    if (current.activeStageId === undefined) setLocalActive(next);
    notifying.current.active++;
    try { current.onActiveStageChange?.(next, { via }); } finally { notifying.current.active--; }
  }, []);
  const requestView = React.useCallback((next: FunnelView) => { const current = latest.current, normalized = normalizeFunnelView(current.model, next);
    const previous = pending.current.view;
    const same = (choice: FunnelView) => normalized.kind === choice.kind && (normalized.kind !== 'segment' || (choice.kind === 'segment' && normalized.id === choice.id));
    if ((same(current.selectedView) && same(previous)) || (notifying.current.view > 0 && same(previous))) return;
    pending.current.view = normalized;
    if (current.view === undefined) setLocalView(normalized);
    notifying.current.view++;
    try { current.onViewChange?.(normalized); } finally { notifying.current.view--; } }, []);
  const requestFlow = React.useCallback((next: boolean) => { const current = latest.current;
    if ((next === current.selectedFlow && next === pending.current.flow) || (notifying.current.flow > 0 && next === pending.current.flow)) return;
    pending.current.flow = next;
    if (current.flow === undefined) setLocalFlow(next);
    notifying.current.flow++;
    try { current.onFlowChange?.(next); } finally { notifying.current.flow--; } }, []);
  const clear = React.useCallback((via: FunnelInteraction['via'] = 'api') => { cancelTouchClear(); keyboard.current = false; touch.current = null; requestActive(null, via); }, [requestActive, cancelTouchClear]);
  React.useLayoutEffect(() => {
    const paint = new FunnelPaintRuntime({ figure: figure.current!, plot: plot.current!, steps: steps.current!, drops: drops.current!, svg: svg.current!, bands: bands.current!,
      accents: accents.current!, clip: clip.current!, canvas: canvas.current!, column: column.current!, subtitle: subtitle.current! }, latestOptions.current);
    runtime.current = paint;
    return () => { cancelTouchClear(); paint.destroy(); if (runtime.current === paint) runtime.current = null; };
  }, [cancelTouchClear]);
  React.useLayoutEffect(() => { runtime.current?.update(model, options); }, [model, options]);
  React.useEffect(() => {
    if (localView.kind === 'segment' && !model.segmentById.has(localView.id)) setLocalView(DEFAULT_VIEW);
    if (localActive !== null && !model.stageById.has(localActive)) { setLocalActive(null); keyboard.current = false; cancelTouchClear(); }
    if (announcedStageId !== null && !model.stageById.has(announcedStageId)) setAnnouncedStageId(null);
  }, [model, localView, localActive, announcedStageId, cancelTouchClear]);
  React.useImperativeHandle(ref, () => ({ setView: requestView, setFlow: requestFlow, inspect: id => { cancelTouchClear(); touch.current = null; keyboard.current = false; requestActive(id, 'api'); }, clear: () => clear(),
    get view() { return latest.current.selectedView; }, get flow() { return latest.current.selectedFlow; }, get activeStageId() { return latest.current.activeId; } }), [requestView, requestFlow, requestActive, clear]);
  const stepAt = (event: React.PointerEvent<HTMLDivElement>) => {
    const layout = runtime.current?.currentLayout ?? paint.layout, box = event.currentTarget.getBoundingClientRect();
    const along = layout.vertical ? event.clientY - box.top : event.clientX - box.left;
    const index = Math.max(0, Math.min(model.stageCount - 1, Math.floor(along / (layout.stepSize || 1)))); return model.stages[index]?.id ?? null;
  };
  const inspection = activeId ? inspectFunnelStage(model, selectedView, activeId) : null;
  let content: React.ReactNode = null;
  if (inspection) { const context = { ...inspection, model, formatValue, unit }, custom = renderStageTooltip?.(context); content = custom === undefined ? <FunnelStageTooltip {...context} /> : custom; }
  const clipId = 'zero-funnel-clip-' + React.useId().replace(/:/g, ''), description = React.useId();
  const snapshot = computeFunnelSnapshot(model, selectedView), hasData = model.stages.length > 0 && snapshot.baseline > 0;
  const announced = announcedStageId !== null && announcedStageId === activeId ? inspectFunnelStage(model, selectedView, announcedStageId) : null;
  const announcement = announced ? `${announced.stage.label}, ${formatValue(announced.value)}${unit ? ' ' + unit : ''}${announced.previousStage ? `, ${funnelPercent(announced.keptFromPrevious)} kept from ${announced.previousStage.label}` : ''}, ${funnelPercent(announced.fromStart)} of the first step.` : '';
  return <MotionConfig reducedMotion={staticMotion ? 'always' : 'user'} skipAnimations={staticMotion}><figure {...figureProps} ref={figure} data-slot="funnel-chart"
    data-motion={staticMotion ? 'static' : 'animated'} data-view={selectedView.kind === 'segment' ? selectedView.id : selectedView.kind}
    className={['zero-funnel', className].filter(Boolean).join(' ')} style={style}>
    <header className="zero-funnel__head"><div className="zero-funnel__heading"><div className="zero-funnel__title">{title || label}</div>
      <div ref={subtitle} className="zero-funnel__subtitle">{period && period + ', '}{funnelPercent(snapshot.conversionRate)} convert</div></div>
      {controls && <FunnelControls model={model} view={selectedView} flow={selectedFlow} showView={showViewControl} showFlow={showFlowControl}
        onViewChange={requestView} onFlowChange={requestFlow} />}</header>
    <div ref={plot} className="zero-funnel__plot" role="group" tabIndex={0} aria-roledescription="funnel chart" aria-label={`${label}. ${model.stageCount} stages.`}
      aria-describedby={description} style={{ height: initialLayout.height }}
      onFocus={event => { if (event.currentTarget.matches(':focus-visible') && model.stageCount > 0) { keyboard.current = true; cancelTouchClear(); requestActive(activeId ?? model.stages[0]!.id, 'keyboard'); } }}
      onBlur={() => { if (keyboard.current) clear('keyboard'); }}
      onKeyDown={event => { let index = activeId ? model.stageById.get(activeId)!.index : 0;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); clear('keyboard'); return; }
        if (!model.stageCount) return;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index++; else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') index--;
        else if (event.key === 'Home') index = 0; else if (event.key === 'End') index = model.stageCount - 1; else return;
        event.preventDefault(); keyboard.current = true; cancelTouchClear(); requestActive(model.stages[Math.max(0, Math.min(model.stageCount - 1, index))]!.id, 'keyboard'); }}
      onPointerMove={event => { if (event.pointerType === 'touch' && touch.current !== event.pointerId) return;
        keyboard.current = false; cancelTouchClear(); requestActive(stepAt(event), event.pointerType === 'mouse' ? 'pointer' : 'touch'); }}
      onPointerDown={event => { if (event.pointerType === 'mouse') return; touch.current = event.pointerId; keyboard.current = false; cancelTouchClear();
        if (event.isTrusted) event.currentTarget.setPointerCapture(event.pointerId); requestActive(stepAt(event), 'touch'); }}
      onPointerUp={event => { if (event.pointerType === 'mouse' || touch.current !== event.pointerId) return; touch.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); cancelTouchClear(); timer.current = setTimeout(() => clear('touch'), 1600); }}
      onPointerCancel={() => clear('touch')} onPointerLeave={event => { if (event.pointerType === 'mouse' && !keyboard.current) clear('pointer'); }}>
      <div ref={column} className="zero-funnel__column" aria-hidden="true" /><div ref={steps} className="zero-funnel__steps" aria-hidden="true" />
      <svg ref={svg} className="zero-funnel__svg" aria-hidden="true"><defs><clipPath id={clipId}><rect ref={clip} /></clipPath></defs>
        <g ref={bands} /><g ref={accents} clipPath={`url(#${clipId})`} /></svg>
      <canvas ref={canvas} className="zero-funnel__canvas" aria-hidden="true" /><div ref={drops} className="zero-funnel__drops" aria-hidden="true" hidden={!showDropOff} />
      {!hasData && <div className="zero-funnel__empty">{emptyLabel}</div>}
      <FunnelInspector open={!!inspection && hasData && paint.anchor !== null} content={content} point={paint.anchor ?? [0, 0]} vertical={paint.layout.vertical}
        stepSize={paint.layout.stepSize} plot={plot.current} onDismiss={() => clear('keyboard')} />
    </div>
    <div id={description} className="zero-funnel__sr">Arrow keys inspect stages; Home and End jump; Escape clears. On touch, press and drag to inspect. Flow particles illustrate aggregate retention probabilities, not observed individual events.</div>
    <div className="zero-funnel__sr" aria-live="polite" aria-atomic="true">{announcement}</div>
    <MemoFunnelDataTable model={model} label={label} period={period} unit={unit} formatValue={formatValue} />
  </figure></MotionConfig>;
});

/** Exact complete cohort matrix remains available in SSR and to assistive technology, independent of the current view. */
export function FunnelDataTable({ model, label, period = '', unit = '', formatValue = formatDefault }: {
  model: FunnelModel; label: string; period?: string; unit?: string; formatValue?: (value: number) => string;
}) {
  const snapshot = computeFunnelSnapshot(model, DEFAULT_VIEW);
  return <div className="zero-funnel__sr"><table><caption>{label}{period ? ', ' + period : ''}</caption><thead><tr><th scope="col">Stage</th>
    {model.segments.map(segment => <th key={segment.id} scope="col">{segment.label}</th>)}<th scope="col">Total</th><th scope="col">Kept from previous</th><th scope="col">Of first stage</th></tr></thead>
    <tbody>{snapshot.values.map(row => <tr key={row.stage.id}><th scope="row">{row.stage.label}</th>{model.segments.map(segment => <td key={segment.id}>{formatValue(row.stage.values[segment.index]!)}{unit && ' ' + unit}</td>)}
      <td>{formatValue(row.value)}{unit && ' ' + unit}</td><td>{row.stage.index === 0 ? 'Entry stage' : funnelPercent(row.keptFromPrevious)}</td><td>{funnelPercent(row.fromStart)}</td></tr>)}</tbody></table></div>;
}
const MemoFunnelDataTable = React.memo(FunnelDataTable);
