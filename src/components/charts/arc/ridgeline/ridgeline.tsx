"use client";

/** Ridgeline chart organism, adapted from Arc Free (MIT), copyright 2026 Elia Kuratli.
 * Owns browser rendering and interaction; consumes validated detached analytical inputs.
 * Source: https://uiarc.dev/components/ridgeline. No transport or database authority lives here.
 */


import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import { animate } from "motion/react";
import { useArcChartEnvironment } from "../shared/use-arc-chart-environment";
import { optionNumber, ownArray, ownNumber, ownString, ARC_DISTRIBUTION_LIMITS } from "../streamgraph/distribution-admission";
import styles from "./ridgeline-classes";
import { ArcDistributionInspector } from "../streamgraph/arc-distribution-inspector";
import type { ReactNode } from "react";

import { buildRidgelineModel, ridgelineHeightAt as heightAt, computeRidgelineTicks, inspectRidgeline } from "./ridgeline-model";
import type { RidgelineSeries, RidgelineStats as Stats, RidgelineShape as Shape } from "./ridgeline-model";
export type { RidgelineSeries } from "./ridgeline-model";
/** Use a ridgeline to compare the shape of many distributions at once, such as daily temperatures by month or response times by region. */
export interface RidgelineTooltipContext { series:RidgelineSeries;stats:Stats;value:number|null;empiricalShare:number|null;formatValue:(value:number)=>string; }

export interface RidgelineProps {
  /** One ridge per series, drawn top to bottom. */
  series: readonly RidgelineSeries[];
  /** What is measured, such as "Daily highs in Zurich". Names the chart for assistive technology. */
  label: string;
  /** Unit after each value, such as "°C". */
  unit?: string;
  formatValue?: (value: number) => string;
  /** Value range of the axis. Defaults to the data with a little room on each side. */
  domain?: readonly [number, number];
  /** How far a ridge may rise into the rows above, in row heights. */
  overlap?: number;
  /** Height of one row in pixels. */
  rowHeight?: number;
  /** Smoothing in value units. Defaults to Silverman's rule per series. */
  bandwidth?: number;
  /** Shades each ridge by its median, from a light tint to the full first series color, and shows the scale under the axis. */
  tint?: boolean;
  /** Controlled id of the lifted ridge. */
  activeSeriesId?: string | null;
  defaultActiveSeriesId?: string | null;
  onActiveChange?: (id: string | null) => void;
  emptyLabel?: string;
  ref?: Ref<HTMLElement>;
  className?: string;
  /** undefined uses the reference inspector; null explicitly suppresses it. */
  renderTooltip?: (context:RidgelineTooltipContext) => ReactNode;
  /** Disable chart geometry motion without altering measurements. */
  motion?: boolean;
}

const physical = ({ visualDuration, bounce }: { visualDuration: number; bounce: number }, restDelta = .0005) => { const root = (2 * Math.PI) / (visualDuration * 1.2); return { type: "spring" as const, stiffness: root * root, damping: 2 * (1 - bounce) * root, restDelta, restSpeed: restDelta * 2 }; };
const morph = physical({ visualDuration: .7, bounce: .08 });
const reveal = physical({ visualDuration: 1, bounce: 0 });
const SAMPLES = 96, AXIS = 28, LIFT = 6;
const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;


export function Ridgeline({ series: seriesInput, label, unit = "", formatValue, domain, overlap = 2.4, rowHeight = 30, bandwidth, tint = true, activeSeriesId, defaultActiveSeriesId = null, onActiveChange, emptyLabel = "No data yet", ref, className, renderTooltip, motion: motionEnabled = true }: RidgelineProps) {
  overlap=optionNumber(overlap,2.4,1,8,"Ridgeline overlap");
  rowHeight=optionNumber(rowHeight,30,18,100,"Ridgeline row height");
  label=ownString(label,"Chart label");
  const figure = useRef<HTMLElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const fills = useRef(new Map<string, SVGPathElement>());
  const lines = useRef(new Map<string, SVGPathElement>());
  const medians = useRef(new Map<string, SVGLineElement>());
  const lifted = useRef<{ fill: SVGPathElement | null; band: SVGPathElement | null; line: SVGPathElement | null; median: SVGLineElement | null; group: SVGGElement | null }>({ fill: null, band: null, line: null, median: null, group: null });
  const tickRefs = useRef(new Map<number, HTMLDivElement>());
  const cross = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => figure.current as HTMLElement);
  const { inView, reduced } = useArcChartEnvironment(figure, { motion: motionEnabled });
  // A true minus sign keeps negative values tight and lined up with the tabular digits.
  const format = (value: number|null) => value===null?'—':formatValue ? formatValue(value) : `${grouped.format(value).replace("-", "\u2212")}${unit}`;

  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = plot.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Targets: one density per series on a shared domain, scaled so the tallest peak of all rises `overlap` rows.
  const model = useMemo(()=>buildRidgelineModel(seriesInput,{domain,bandwidth}),[seriesInput,domain,bandwidth]);
  const series = model.series;

  const [ownActive, setOwnActive] = useState<string | null>(defaultActiveSeriesId);
  const wanted = activeSeriesId !== undefined ? activeSeriesId : ownActive;
  const current = wanted && model.stats.get(wanted)?.n ? wanted : null;
  useEffect(()=>{if(ownActive&&!model.stats.get(ownActive)?.n){setOwnActive(null);setCursor(null);}},[model,ownActive]);
  const setCurrent = (id: string | null) => { if (activeSeriesId === undefined) setOwnActive(id); if (id !== current) onActiveChange?.(id); };
  const [cursor, setCursor] = useState<{ value: number; pointerY: number | null } | null>(null);

  const narrow = width > 0 && width < 420;
  const gutter = Math.min(Math.max(0,width-4), narrow ? 36 : 52);
  const top = Math.ceil((overlap - 1) * rowHeight) + LIFT + 8;
  const height = top + series.length * rowHeight + AXIS;
  const plotWidth = Math.max(0, width - gutter - 4);
  const baselineOf = (row: number) => top + (row + 1) * rowHeight;

  // Drawn geometry lives outside React; a spring interpolates it from what is on screen to the new targets.
  const drawn = useRef({ shapes: new Map<string, Shape>(), lo: 0, hi: 1 });
  const live = useRef({ gutter, plotWidth, rowHeight, overlap, top, current });
  useLayoutEffect(() => { live.current = { gutter, plotWidth, rowHeight, overlap, top, current }; });
  const xOf = (value: number) => { const d = drawn.current, L = live.current; return L.gutter + ((value - d.lo) / (d.hi - d.lo || 1)) * L.plotWidth; };

  const paint = () => {
    const d = drawn.current, L = live.current;
    const sx = (value: number) => L.gutter + ((value - d.lo) / (d.hi - d.lo || 1)) * L.plotWidth;
    const lift = L.rowHeight * L.overlap;
    const curvePath = (shape: Shape, closed: boolean, from = -Infinity, to = Infinity) => {
      const base = L.top + (shape.row + 1) * L.rowHeight;
      const points: string[] = [];
      const push = (x: number, y: number) => points.push(`${sx(x).toFixed(2)},${(base - y * lift).toFixed(2)}`);
      if (from > -Infinity) push(from, heightAt(shape, from));
      shape.xs.forEach((x, i) => { if (x > from && x < to) push(x, shape.ys[i]!); });
      if (to < Infinity) push(to, heightAt(shape, to));
      if (!points.length) return "";
      const first = from > -Infinity ? from : shape.xs[0]!, last = to < Infinity ? to : shape.xs[shape.xs.length - 1]!;
      return closed ? `M${sx(first).toFixed(2)},${base}L${points.join("L")}L${sx(last).toFixed(2)},${base}Z` : `M${points.join("L")}`;
    };
    for (const [id, shape] of d.shapes) {
      const fill = fills.current.get(id), line = lines.current.get(id), median = medians.current.get(id);
      fill?.setAttribute("d", curvePath(shape, true));
      line?.setAttribute("d", curvePath(shape, false));
      if (median) { const x = sx(shape.median), base = L.top + (shape.row + 1) * L.rowHeight; median.setAttribute("x1", x.toFixed(2)); median.setAttribute("x2", x.toFixed(2)); median.setAttribute("y1", String(base)); median.setAttribute("y2", (base - heightAt(shape, shape.median) * lift).toFixed(2)); }
    }
    const shape = L.current ? d.shapes.get(L.current) : undefined, lens = lifted.current;
    if (shape && lens.fill && lens.line && lens.band && lens.median) {
      lens.fill.setAttribute("d", curvePath(shape, true));
      lens.line.setAttribute("d", curvePath(shape, false));
      lens.band.setAttribute("d", curvePath(shape, true, shape.q1, shape.q3));
      const x = sx(shape.median), base = L.top + (shape.row + 1) * L.rowHeight;
      lens.median.setAttribute("x1", x.toFixed(2)); lens.median.setAttribute("x2", x.toFixed(2)); lens.median.setAttribute("y1", String(base)); lens.median.setAttribute("y2", (base - heightAt(shape, shape.median) * lift).toFixed(2));
    }
    for (const [value, tick] of tickRefs.current) tick.style.transform = `translate3d(${sx(value).toFixed(2)}px, 0, 0)`;
  };
  const paintRef = useRef(paint);
  useLayoutEffect(() => { paintRef.current = paint; });

  const shown = inView || reduced;
  useEffect(() => {
    if (!shown) return;
    const d = drawn.current;
    const first = d.shapes.size === 0;
    const from = new Map<string, Shape>();
    for (const [id, target] of model.shapes) {
      const now = d.shapes.get(id);
      from.set(id, now ? { ...now, xs: [...now.xs], ys: [...now.ys] } : { ...target, ys: target.ys.map(() => 0), q1: target.median, q3: target.median });
    }
    const fromLo = first ? model.lo : d.lo, fromHi = first ? model.hi : d.hi;
    const finish = () => { d.shapes = new Map([...model.shapes].map(([id, shape]) => [id, { ...shape }])); d.lo = model.lo; d.hi = model.hi; paintRef.current(); };
    if (reduced) { finish(); return; }
    d.shapes = new Map([...from].map(([id, shape]) => [id, { ...shape, xs: [...shape.xs], ys: [...shape.ys] }]));
    const controls = animate(0, 1, { ...(first ? reveal : morph), onUpdate: t => {
      d.lo = mix(fromLo, model.lo, t); d.hi = mix(fromHi, model.hi, t);
      for (const [id, to] of model.shapes) {
        const f = from.get(id)!, out = d.shapes.get(id)!;
        // Stagger the reveal a little from the top row down, so the ridges roll in like a wave.
        const local = first ? clamp((t - to.row * .025) / (1 - Math.min(.5, model.shapes.size * .025)), 0, 1) : t;
        for (let i = 0; i < SAMPLES; i++) { out.xs[i] = mix(f.xs[i]!, to.xs[i]!, local); out.ys[i] = mix(f.ys[i]!, to.ys[i]!, local); }
        out.row = mix(f.row, to.row, local); out.q1 = mix(f.q1, to.q1, local); out.median = mix(f.median, to.median, local); out.q3 = mix(f.q3, to.q3, local);
      }
      paintRef.current();
    }, onComplete: finish });
    return () => controls.stop();
  }, [shown, model, reduced]);
  useLayoutEffect(() => { paintRef.current(); });

  // Axis ticks for the target domain; their positions follow the drawn domain every frame.
  const tickCount = Math.max(2, Math.floor(plotWidth / 72));
  const {step,ticks}=computeRidgelineTicks(model.lo,model.hi,tickCount);

  const activeStats = current ? model.stats.get(current) : undefined;
  const activeSeries = current ? series.find(entry => entry.id === current) : undefined;
  const reading = cursor && activeStats ? { value: cursor.value, below: activeStats.n ? activeStats.sorted.filter(value => value <= cursor.value).length / activeStats.n : 0 } : null;
  // The tooltip keeps its last content while it fades out, so it never collapses to an empty box on leave.
  const [held, setHeld] = useState<{ id: string; value: number | null } | null>(null);
  if (current && (held?.id !== current || held.value !== (reading?.value ?? null))) setHeld({ id: current, value: reading?.value ?? null });
    const tipSeries = held ? series.find(entry => entry.id === held.id) : undefined;
  const tipStats = held ? model.stats.get(held.id) : undefined;
  const tipBelow = held && held.value !== null && tipStats?.n ? tipStats.sorted.filter(value => value <= held.value!).length / tipStats.n : 0;

  // Zero owns inspector collision/portals; the ridge owns only its data cursor.
  useLayoutEffect(()=>{if(cross.current)cross.current.style.transform=`translate3d(${reading?xOf(reading.value).toFixed(2):0}px,0,0)`;});

  const valueAt = (x: number) => { const d = drawn.current; return d.lo + clamp((x - gutter) / plotWidth, 0, 1) * (d.hi - d.lo); };
  const pick = (x: number, y: number) => {
    const value = valueAt(x), lift = rowHeight * overlap;
    let best: Shape | null = null, bestId: string | null = null;
    for (const [id, shape] of drawn.current.shapes) {
      const base = baselineOf(shape.row), h = heightAt(shape, value) * lift;
      if (y <= base + 2 && y >= base - h - 4 && (!best || shape.row > best.row)) { best = shape; bestId = id; }
    }
    if (!bestId) { const row = clamp(Math.floor((y - top) / rowHeight), 0, series.length - 1); bestId = series[row]?.id ?? null; }
    return { id: bestId, value };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (x < gutter - 8 || y > height - AXIS + 4) { if (event.pointerType === "mouse") { setCurrent(null); setCursor(null); } return; }
    const hit = pick(x, y);
    setCurrent(hit.id);
    setCursor({ value: hit.value, pointerY: y });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = current ? series.findIndex(entry => entry.id === current) : -1;
    const stats = (id: string | undefined) => id ? model.stats.get(id) : undefined;
    const choose = (index: number) => { event.preventDefault(); const next = series[clamp(index, 0, series.length - 1)]; if (!next) return; setCurrent(next.id); setCursor({ value: cursor?.value ?? stats(next.id)?.median ?? model.lo, pointerY: null }); };
    const nudge = (direction: number) => { event.preventDefault(); if (!current) { choose(0); return; } const base = cursor?.value ?? stats(current)?.median ?? model.lo; const next = clamp((Math.round(base / step) + direction) * step, model.lo, model.hi); setCursor({ value: next, pointerY: null }); };
    if (event.key === "ArrowDown") choose(at + 1);
    else if (event.key === "ArrowUp") choose(at < 0 ? 0 : at - 1);
    else if (event.key === "Home") choose(0);
    else if (event.key === "End") choose(series.length - 1);
    else if (event.key === "ArrowRight") nudge(1);
    else if (event.key === "ArrowLeft") nudge(-1);
    else if (event.key === "Escape" && current) { event.preventDefault(); setCurrent(null); setCursor(null); }
  };

  const empty = !series.length || series.every(entry => !entry.values.length);
  /** Ridge tone: one hue, the first series color, from a light tint (low median) to full strength (high median), so the scale never passes through a muddy middle. */
  const toneOf = (t: number) => `color-mix(in oklab, var(--zero-arc-series-1, var(--zero-chart-blue)) ${Math.round(38 + clamp(t, 0, 1) * 62)}%, var(--zero-arc-surface, var(--zero-chart-surface, var(--card))))`;
  const ridgeColor = (value: number) => tint ? toneOf((value - model.lo) / (model.hi - model.lo || 1)) : "var(--zero-arc-series-1, var(--zero-chart-blue))";
  const describe = (entry: RidgelineSeries) => { const s = model.stats.get(entry.id)!; return `${entry.label}: median ${format(s.median)}, middle half ${format(s.q1)} to ${format(s.q3)}, range ${format(s.min)} to ${format(s.max)}, ${s.n} values`; };

  const tooltipContext:RidgelineTooltipContext|null = activeSeries&&activeStats ? {series:activeSeries,stats:activeStats,value:reading?.value??null,empiricalShare:reading?inspectRidgeline(activeStats,reading.value):null,formatValue:format}:null;
  const defaultTooltip = <div>{tipSeries && tipStats && <>
          <p className={styles.tipTitle}>{tipSeries.label}</p>
          <p className={styles.tipValue}><span className={styles.tipKey}>Median</span><span>{format(tipStats.median)}</span></p>
          <p className={styles.tipRow}><span className={styles.tipKey}>Middle half</span><span>{format(tipStats.q1)} to {format(tipStats.q3)}</span></p>
          <p className={styles.tipRow}><span className={styles.tipKey}>Range</span><span>{format(tipStats.min)} to {format(tipStats.max)}</span></p>
          {held?.value != null && <p className={styles.tipNote}>{percent.format(tipBelow)} at or below {format(held.value)}</p>}
        </>}</div>;
  const customTooltip=tooltipContext?renderTooltip?.(tooltipContext):undefined;
  const tooltipContent=customTooltip===undefined?defaultTooltip:customTooltip;

  return <figure ref={figure} data-zero-arc-chart="ridgeline" data-motion={reduced?"off":"on"} className={[styles.figure, className].filter(Boolean).join(" ")} aria-label={label}>
    <div ref={plot} className={styles.plot} style={{ height }} data-active={current ? true : undefined} data-cursor={reading ? true : undefined} role="group" tabIndex={empty ? -1 : 0} aria-roledescription="ridgeline chart"
      aria-label={`${label}. Up and down arrows choose a ridge, left and right arrows move along the values.`}
      onPointerMove={onPointerMove} onPointerDown={onPointerMove} onPointerLeave={event => { if (event.pointerType === "mouse") { setCurrent(null); setCursor(null); } }} onKeyDown={onKeyDown} onBlur={() => { setCurrent(null); setCursor(null); }}>
      <div className={styles.ticks} aria-hidden="true" style={{ height: height - AXIS + 22 }}>
        {ticks.map(value => <div key={value} ref={element => { if (element) tickRefs.current.set(value, element); else tickRefs.current.delete(value); }} className={styles.tick} style={{ top: top - rowHeight * .5 }}>
          <span className={styles.tickLabel}>{format(value)}</span>
        </div>)}
      </div>
      <div ref={cross} className={styles.crosshair} style={{ top: top - rowHeight * .5, height: height - AXIS - top + rowHeight * .5 }} aria-hidden="true" />
      <svg className={styles.svg} width={width} height={height} viewBox={`0 0 ${Math.max(1, width)} ${height}`} aria-hidden="true" focusable="false">
        {series.map(entry => <g key={entry.id} className={styles.ridge} data-dim={current !== null && current !== entry.id || undefined} data-lifted={current === entry.id || undefined} style={{ "--ridge": ridgeColor(model.stats.get(entry.id)?.median ?? model.lo) } as CSSProperties}>
          <path ref={element => { if (element) fills.current.set(entry.id, element); else fills.current.delete(entry.id); }} className={styles.fill} />
          <line ref={element => { if (element) medians.current.set(entry.id, element); else medians.current.delete(entry.id); }} className={styles.median} />
          <path ref={element => { if (element) lines.current.set(entry.id, element); else lines.current.delete(entry.id); }} className={styles.line} />
        </g>)}
        <g ref={element => { lifted.current.group = element; }} className={styles.lens} data-on={current ? true : undefined} style={tipStats ? { "--ridge": ridgeColor(tipStats.median??model.lo) } as CSSProperties : undefined}>
          <path ref={element => { lifted.current.fill = element; }} className={styles.lensFill} />
          <path ref={element => { lifted.current.band = element; }} className={styles.lensBand} />
          <line ref={element => { lifted.current.median = element; }} className={styles.lensMedian} />
          <path ref={element => { lifted.current.line = element; }} className={styles.lensLine} />
        </g>
      </svg>
      <div className={styles.labels} aria-hidden="true">
        {series.map((entry, index) => <span key={entry.id} className={styles.rowLabel} data-active={current === entry.id || undefined} style={{ top: baselineOf(index) - 18, width: gutter - 10 }}>{entry.label}</span>)}
      </div>
      {empty && <p className={styles.message}>{emptyLabel}</p>}
      <ArcDistributionInspector open={width>0&&!!current&&!!activeStats?.n} point={[current?xOf(reading?.value??activeStats?.median??0):0,cursor?.pointerY??(current?baselineOf(model.shapes.get(current)?.row??0)-rowHeight-LIFT:0)]} content={tooltipContent} className={styles.tooltip} plot={plot.current} onDismiss={()=>{setCurrent(null);setCursor(null);}} />
    </div>
    {tint && !empty && <div className={styles.scale} aria-hidden="true">
      <span className={styles.scaleLabel}>Median</span>
      <span>{format(model.lo)}</span>
      <span className={styles.steps}>{[0, .25, .5, .75, 1].map(step => <span key={step} className={styles.step} style={{ "--ridge": toneOf(step) } as CSSProperties} />)}</span>
      <span>{format(model.hi)}</span>
    </div>}
    <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{activeSeries ? `${describe(activeSeries)}${reading ? `. ${percent.format(reading.below)} at or below ${format(reading.value)}` : ""}` : ""}</p>
    {!empty && <div className={styles.srOnly}><table>
      <caption>{label}</caption>
      <thead><tr><th scope="col">Series</th><th scope="col">Median</th><th scope="col">First quartile</th><th scope="col">Third quartile</th><th scope="col">Lowest</th><th scope="col">Highest</th><th scope="col">Count</th></tr></thead>
      <tbody>{series.map(entry => { const s = model.stats.get(entry.id)!; return <tr key={entry.id}><th scope="row">{entry.label}</th><td>{s.n?format(s.median):'—'}</td><td>{s.n?format(s.q1):'—'}</td><td>{s.n?format(s.q3):'—'}</td><td>{s.n?format(s.min):'—'}</td><td>{s.n?format(s.max):'—'}</td><td>{s.n}</td></tr>; })}</tbody>
    </table></div>}
  </figure>;
}

export default Ridgeline;
