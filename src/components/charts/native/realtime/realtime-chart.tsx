'use client';
/** Observed-time line and held inspection window; changes come from caller data, not an internal ingestion simulator. */
import * as React from 'react';
import { motion } from 'motion/react';
import { buildRealtimeModel, computeRealtimeWindow, computeRealtimePaths, type RealtimeSample } from './realtime-model';
import { EMPTY_REALTIME_PATH_STATE, reconcileRealtimePaths } from './realtime-path-state';
import { chartText, numberValue } from '../shared/admission';
import { formatNativeChartNumber } from '../shared/native-format';
import { NativeChartFrame, NativeChartInspector, NativeChartDataTable, useNativeChartEnvironment, useNativeChartSelection, NATIVE_CHART_MOTION, nativeColor } from '../shared/native-chart';
export interface RealtimeTooltipContext { readonly sample: RealtimeSample; readonly formatValue: (value: number) => string; readonly formatTime: (time: number) => string }
export interface RealtimeChartProps {
  readonly data: readonly RealtimeSample[]; readonly label: string; readonly title?: string; readonly subtitle?: string;
  readonly windowMs?: number; readonly endTime?: number; readonly width?: number; readonly height?: number;
  readonly paused?: boolean; readonly defaultPaused?: boolean; readonly onPausedChange?: (paused: boolean) => void;
  readonly activeId?: string | null; readonly defaultActiveId?: string | null; readonly onActiveChange?: (id: string | null) => void;
  readonly motion?: boolean; readonly className?: string; readonly unit?: string;
  readonly formatValue?: (value: number) => string; readonly formatTime?: (time: number) => string; readonly formatTimeTick?: (time: number) => string;
  readonly renderTooltip?: (context: RealtimeTooltipContext) => React.ReactNode;
}
/** Render genuine retained samples; pause freezes the view endpoint, not database corrections or authorization retirement. */
export function RealtimeChart({ data, label, title, subtitle, windowMs = 60_000, endTime, width = 640, height = 220, paused, defaultPaused = false, onPausedChange, activeId, defaultActiveId, onActiveChange, motion: motionEnabled, className, unit = '', formatValue = formatNativeChartNumber, formatTime = time => new Date(time).toISOString(), formatTimeTick = time => new Date(time).toISOString().split('T')[1]!.slice(0, 8), renderTooltip }: RealtimeChartProps) {
  chartText(label, 'label', true); numberValue(width, 'width', { min: 64, max: 4096 }); numberValue(height, 'height', { min: 80, max: 4096 });
  for (const [name, value] of [['paused', paused], ['defaultPaused', defaultPaused], ['motion', motionEnabled]] as const) if (value !== undefined && typeof value !== 'boolean') throw new TypeError(`${name} must be boolean`);
  const model = React.useMemo(() => buildRealtimeModel(data), [data]);
  const ref = React.useRef<HTMLElement>(null), plot = React.useRef<HTMLDivElement>(null);
  const environment = useNativeChartEnvironment(ref, { motion: motionEnabled });
  const [localPause, setLocalPause] = React.useState(defaultPaused);
  const isPaused = paused ?? localPause;
  const [heldEnd, setHeldEnd] = React.useState<number | undefined>((paused ?? defaultPaused) ? model.latestTime ?? undefined : undefined);
  const [active, request] = useNativeChartSelection(model.data.map(sample => sample.id), activeId, defaultActiveId, onActiveChange);
  const [pointerHold, setPointerHold] = React.useState(false);
  const previousPause = React.useRef(isPaused);
  React.useEffect(() => { if (isPaused && (!previousPause.current || heldEnd === undefined)) setHeldEnd(endTime ?? model.latestTime ?? undefined); if (previousPause.current && !isPaused) setPointerHold(false); if (!isPaused && (!pointerHold || previousPause.current)) setHeldEnd(undefined); previousPause.current = isPaused; }, [isPaused, endTime, model.latestTime, pointerHold, heldEnd]);
  const previousActive = React.useRef<string | null>(null);
  React.useEffect(() => { if (!model.data.length || (active === null && !isPaused && !pointerHold)) setHeldEnd(undefined); }, [model.data.length, active, isPaused, pointerHold]);
  const view = computeRealtimeWindow(model, windowMs, endTime ?? ((isPaused || pointerHold) ? heldEnd : undefined));
  const point = active === null ? undefined : view.data.find(sample => sample.id === active);
  React.useEffect(() => {
    if (point && previousActive.current !== active && !isPaused && !pointerHold) { setHeldEnd(view.end); setPointerHold(true); }
    if (previousActive.current !== null && active === null) { setPointerHold(false); if (!isPaused) setHeldEnd(undefined); }
    previousActive.current = active;
  }, [active, point, isPaused, pointerHold, view.end]);
  const [plotWidth, setPlotWidth] = React.useState(width);
  React.useEffect(() => { const element = plot.current; if (!element) return; const measure = () => setPlotWidth(Math.max(1, element.clientWidth || width)); const observer = new ResizeObserver(measure); observer.observe(element); measure(); return () => observer.disconnect(); }, [width]);
  const geometryWidth = Math.max(64, Math.min(4096, plotWidth));
  const paths = computeRealtimePaths(view, geometryWidth, height);
  const pathState = React.useRef(EMPTY_REALTIME_PATH_STATE);
  const renderedPaths = reconcileRealtimePaths(paths, pathState.current);
  // Commit only mounted work: a discarded concurrent render must not retire
  // the identities of the paths still visible on screen.
  React.useLayoutEffect(() => { pathState.current = renderedPaths.state; }, [renderedPaths]);
  const y = (value: number) => 12 + (1 - (value - view.domain[0]) / (view.domain[1] - view.domain[0])) * (height - 40);
  const x = (time: number) => 52 + (time - view.start) / Math.max(1, view.end - view.start) * Math.max(1, geometryWidth - 64);
  const pauseRequest = (next: boolean) => { if (paused === undefined) { setLocalPause(next); if (next) setHeldEnd(view.end); else { setPointerHold(false); setHeldEnd(undefined); request(null); } } if (next !== isPaused) onPausedChange?.(next); };
  const clear = () => { request(null); if (!isPaused) { setPointerHold(false); setHeldEnd(undefined); } };
  const keys = view.data.filter(sample => sample.value !== null);
  const inspect = (id: string) => { request(id); if (activeId === undefined || activeId === id) { if (!pointerHold) setHeldEnd(view.end); setPointerHold(true); } };
  const nearest = (clientX: number, element: HTMLElement) => { const rect = element.getBoundingClientRect(); const target = view.start + ((clientX - rect.left) / Math.max(1, rect.width) * geometryWidth - 52) / Math.max(1, geometryWidth - 64) * (view.end - view.start); return keys.reduce((a, b) => Math.abs(a.time - target) < Math.abs(b.time - target) ? a : b); };
  const context = point ? { sample: point, formatValue, formatTime } : null;
  const custom = context ? renderTooltip?.(context) : null;
  const content = custom === undefined && point ? <><div>{formatTime(point.time)}</div><div className="value">{point.value === null ? 'Missing' : formatValue(point.value)}{unit && ' ' + unit}</div>{point.anomaly && <div className="muted">{point.anomaly.label}</div>}</> : custom;
  return <NativeChartFrame ref={ref} label={label} title={title} subtitle={subtitle} className={className} motion={!environment.reduced} summary={point ? `${formatTime(point.time)}: ${point.value === null ? 'Missing' : formatValue(point.value)}` : undefined} footer={<><button type="button" className="zero-native-realtime__control" aria-pressed={isPaused} onClick={() => pauseRequest(!isPaused)}>{isPaused ? 'Resume live' : 'Hold view'}</button><span>{isPaused || pointerHold ? 'Held window' : 'Latest observed window'}</span><span>{model.data.length} retained samples</span></>}>
    <div ref={plot} className="zero-native-chart__plot zero-native-realtime__plot" role="group" aria-label={`${label} plot`} tabIndex={0} style={{ height }}
      onPointerMove={event => { if (event.pointerType === 'touch' || !keys.length) return; inspect(nearest(event.clientX, event.currentTarget).id); }}
      onPointerLeave={() => { if (document.activeElement !== plot.current) clear(); }} onPointerDown={event => { if (event.pointerType !== 'touch' || !keys.length) return; const sample = nearest(event.clientX, event.currentTarget); if (sample.id === active) clear(); else inspect(sample.id); }}
      onBlur={clear} onKeyDown={event => { const at = keys.findIndex(sample => sample.id === active); let next: number | undefined; if (event.key === 'ArrowRight') next = Math.min(keys.length - 1, at + 1); else if (event.key === 'ArrowLeft') next = Math.max(0, at - 1); else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = keys.length - 1; else if (event.key === 'Escape') { event.preventDefault(); clear(); } else if (event.key === ' ') { event.preventDefault(); pauseRequest(!isPaused); } if (next !== undefined && keys[next]) { event.preventDefault(); inspect(keys[next]!.id); } }}>
      <svg viewBox={`0 0 ${geometryWidth} ${height}`} style={{ height }} preserveAspectRatio="none" aria-hidden="true">
        {view.ticks.map((tick, index) => <g key={index}><line className="zero-native-chart__grid" x1={52} x2={geometryWidth - 12} y1={y(tick)} y2={y(tick)} /><text className="zero-native-chart__axis" x={44} y={y(tick) + 4} textAnchor="end">{formatValue(tick)}</text></g>)}
        {environment.reduced ? <g key="static">{renderedPaths.paths.map(path => <path key={path.key} d={path.d} fill="none" stroke={nativeColor(0)} strokeWidth={1.8} />)}</g> : <g key="animated">{renderedPaths.paths.map(path => <motion.path key={path.key} d={path.d} initial={{ pathLength: path.entering ? 0 : 1 }} animate={{ d: path.d, opacity: 1, pathLength: environment.inView ? 1 : 0 }} transition={{ d: NATIVE_CHART_MOTION.morph, pathLength: { duration: NATIVE_CHART_MOTION.reveal, ease: [.65, 0, .35, 1] } }} fill="none" stroke={nativeColor(0)} strokeWidth={1.8} />)}</g>}
        {paths.filter(path => !path.d.includes('L')).map(path => { const sample = view.data.find(sample => sample.id === path.id)!; return <circle key={path.id} cx={x(sample.time)} cy={y(sample.value!)} r={2.5} fill={nativeColor(0)} />; })}
        {view.data.filter(sample => sample.anomaly && sample.value !== null).map(sample => <motion.circle key={sample.id} initial={false} animate={{ cx: x(sample.time), cy: y(sample.value!), r: active === sample.id ? 4 : 2.5 }} transition={environment.reduced ? { duration: 0 } : NATIVE_CHART_MOTION.morph} fill={sample.anomaly!.severity === 'danger' ? 'var(--destructive)' : sample.anomaly!.severity === 'warning' ? 'var(--zero-chart-amber)' : nativeColor(0)} />)}
        {point && point.value !== null && <g><line className="zero-native-chart__grid" x1={x(point.time)} x2={x(point.time)} y1={12} y2={height - 28} /><circle cx={x(point.time)} cy={y(point.value)} r={3.5} fill={nativeColor(0)} stroke="var(--card)" strokeWidth={2} /></g>}
        <text className="zero-native-chart__axis" x={52} y={height - 6}>{formatTimeTick(view.start)}</text><text className="zero-native-chart__axis" x={geometryWidth - 12} y={height - 6} textAnchor="end">{formatTimeTick(view.end)}</text>
        {!keys.length && <text className="zero-native-chart__label" x={geometryWidth / 2} y={height / 2} textAnchor="middle">No observed samples in this window</text>}
      </svg>
      <NativeChartInspector open={!!point && environment.visible} content={content} point={[point ? x(point.time) / geometryWidth * plotWidth : 0, point?.value === null || !point ? 0 : y(point.value)]} onDismiss={clear} />
    </div>
    <NativeChartDataTable label={`${label}: exact retained samples`} columns={['Sample ID', 'Observed time (UTC)', 'Epoch (ms)', 'Value', 'Anomaly']} rows={model.data.map(sample => [sample.id, new Date(sample.time).toISOString(), String(sample.time), sample.value === null ? 'Missing' : String(sample.value), sample.anomaly?.label ?? ''])} />
  </NativeChartFrame>;
}
