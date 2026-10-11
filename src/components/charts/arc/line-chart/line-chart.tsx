"use client";

/**
 * Arc-derived chart renderer. UI/presentation only; consumes admitted detached data,
 * Zero motion/tokens, and React/Motion. Does not perform transport or persistence.
 * Adapted from Arc UI (https://uiarc.dev), MIT, Copyright (c) 2026 Elia Kuratli.
 */

import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type Ref, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useTransform, type MotionValue } from "motion/react";
import { motionTokens } from "../shared/motion-tokens";
import { useArcChartEnvironment } from "../shared/use-arc-chart-environment";
import styles from "./line-chart-classes";
import { buildLineChartModel, computeLineChartScale as niceScale, computeLineChartCurve as curveFor, lineChartValueAt as valueAt, type LineChartDatum, type LineChartSeries, type Point } from "./line-chart-model";
import { chartDimension,ownChartArray,chartText,chartLabel,chartSelectionId,chartSelector,chartFlag,CARTESIAN_LIMITS } from "./cartesian-admission";
import { useCartesianSelection } from './cartesian-selection';
import { CartesianInspector } from './cartesian-inspector';
export type { LineChartDatum, LineChartSeries } from "./line-chart-model";

/** Use a line chart for one or more measures over time, when the shape of the trend matters more than any single value. */
export interface LineChartProps {
  /** Disable all presentation motion; never changes the measured data. */
  motion?: boolean;
  data: readonly LineChartDatum[];
  series: readonly LineChartSeries[];
  /** What is measured, such as "Signups". Names the chart for assistive technology. */
  label: string;
  /** Unit after each value in the tooltip, such as "ms". */
  unit?: string;
  /** Plot height in pixels. The width follows the container. */
  height?: number;
  /** Formats values in the tooltip and data table. */
  formatValue?: (value: number, series: LineChartSeries) => string;
  /** Formats the value axis. Defaults to a compact number, such as 1.2K. */
  formatTick?: (value: number) => string;
  /** Controlled hidden series keys. */
  hiddenSeries?: readonly string[];
  defaultHiddenSeries?: readonly string[];
  onHiddenSeriesChange?: (hidden: string[]) => void;
  /** Called as the crosshair moves, and with null when it leaves. Use it to drive a headline readout. */
  onActiveChange?: (index: number | null, datum: LineChartDatum | null) => void;
  /** Controlled accepted inspection identity. A retired identity is masked immediately. */
  activeDatumId?: string | null;
  defaultActiveDatumId?: string | null;
  /** Undefined keeps the standard inspector; null from the renderer hides it. */
  renderTooltip?: (context: LineChartTooltipContext) => ReactNode;
  /** Keeps the current lines on screen, dimmed, while the next range loads. */
  loading?: boolean;
  /** Shown when there are no points. */
  emptyLabel?: string;
  /** Series toggles above the plot. Shown by default when there is more than one series. */
  legend?: boolean;
  /** Header of the first column in the data table read by screen readers. */
  categoryLabel?: string;
  /** Smooth monotone curves that never swing past the data, or straight segments. */
  curve?: "smooth" | "linear";
  ref?: Ref<HTMLElement>;
  className?: string;
}
/** Exact admitted values, independent of animated paths or cursor position. */
export interface LineChartTooltipContext {readonly index:number;readonly datum:LineChartDatum;readonly visibleSeries:readonly LineChartSeries[];readonly unit:string;readonly formatValue:(value:number,series:LineChartSeries)=>string}


type Track = { shape: Point[]; presence: number; fade: { stop: () => void } | null };

const { spring, duration, ease } = motionTokens;
/** Motion drops inherited velocity on time-defined springs, so values that retarget mid-flight run the same springs written as stiffness and damping. */
const physical = ({ visualDuration, bounce }: { visualDuration: number; bounce: number }, restDelta = .001) => { const root = (2 * Math.PI) / (visualDuration * 1.2); return { type: "spring" as const, stiffness: root * root, damping: 2 * (1 - bounce) * root, restDelta, restSpeed: restDelta * 2 }; };
const settle = physical(spring.smooth);
const glide = physical(spring.snappy, .0001);
const draw = { duration: duration.considered * 1.75, ease: [...ease.inOut] } as const;
const fadeFast = { duration: duration.instant, ease: [...ease.standard] } as const;

/** Room above the top gridline, and the gap between the crosshair and its tooltip. */
const TOP = 12;
const PALETTE = ["var(--zero-arc-accent, var(--zero-chart-foreground, var(--foreground)))", "color-mix(in oklab, var(--zero-arc-foreground, var(--zero-chart-foreground, var(--foreground))) 46%, var(--zero-arc-surface, var(--zero-chart-surface, var(--card))))", "color-mix(in oklab, var(--zero-arc-foreground, var(--zero-chart-foreground, var(--foreground))) 26%, var(--zero-arc-surface, var(--zero-chart-surface, var(--card))))"];
const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const colorOf = (series: LineChartSeries, index: number) => series.color ?? PALETTE[Math.min(index, PALETTE.length - 1)];
/** Tracks are mutable animation state read by the painter, never by render. */
const update = (track: Track, patch: Partial<Track>) => Object.assign(track, patch);

const grid = Array.from({ length: 241 }, (_, index) => index / 240);


type Scale = { min: MotionValue<number>; max: MotionValue<number> };
function useRowY(value: number, scale: Scale, height: number) {
  return useTransform(() => { const span = scale.max.get() - scale.min.get() || 1; return Math.round(TOP + (1 - (value - scale.min.get()) / span) * (height - TOP)) + .5; });
}

/** A gridline rides the scale, so a taller range slides it down while new rows fade in above. */
function Gridline({ value, scale, height, reduced }: { value: number; scale: Scale; height: number;reduced:boolean }) {
  const y = useRowY(value, scale, height);
  return <motion.line className={styles.grid} x1={0} x2="100%" y1={y} y2={y} initial={reduced?false:{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: reduced?{duration:0}:fadeFast }} transition={reduced?{duration:0}:{ duration: duration.standard, ease: [...ease.standard] }} />;
}

function TickLabel({ value, scale, height, format, reduced }: { value: number; scale: Scale; height: number; format: (value: number) => string;reduced:boolean }) {
  const y = useRowY(value, scale, height);
  return <motion.span className={styles.tick} style={{ y }} initial={reduced?false:{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: reduced?{duration:0}:fadeFast }} transition={reduced?{duration:0}:{ duration: duration.standard, ease: [...ease.standard] }}>
    <span className={styles.tickText}>{format(value)}</span>
  </motion.span>;
}

/** Axis labels that fit: at most one per 76 pixels, counted back from the latest so the newest date always shows. */
function axisPicks(data: readonly LineChartDatum[], width: number) {
  const labeled = data.flatMap((item, index) => item.axisLabel ? [index] : []);
  if (!width || !labeled.length) return [];
  const room = Math.max(2, Math.floor(width / 76));
  const stride = Math.ceil(labeled.length / room);
  return labeled.reverse().filter((_, rank) => rank % stride === 0).reverse();
}

function LineChartRenderer({ motion:motionEnabled, data, series, label, unit = "", height = 220, formatValue, formatTick = value => compact.format(value), hiddenSeries, defaultHiddenSeries, onHiddenSeriesChange, onActiveChange, activeDatumId, defaultActiveDatumId, renderTooltip, loading = false, emptyLabel = "No data for this range", legend, categoryLabel = "Date", curve = "smooth", ref, className }: LineChartProps) {
  const figure = useRef<HTMLElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const clip = useRef<SVGRectElement>(null);
  const crosshair = useRef<SVGLineElement>(null);
  const lines = useRef(new Map<string, SVGPathElement>());
  const areas = useRef(new Map<string, SVGPathElement>());
  const dots = useRef(new Map<string, SVGCircleElement>());
  const groups = useRef(new Map<string, SVGGElement>());
  useImperativeHandle(ref, () => figure.current as HTMLElement);
  const environment=useArcChartEnvironment(figure,{motion:motionEnabled});
  const inView=environment.inView;
  const reduced=environment.reduced;
  const uid = `line${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const last = data.length - 1;
  const empty = data.length === 0;

  // Hidden series, controlled or not.
  const [ownHidden, setOwnHidden] = useState<string[]>([...(defaultHiddenSeries ?? [])]);
  const knownSeries=new Set(series.map(item=>item.id));
  const hidden = [...new Set(hiddenSeries ?? ownHidden)].filter(id=>knownSeries.has(id));
  const toggle = (key: string) => {
    const next = hidden.includes(key) ? hidden.filter(item => item !== key) : [...hidden, key];
    if (hiddenSeries === undefined) setOwnHidden(next);
    onHiddenSeriesChange?.(next);
  };
  const visible = series.filter(item => !hidden.includes(item.id));
  const showLegend = legend ?? series.length > 1;

  // Each series becomes a dense curve in data units; the scale fits only the series on show.
  const signature = JSON.stringify([curve,series.map(item=>item.id),data.map(item=>[item.id,series.map(line=>item.values[line.id]??0)])]);
  const targets = useMemo(() => new Map(series.map(line => [line.id, curveFor(data.map(item => item.values[line.id] ?? 0), curve === "smooth")])), [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  let low = Infinity, high = -Infinity;
  for (const line of visible) for (const item of data) { const value = item.values[line.id] ?? 0; low = Math.min(low, value); high = Math.max(high, value); }
  const range = Number.isFinite(low) ? niceScale(low, high) : null;
  const [steady, setSteady] = useState(() => range ?? niceScale(0, 100));
  if (range && (range.min !== steady.min || range.max !== steady.max)) setSteady(range);
  const scale = { min: useMotionValue(steady.min), max: useMotionValue(steady.max) };

  // Scrubbing: a new range lets go of the crosshair.
  const [active,setActive]=useCartesianSelection(data,item=>item.id,activeDatumId,defaultActiveDatumId,onActiveChange);
  const index = active === null || empty ? null : Math.min(active, last);
  const scrubbing = index !== null;

  const width = useRef(0);
  const [plotWidth, setPlotWidth] = useState(0);
  const tracks = useRef(new Map<string, Track>());
  const drawn = useMotionValue(0);
  const cursor = useMotionValue(1);
  const anchorX=useMotionValue(0),anchorY=useMotionValue(height/2);
  const live = useRef({ series, hidden });
  useLayoutEffect(() => { live.current = { series, hidden }; });

  // One writer for every drawn attribute: morphs, toggles, the scale, the crosshair, and the measured size all repaint through here.
  const paint = useCallback(() => {
    const w = width.current;
    if (!w) return;
    const lo = scale.min.get(), span = scale.max.get() - lo || 1;
    const toY = (value: number) => TOP + (1 - (value - lo) / span) * (height - TOP);
    const at = cursor.get();
    const dotYs: number[] = [];
    for (const line of live.current.series) {
      const track = tracks.current.get(line.id);
      if (!track) continue;
      const p = track.presence;
      const y = (value: number) => toY(lo + (value - lo) * p);
      const path = track.shape.length ? `M${track.shape.map(([x, value]) => `${(x * w).toFixed(1)},${y(value).toFixed(1)}`).join("L")}` : "";
      lines.current.get(line.id)?.setAttribute("d", path);
      areas.current.get(line.id)?.setAttribute("d", path ? `${path}L${w},${height}L0,${height}Z` : "");
      const group = groups.current.get(line.id);
      if (group) group.style.opacity = String(p);
      const dot = dots.current.get(line.id);
      if (dot && track.shape.length) {
        const cy = y(valueAt(track.shape, at));
        dot.setAttribute("cx", (at * w).toFixed(1));
        dot.setAttribute("cy", cy.toFixed(1));
        if (p > .5) dotYs.push(cy);
      }
    }
    clip.current?.setAttribute("width", String(drawn.get() * (w + 16)));
    const cx = Math.round(at * w) + .5;
    crosshair.current?.setAttribute("x1", String(cx));
    crosshair.current?.setAttribute("x2", String(cx));
    // The tooltip sits beside the crosshair, flips sides before it would leave the plot, and centres on the points it describes.
    const middle = dotYs.length ? dotYs.reduce((sum, value) => sum + value, 0) / dotYs.length : height / 2;
    anchorX.set(clamp(cx,0,w));anchorY.set(clamp(middle,0,height));
  }, [cursor, drawn, height, scale.max, scale.min, anchorX, anchorY]);
  useMotionValueEvent(cursor, "change", paint);
  useMotionValueEvent(drawn, "change", paint);
  useMotionValueEvent(scale.min, "change", paint);
  useMotionValueEvent(scale.max, "change", paint);
  useLayoutEffect(paint);

  // The plot draws in its own pixels: measure the width, follow resizes, and size the tooltip for its flip.
  useLayoutEffect(() => {
    const node = plot.current;
    if (!node) return;
    const read = () => { width.current = node.clientWidth; setPlotWidth(node.clientWidth); paint(); };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [paint]);

  // New data morphs every line from the shape on screen, sampled on shared x positions so a range that gains or loses points still flows.
  const morph = useRef<{ stop: () => void } | null>(null);
  useEffect(() => {
    const moves: { track: Track; xs: number[]; from: number[]; to: number[]; target: Point[] }[] = [];
    for (const [id,track] of tracks.current) if (!targets.has(id)) { track.fade?.stop(); tracks.current.delete(id); }
    for (const [key, target] of targets) {
      const track = tracks.current.get(key);
      if (!track) { tracks.current.set(key, { shape: target, presence: live.current.hidden.includes(key) ? 0 : 1, fade: null }); continue; }
      if (!track.shape.length || !target.length || reduced) { update(track, { shape: target }); continue; }
      const xs = [...new Set([...grid, ...target.map(([x]) => x)])].sort((a, b) => a - b);
      moves.push({ track, xs, from: xs.map(x => valueAt(track.shape, x)), to: xs.map(x => valueAt(target, x)), target });
    }
    morph.current?.stop();
    if (!moves.length) { paint(); return; }
    morph.current = animate(0, 1, { ...settle, restDelta: .0005, onUpdate: progress => { for (const move of moves) update(move.track, { shape: move.xs.map((x, at): Point => [x, move.from[at]! + (move.to[at]! - move.from[at]!) * progress]) }); paint(); }, onComplete: () => { for (const move of moves) update(move.track, { shape: move.target }); paint(); } });
    return () => morph.current?.stop();
  }, [paint, reduced, targets]);
  useEffect(()=>()=>{morph.current?.stop();for(const track of tracks.current.values())track.fade?.stop();tracks.current.clear();},[]);

  // A hidden series flattens into the baseline as it fades; the ones that stay rescale around it.
  const hiddenKey = JSON.stringify(hidden);
  useEffect(() => {
    const controls:{stop:()=>void}[]=[];
    for (const [key, track] of tracks.current) {
      const to = hidden.includes(key) ? 0 : 1;
      if (track.presence === to) continue;
      track.fade?.stop();
      if (reduced) { update(track, { presence: to }); continue; }
      const control=animate(track.presence, to, { ...settle, onUpdate: value => { update(track, { presence: value }); paint(); } });controls.push(control);update(track,{fade:control});
    }
    paint();
    return ()=>controls.forEach(control=>control.stop());
  }, [hiddenKey, paint, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (reduced) { scale.min.jump(steady.min); scale.max.jump(steady.max); return; }
    const controls = [animate(scale.min, steady.min, settle), animate(scale.max, steady.max, settle)];
    return () => controls.forEach(control => control.stop());
  }, [reduced, scale.max, scale.min, steady]);

  // The lines draw left to right the first time the chart is seen with data.
  useEffect(() => {
    if (empty || !inView) return;
    if (reduced) { drawn.jump(1); return; }
    if (!inView || drawn.get() >= 1) return;
    const controls = animate(drawn, 1, draw);
    return () => controls.stop();
  }, [drawn, empty, inView, reduced]);

  // The crosshair appears on the first scrubbed point and glides between the ones after it; the tooltip follows on its own spring.
  const wasScrubbing = useRef(false);
  useEffect(() => {
    if (index === null) { wasScrubbing.current = false; return; }
    const to = last > 0 ? index / last : .5;
    if (reduced || !wasScrubbing.current) { cursor.jump(to); }
    wasScrubbing.current = true;
    if (reduced) return;
    const controls = animate(cursor, to, glide);
    return () => controls.stop();
  }, [cursor, index, last, reduced]);


  const pointAt = (clientX: number) => {
    const rect = plot.current?.getBoundingClientRect();
    if (!rect?.width || last < 1) return Math.max(0, last);
    return clamp(Math.round(((clientX - rect.left) / rect.width) * last), 0, last);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && scrubbing) { event.preventDefault(); setActive(null); return; }
    const from = index ?? last + 1, page = Math.max(1, Math.round(data.length / 6));
    const next = ({ ArrowLeft: from - 1, ArrowDown: from - 1, ArrowRight: index === null ? last : from + 1, ArrowUp: index === null ? last : from + 1, PageDown: from - page, PageUp: from + page, Home: 0, End: last } as Record<string, number>)[event.key];
    if (next === undefined || empty) return;
    event.preventDefault();
    setActive(clamp(next, 0, last));
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (empty) return;
    if (event.pointerType !== "mouse") event.currentTarget.setPointerCapture?.(event.pointerId);
    setActive(pointAt(event.clientX));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => { if (!empty && (event.pointerType === "mouse" || event.buttons)) setActive(pointAt(event.clientX)); };

  const format = (value: number, line: LineChartSeries) => `${formatValue ? formatValue(value, line) : grouped.format(value)}${unit ? ` ${unit}` : ""}`;
  const reading = index === null ? null : data[index];
  const valueText = reading ? `${reading.label}: ${visible.map(line => `${line.label} ${format(reading.values[line.id] ?? 0, line)}`).join(", ")}` : empty ? emptyLabel : `${visible.length} of ${series.length} series shown`;
  const summary = empty ? `${label}. ${emptyLabel}.` : `${label}, ${data[0]!.label} to ${data[last]!.label}. ${visible.map(line => `${line.label}, latest ${format(data[last]!.values[line.id] ?? 0, line)}`).join(". ")}.`;
  const picks = axisPicks(data, plotWidth);
  const allHidden = !empty && visible.length === 0;
  const defaultInspector=<><p className={styles.tipTitle}>{reading?.label??''}</p>{visible.map(line=><p key={line.id} className={styles.tipRow} style={{'--zero-arc-series':colorOf(line,series.indexOf(line))} as CSSProperties}><span className={styles.tipSwatch} data-dashed={line.dashed||undefined}/><span className={styles.tipName}>{line.label}</span><span className={styles.tipValue}>{format(reading?.values[line.id]??0,line)}</span></p>)}</>;
  const customInspector=reading && index!==null?renderTooltip?.({index,datum:reading,visibleSeries:visible,unit,formatValue:format}):undefined;

  return <figure data-motion={reduced?'off':undefined} data-zero-arc-chart="line-chart" ref={figure} className={[styles.figure, className].filter(Boolean).join(" ")} aria-label={label} aria-busy={loading || undefined}>
    {showLegend && <div className={styles.legend} role="group" aria-label={`${label} series`}>
      {series.map((line, at) => <button key={line.id} type="button" className={styles.toggle} aria-pressed={!hidden.includes(line.id)} onClick={() => toggle(line.id)} style={{ "--zero-arc-series": colorOf(line, at) } as CSSProperties}>
        <span className={styles.swatch} data-dashed={line.dashed || undefined} aria-hidden="true" />
        <span className={styles.toggleLabel}>{line.label}</span>
      </button>)}
    </div>}
    <div className={styles.chart} data-scrubbing={scrubbing || undefined} data-loading={loading || undefined}>
      <div ref={plot} className={styles.plot} style={{ height }} role="slider" tabIndex={empty ? -1 : 0} aria-label={`${label}, explore by ${categoryLabel.toLowerCase()}`} aria-orientation="horizontal" aria-valuemin={1} aria-valuemax={Math.max(1, data.length)} aria-valuenow={Math.max(1,(index ?? last) + 1)} aria-valuetext={valueText}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={event => { if (event.pointerType !== "mouse") setActive(null); }} onPointerCancel={() => setActive(null)} onPointerLeave={event => { if (event.pointerType === "mouse") setActive(null); }} onKeyDown={onKeyDown} onBlur={() => setActive(null)}
        onFocus={event => { if (event.currentTarget.matches(":focus-visible") && !empty) setActive(current => current ?? last); }}>
        <svg className={styles.svg} width="100%" height={height} aria-hidden="true" focusable="false">
          <defs><clipPath id={`${uid}-draw`} clipPathUnits="userSpaceOnUse"><rect ref={clip} x={-8} y={-16} width={0} height={height + 32} /></clipPath></defs>
          <AnimatePresence initial={false}>{steady.ticks.slice(1).map(value => <Gridline key={value} value={value} scale={scale} height={height} reduced={reduced} />)}</AnimatePresence>
          <line className={styles.baseline} x1={0} x2="100%" y1={height - .5} y2={height - .5} />
          <line ref={crosshair} className={styles.crosshair} y1={TOP - 4} y2={height} />
          <g className={styles.series} clipPath={`url(#${uid}-draw)`}>
            {series.map((line, at) => <g key={line.id} ref={node => { if (node) groups.current.set(line.id, node); else groups.current.delete(line.id); }} style={{ "--zero-arc-series": colorOf(line, at) } as CSSProperties}>
              {(line.area ?? at === 0) && <path ref={node => { if (node) areas.current.set(line.id, node); else areas.current.delete(line.id); }} className={styles.area} />}
              <path ref={node => { if (node) lines.current.set(line.id, node); else lines.current.delete(line.id); }} className={styles.line} data-dashed={line.dashed || undefined} />
            </g>)}
          </g>
          {series.map((line, at) => <circle key={line.id} ref={node => { if (node) dots.current.set(line.id, node); else dots.current.delete(line.id); }} className={styles.dot} r={4} data-hidden={hidden.includes(line.id) || undefined} style={{ "--zero-arc-series": colorOf(line, at) } as CSSProperties} />)}
        </svg>
        <CartesianInspector open={scrubbing&&!allHidden} content={customInspector===undefined?defaultInspector:customInspector} x={anchorX} y={anchorY} plot={plot.current} className={styles.tooltip} contentRef={tip} onDismiss={()=>setActive(null)}/>
        <AnimatePresence initial={false}>
          {(empty || allHidden) && !loading && <motion.p key={empty ? "empty" : "hidden"} className={styles.message} initial={reduced?false:{ opacity: 0 }} animate={{ opacity: 1 }} transition={reduced?{duration:0}:fadeFast} exit={{ opacity: 0, transition: reduced?{duration:0}:fadeFast }}>{empty ? emptyLabel : "Choose a series to show"}</motion.p>}
          {loading && empty && <motion.span key="skeleton" className={styles.skeleton} initial={reduced?false:{ opacity: 0 }} animate={{ opacity: 1 }} transition={reduced?{duration:0}:fadeFast} exit={{ opacity: 0, transition: reduced?{duration:0}:fadeFast }} aria-hidden="true" />}
        </AnimatePresence>
      </div>
      <div className={styles.gutter} aria-hidden="true">
        <AnimatePresence initial={false}>{steady.ticks.map(value => <TickLabel key={value} value={value} scale={scale} height={height} format={formatTick} reduced={reduced} />)}</AnimatePresence>
      </div>
      <div className={styles.axis} aria-hidden="true">
        <AnimatePresence initial={false}>
          {picks.map(at => { const share = last > 0 ? at / last : .5; return <motion.span key={`${data[at]!.id}:${data[at]!.axisLabel}`} className={styles.axisLabel} style={{ left: `${share * 100}%`, translateX: `${-share * 100}%` }} initial={reduced?false:{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: reduced?{duration:0}:fadeFast }} transition={reduced?{duration:0}:{ duration: duration.standard, ease: [...ease.standard] }}>{data[at]!.axisLabel}</motion.span>; })}
        </AnimatePresence>
      </div>
    </div>
    <p className={styles.srOnly}>{summary}</p>
    {!empty && <div className={styles.srOnly}><table>
      <caption>{label}</caption>
      <thead><tr><th scope="col">{categoryLabel}</th>{series.map(line => <th key={line.id} scope="col">{line.label}</th>)}</tr></thead>
      <tbody>{data.map(item => <tr key={item.id}><th scope="row">{item.label}</th>{series.map(line => <td key={line.id}>{format(item.values[line.id] ?? 0, line)}</td>)}</tr>)}</tbody>
    </table></div>}
    <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{loading ? "Loading" : ""}</p>
  </figure>;
}

/** Render an admitted immutable Zero multi-series chart. No query or transport side effects. */
export function LineChart(props: LineChartProps) {
 const model=useMemo(()=>buildLineChartModel(props.data,props.series),[props.data,props.series]);
 chartDimension(props.height??220,'height');
 chartLabel(props.label,'label');chartSelector(props.curve,'curve',['smooth','linear']);
 for(const key of ['unit','emptyLabel','categoryLabel'] as const)if(props[key]!==undefined)chartText(props[key],key);
 for(const key of ['motion','loading','legend'] as const)chartFlag(props[key],key);
 chartSelectionId(props.activeDatumId,'activeDatumId');chartSelectionId(props.defaultActiveDatumId,'defaultActiveDatumId');
 const ids=(values:readonly string[]|undefined,path:string)=>values===undefined?undefined:ownChartArray(values,path,CARTESIAN_LIMITS.series).map(value=>chartText(value,path,true));
 return <LineChartRenderer {...props} data={model.data} series={model.series} hiddenSeries={ids(props.hiddenSeries,'hiddenSeries')} defaultHiddenSeries={ids(props.defaultHiddenSeries,'defaultHiddenSeries')}/>;
}
export default LineChart;
