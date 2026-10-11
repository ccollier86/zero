"use client";

/** Streamgraph chart organism, adapted from Arc Free (MIT), copyright 2026 Elia Kuratli.
 * Owns browser rendering and interaction; consumes validated detached analytical inputs.
 * Source: https://uiarc.dev/components/streamgraph. No transport or database authority lives here.
 */


import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import { animate, motion, useMotionValue, useSpring } from "motion/react";
import { motionTokens } from "../shared/motion-tokens";
import { useArcChartEnvironment } from "../shared/use-arc-chart-environment";
import { optionNumber, ownArray, ownNumber, ownString, ARC_DISTRIBUTION_LIMITS } from "../streamgraph/distribution-admission";
import styles from "./streamgraph-classes";
import { ArcDistributionInspector } from "../streamgraph/arc-distribution-inspector";
import type { ReactNode } from "react";

import { buildStreamgraphModel, resampleStreamgraph as resample, computeStreamgraphBaseline as baseline, stackStreamgraphOrder as stackOrder, STREAMGRAPH_SAMPLES } from "./streamgraph-model";
import type { StreamgraphSeries, StreamgraphDatum, StreamgraphOffset } from "./streamgraph-model";
export type { StreamgraphSeries, StreamgraphDatum, StreamgraphOffset } from "./streamgraph-model";
/** Use a streamgraph for how the mix of several parts changes over time, when the overall shape matters more than exact values. */
export interface StreamgraphTooltipContext { datum: StreamgraphDatum; activeSeriesId: string|null; series:readonly StreamgraphSeries[]; visibleSeries:readonly StreamgraphSeries[]; total:number; formatValue:(value:number,series:StreamgraphSeries)=>string; }

export interface StreamgraphProps {
  data: readonly StreamgraphDatum[];
  /** Layers from the centre out: the first runs through the middle of the stream, the rest alternate above and below it. */
  series: readonly StreamgraphSeries[];
  /** What is measured, such as "Support tickets by topic". Names the chart for assistive technology. */
  label: string;
  /** Unit after each value, such as "tickets". */
  unit?: string;
  /** Plot height in pixels. The width follows the container. */
  height?: number;
  /** "wiggle" minimises layer slopes for a flowing stream, "silhouette" centres the stack, "zero" stacks from a flat baseline. */
  offset?: "wiggle" | "silhouette" | "zero";
  formatValue?: (value: number, series: StreamgraphSeries) => string;
  /** Controlled hidden layer keys. A hidden layer thins to nothing and the rest reflow. */
  hiddenSeriesIds?: readonly string[];
  defaultHiddenSeriesIds?: readonly string[];
  onHiddenSeriesChange?: (hidden: string[]) => void;
  /** Called as the reading moves, and with nulls when it leaves. */
  onActiveChange?: (datumId: string | null, seriesId: string | null) => void;
  /** Controlled reading identities; values remain tied to the same datum through insertions. */
  activeDatumId?: string|null;
  activeSeriesId?: string|null;
  /** Layer toggles above the plot. */
  legend?: boolean;
  /** Names each layer inside its widest stretch when it is thick enough to hold the text. */
  directLabels?: boolean;
  /** Header of the first column in the screen reader table. */
  categoryLabel?: string;
  emptyLabel?: string;
  ref?: Ref<HTMLElement>;
  className?: string;
  /** undefined uses the reference inspector; null explicitly suppresses it. */
  renderTooltip?: (context:StreamgraphTooltipContext) => ReactNode;
  /** Disable chart geometry motion without altering measurements. */
  motion?: boolean;
}

type Hover = { index: number; key: string | null; y: number | null };
type Frame = { lower: number[][]; upper: number[][]; toY: (value: number) => number; center: number[] };

const { spring } = motionTokens;
const physical = ({ visualDuration, bounce }: { visualDuration: number; bounce: number }, restDelta = .0005) => { const root = (2 * Math.PI) / (visualDuration * 1.2); return { type: "spring" as const, stiffness: root * root, damping: 2 * (1 - bounce) * root, restDelta, restSpeed: restDelta * 2 }; };
const settle = physical(spring.smooth);
const swell = physical({ visualDuration: .9, bounce: 0 });
const glide = physical(spring.snappy, .01);
const follow = { stiffness: glide.stiffness, damping: glide.damping, restDelta: .01 };

/** Samples across the plot: every layer is resampled onto the same grid, so datasets of any length morph into each other. */
const N = STREAMGRAPH_SAMPLES;
const PAD = 10;
/** Neutral steps by layer. Stacked from the centre out, neighbours always sit at least ten steps apart; the accent is kept for the layer in focus. */
/** The first four layers take the chart series in order (the first in the accent); later layers fall back to neutral steps that alternate in lightness. */
const SHADES = [30, 18, 24, 14];
const colorOf = (item: StreamgraphSeries, index: number) => item.color ?? (index < 4 ? `var(--zero-arc-series-${index + 1}, var(--zero-chart-${["blue","purple","amber","teal"][index]}))` : `color-mix(in oklab, var(--zero-arc-foreground, var(--zero-chart-foreground, var(--foreground))) ${SHADES[(index - 4) % SHADES.length]}%, var(--zero-arc-surface, var(--zero-chart-surface, var(--card))))`);
const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Axis labels that fit: at most one per 72 pixels, counted back from the latest. */
function axisPicks(data: StreamgraphDatum[], width: number) {
  const labeled = data.flatMap((item, index) => item.axisLabel ? [index] : []);
  if (!width || !labeled.length) return [];
  const stride = Math.ceil(labeled.length / Math.max(2, Math.floor(width / 72)));
  return labeled.reverse().filter((_, rank) => rank % stride === 0).reverse();
}

export function Streamgraph({ data: dataInput, series: seriesInput, label, unit = "", height = 260, offset = "wiggle", formatValue, hiddenSeriesIds, defaultHiddenSeriesIds, onHiddenSeriesChange, onActiveChange, activeDatumId, activeSeriesId, legend = true, directLabels = true, categoryLabel = "Date", emptyLabel = "No data for this range", ref, className, renderTooltip, motion: motionEnabled = true }: StreamgraphProps) {
  height = optionNumber(height,260,40,4096,"Streamgraph height");
  if(!["wiggle","silhouette","zero"].includes(offset)) throw new TypeError("Streamgraph offset is unsupported");
  const { data, series } = useMemo(() => buildStreamgraphModel(dataInput, seriesInput), [dataInput, seriesInput]);
  label=ownString(label,"Chart label");
  const figure = useRef<HTMLElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const paths = useRef(new Map<string, SVGPathElement>());
  const labels = useRef(new Map<string, SVGTextElement>());
  useImperativeHandle(ref, () => figure.current as HTMLElement);
  const { inView, reduced } = useArcChartEnvironment(figure, { motion: motionEnabled });
  const last = data.length - 1;
  const empty = data.length === 0;

  const [ownHidden, setOwnHidden] = useState<string[]>(()=>ownArray(defaultHiddenSeriesIds??[],ARC_DISTRIBUTION_LIMITS.series,"Hidden series IDs").map(v=>ownString(v,"Hidden series ID",256)));
  const hidden = ownArray(hiddenSeriesIds??ownHidden,ARC_DISTRIBUTION_LIMITS.series,"Hidden series IDs").map(v=>ownString(v,"Hidden series ID",256)).filter(id=>series.some(line=>line.id===id));
  useEffect(()=>{setOwnHidden(previous=>previous.filter(id=>series.some(line=>line.id===id)));},[series]);
  const toggle = (key: string) => {
    const next = hidden.includes(key) ? hidden.filter(item => item !== key) : [...hidden, key];
    if (hiddenSeriesIds === undefined) setOwnHidden(next);
    onHiddenSeriesChange?.(next);
  };
  const visible = series.filter(item => !hidden.includes(item.id));

  // Each layer becomes a dense curve on the shared grid; the painter blends from what is on screen to it.
  const signature = JSON.stringify([series,data]);
  const targets = useMemo(() => new Map(series.map(line => [line.id, resample(data.map(item => item.values[line.id] ?? 0))])), [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const [ownHover,setOwnHover] = useState<(Hover & {datumId:string})|null>(null);
  const selectedId=activeDatumId===undefined?ownHover?.datumId:activeDatumId;
  const selectedIndex=selectedId?data.findIndex(datum=>datum.id===selectedId):-1;
  const hover:Hover|null = selectedIndex>=0 ? {index:selectedIndex,key:activeSeriesId===undefined?ownHover?.key??null:activeSeriesId,y:ownHover?.y??null}:null;
  const index=hover?.index??null;
  const setHover = (next:Hover|null|((previous:Hover|null)=>Hover|null))=>{
   const reading=typeof next==="function"?next(hover):next;
   const datum=reading?data[reading.index]:undefined;
   if(activeDatumId===undefined)setOwnHover(reading&&datum?{...reading,datumId:datum.id}:null);
   else if(activeSeriesId===undefined)setOwnHover(reading&&datum?{...reading,datumId:datum.id}:null);
   onActiveChange?.(datum?.id??null,reading?.key??null);
  };
  useEffect(()=>{if(ownHover&&(!data.some(datum=>datum.id===ownHover.datumId)||(ownHover.key&&!series.some(line=>line.id===ownHover.key))))setOwnHover(null);},[data,series,ownHover]);
  const [legendKey, setLegendKey] = useState<string | null>(null);
  const wanted = hover?.key ?? legendKey;
  const activeKey = wanted && visible.some(item => item.id === wanted) ? wanted : null;

  const width = useRef(0);
  const [plotWidth, setPlotWidth] = useState(0);
  const shapes = useRef(new Map<string, number[]>());
  const presence = useRef(new Map<string, { value: number; stop: (() => void) | null }>());
  const frame = useRef<Frame | null>(null);
  const spots = useRef(new Map<string, number>());
  const grow = useMotionValue(0);
  const live = useRef({ series, offset });
  useLayoutEffect(() => { live.current = { series, offset }; });

  // One writer for every drawn attribute: morphs, toggles, the first swell, and resizes all repaint through here.
  const paint = useCallback(() => {
    const w = width.current;
    if (!w) {for(const path of paths.current.values())path.setAttribute('d','M0,0');for(const text of labels.current.values())text.style.opacity='0';frame.current=null;return;}
    const { series: order, offset: mode } = live.current;
    const layers = order.map(line => { const shape = shapes.current.get(line.id); const p = presence.current.get(line.id)?.value ?? 1; return shape ? shape.map(value => value * p) : new Array<number>(N).fill(0); });
    const stack = stackOrder(order.length, mode);
    const g = baseline(stack.map(i => layers[i]!), mode);
    const lower: number[][] = new Array(order.length), upper: number[][] = new Array(order.length);
    let running = g.slice();
    for (const i of stack) { const layer = layers[i]!; lower[i] = running; running = running.map((value, j) => value + layer[j]!); upper[i] = running; }
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < N; j++) { lo = Math.min(lo, g[j]!); hi = Math.max(hi, running[j]!); }
    if (!Number.isFinite(lo) || hi === lo) { lo = -1; hi = 1; }
    const span = hi - lo, s = grow.get();
    const center = g.map((value, j) => (value + running[j]!) / 2);
    const toY = (value: number) => PAD + (1 - (value - lo) / span) * (height - PAD * 2);
    const yAt = (value: number, j: number) => toY(center[j]! + (value - center[j]!) * s);
    frame.current = { lower, upper, toY, center };
    const xs = Array.from({ length: N }, (_, j) => (j / (N - 1)) * w);
    order.forEach((line, i) => {
      const top = upper[i]!, bottom = lower[i]!;
      const node = paths.current.get(line.id);
      if (node) {
        let d = "";
        for (let j = 0; j < N; j++) d += `${j ? "L" : "M"}${xs[j]!.toFixed(1)},${yAt(top[j]!, j).toFixed(1)}`;
        for (let j = N - 1; j >= 0; j--) d += `L${xs[j]!.toFixed(1)},${yAt(bottom[j]!, j).toFixed(1)}`;
        node.setAttribute("d", `${d}Z`);
      }
      // The label sits where its layer is thickest, and holds its spot until another stretch is clearly thicker.
      const text = labels.current.get(line.id);
      if (!text) return;
      let best = 4;
      for (let j = 4; j < N - 4; j++) if (top[j]! - bottom[j]! > top[best]! - bottom[best]!) best = j;
      const held = spots.current.get(line.id);
      const j = held !== undefined && top[held]! - bottom[held]! >= (top[best]! - bottom[best]!) * .8 ? held : best;
      spots.current.set(line.id, j);
      const thickness = (top[j]! - bottom[j]!) / span * (height - PAD * 2) * s;
      const room = text.getComputedTextLength?.() ?? 60;
      const x = clamp(xs[j]!, room / 2 + 6, w - room / 2 - 6);
      text.setAttribute("x", x.toFixed(1));
      text.setAttribute("y", yAt((top[j]! + bottom[j]!) / 2, j).toFixed(1));
      text.style.opacity = thickness >= 19 && room + 16 < w ? "1" : "0";
    });
  }, [grow, height]);

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

  // New data blends every layer from the shape on screen; a layer that arrives grows out of the one below it.
  const morph = useRef<{ stop: () => void } | null>(null);
  useEffect(() => {
    const moves: { key: string; from: number[]; to: number[] }[] = [];
    for (const [key, to] of targets) {
      const from = shapes.current.get(key);
      if (!from || reduced) { shapes.current.set(key, to); continue; }
      moves.push({ key, from, to });
    }
    for (const key of [...shapes.current.keys()]) if (!targets.has(key)) shapes.current.delete(key);
    morph.current?.stop();
    if (!moves.length) { paint(); return; }
    morph.current = animate(0, 1, { ...settle, onUpdate: t => { for (const move of moves) shapes.current.set(move.key, move.from.map((value, j) => value + (move.to[j]! - value) * t)); paint(); }, onComplete: () => { for (const move of moves) shapes.current.set(move.key, move.to); paint(); } });
    return () => morph.current?.stop();
  }, [paint, reduced, targets]);

  // A hidden layer thins to nothing while the others close over it.
  const hiddenKey = JSON.stringify(hidden);
  useEffect(() => {
    for (const line of series) {
      const to = hidden.includes(line.id) ? 0 : 1;
      const track = presence.current.get(line.id);
      if (!track) { presence.current.set(line.id, { value: to, stop: null }); continue; }
      if (track.value === to) continue;
      track.stop?.();
      if (reduced) { track.value = to; track.stop = null; continue; }
      const controls = animate(track.value, to, { ...settle, onUpdate: value => { track.value = value; paint(); } });
      track.stop = () => controls.stop();
    }
    for(const [key,track] of presence.current) if(!series.some(line=>line.id===key)){track.stop?.();presence.current.delete(key);}
    paint();
    return ()=>{for(const track of presence.current.values()){track.stop?.();track.stop=null;}};
  }, [hiddenKey, paint, reduced, series]); // eslint-disable-line react-hooks/exhaustive-deps

  // The first time the chart is seen, the stream swells out of a hairline along its centre.
  useEffect(() => {
    if (empty) return;
    if (reduced) { grow.jump(1); paint(); return; }
    if (!inView || grow.get() >= 1) return;
    const controls = animate(grow, 1, { ...swell, onUpdate: paint });
    return () => controls.stop();
  }, [empty, grow, inView, paint, reduced]);

  // The crosshair glides between points; the tooltip follows on its own spring and never leaves the plot.
  const cursor = useMotionValue(0);
  const cursorSpring = useSpring(cursor, follow);
  const wasActive=useRef(false);
  useLayoutEffect(()=>{
   if(index===null||!width.current){wasActive.current=false;return;}
   const x=last>0?index/last*width.current:width.current/2;
   cursor.set(x);if(!wasActive.current||reduced)cursorSpring.jump(x);
   wasActive.current=true;
  },[index,last,reduced,cursor,cursorSpring,plotWidth]);



  // The layer under the pointer, found in the frame that is on screen.
  const read = (clientX: number, clientY: number): Hover | null => {
    const rect = plot.current?.getBoundingClientRect(), f = frame.current;
    if (!rect?.width || empty) return null;
    const share = clamp((clientX - rect.left) / rect.width, 0, 1), y = clientY - rect.top;
    const at = last > 0 ? Math.round(share * last) : 0, j = Math.round(share * (N - 1));
    let key: string | null = null;
    if (f) series.forEach((line, i) => { if (hidden.includes(line.id)) return; const top = f.toY(f.upper[i]![j]!), bottom = f.toY(f.lower[i]![j]!); if (y >= top - 1 && y <= bottom + 1) key = line.id; });
    return { index: at, key, y };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType === "mouse" || event.buttons) setHover(read(event.clientX, event.clientY)); };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType !== "mouse") event.currentTarget.setPointerCapture?.(event.pointerId); setHover(read(event.clientX, event.clientY)); };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (empty) return;
    if (event.key === "Escape" && hover) { event.preventDefault(); setHover(null); return; }
    const from = index ?? last;
    const keys = visible.map(line => line.id), at = activeKey ? keys.indexOf(activeKey) : -1;
    const page = Math.max(1, Math.round(data.length / 6));
    const moves: Record<string, () => Hover> = {
      ArrowLeft: () => ({ index: clamp(from - 1, 0, last), key: activeKey, y: null }),
      ArrowRight: () => ({ index: clamp(index === null ? last : from + 1, 0, last), key: activeKey, y: null }),
      PageDown: () => ({ index: clamp(from - page, 0, last), key: activeKey, y: null }),
      PageUp: () => ({ index: clamp(from + page, 0, last), key: activeKey, y: null }),
      Home: () => ({ index: 0, key: activeKey, y: null }),
      End: () => ({ index: last, key: activeKey, y: null }),
      ArrowUp: () => ({ index: from, key: keys[at < 0 ? keys.length - 1 : Math.min(keys.length - 1, at + 1)] ?? null, y: null }),
      ArrowDown: () => ({ index: from, key: keys[at < 0 ? 0 : Math.max(0, at - 1)] ?? null, y: null }),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setHover(move());
  };

  const format = (value: number, line: StreamgraphSeries) => `${formatValue ? formatValue(value, line) : grouped.format(value)}${unit ? ` ${unit}` : ""}`;
  const reading = index === null ? null : data[index];
  const total = (datum: StreamgraphDatum) => visible.reduce((sum, line) => sum + Math.max(0, datum.values[line.id] ?? 0), 0);
  const announce = reading ? `${reading.label}. ${activeKey ? `${series.find(line => line.id === activeKey)?.label} ${format(reading.values[activeKey] ?? 0, series.find(line => line.id === activeKey)!)}, ` : ""}${visible.length} layers, ${grouped.format(total(reading))}${unit ? ` ${unit}` : ""} in total` : "";
  const summary = empty ? `${label}. ${emptyLabel}.` : `${label}, ${data[0]!.label} to ${data[last]!.label}. ${visible.map(line => `${line.label}, latest ${format(data[last]!.values[line.id] ?? 0, line)}`).join(". ")}.`;
  const picks = axisPicks(data, plotWidth);

  const tooltipContext:StreamgraphTooltipContext|null = reading ? {datum:reading,activeSeriesId:activeKey,series,visibleSeries:visible,total:total(reading),formatValue:format}:null;
  const defaultTooltip = <div><p className={styles.tipTitle}>{reading?.label ?? ""}</p>
          {stackOrder(series.length, offset).reverse().map(at => series[at]!).filter(line => !hidden.includes(line.id)).map(line => <p key={line.id} className={styles.tipRow} data-active={activeKey === line.id || undefined} data-dim={(activeKey !== null && activeKey !== line.id) || undefined} style={{ "--series": colorOf(line, series.indexOf(line)) } as CSSProperties}>
            <span className={styles.tipSwatch} />
            <span className={styles.tipName}>{line.label}</span>
            <span className={styles.tipValue}>{reading ? format(reading.values[line.id] ?? 0, line) : ""}</span>
          </p>)}</div>;
  const customTooltip=tooltipContext?renderTooltip?.(tooltipContext):undefined;
  const tooltipContent=customTooltip===undefined?defaultTooltip:customTooltip;

  return <figure ref={figure} data-zero-arc-chart="streamgraph" data-motion={reduced?"off":"on"} className={[styles.figure, className].filter(Boolean).join(" ")} aria-label={label}>
    {legend && series.length > 1 && <div className={styles.legend} role="group" aria-label={`${label} layers`} onPointerLeave={() => setLegendKey(null)}>
      {series.map((line, at) => <button key={line.id} type="button" className={styles.toggle} aria-pressed={!hidden.includes(line.id)} data-active={activeKey === line.id || undefined} data-dim={(activeKey !== null && activeKey !== line.id) || undefined} onClick={() => toggle(line.id)}
        onPointerEnter={event => { if (event.pointerType === "mouse") setLegendKey(line.id); }} onFocus={event => { if (event.currentTarget.matches(":focus-visible")) setLegendKey(line.id); }} onBlur={() => setLegendKey(null)}
        style={{ "--series": colorOf(line, at) } as CSSProperties}>
        <span className={styles.swatch} aria-hidden="true" />
        <span className={styles.toggleLabel}>{line.label}</span>
      </button>)}
    </div>}
    <div className={styles.chart} data-active={index !== null || undefined} data-layer={activeKey ? true : undefined}>
      <div ref={plot} className={styles.plot} style={{ height }} role="group" tabIndex={empty ? -1 : 0} aria-roledescription="stream graph" aria-label={`${label}. Use left and right arrows to move through time, up and down to change layer.`}
        onPointerMove={onPointerMove} onPointerDown={onPointerDown} onPointerUp={event => { if (event.pointerType !== "mouse") setHover(null); }} onPointerCancel={() => setHover(null)} onPointerLeave={event => { if (event.pointerType === "mouse") setHover(null); }}
        onKeyDown={onKeyDown} onBlur={() => setHover(null)} onFocus={event => { if (event.currentTarget.matches(":focus-visible") && !empty) setHover(current => current ?? { index: last, key: null, y: null }); }}>
        <svg className={styles.svg} width="100%" height={height} aria-hidden="true" focusable="false">
          {series.map((line, at) => <path key={line.id} ref={node => { if (node) paths.current.set(line.id, node); else paths.current.delete(line.id); }} className={styles.layer} data-active={activeKey === line.id || undefined} data-custom={line.color ? true : undefined} style={{ "--series": colorOf(line, at) } as CSSProperties} />)}
          <motion.line className={styles.crosshair} x1={0} x2={0} y1={0} y2={height} style={{ x: reduced ? cursor : cursorSpring }} />
          {directLabels && series.map(line => <text key={line.id} ref={node => { if (node) labels.current.set(line.id, node); else labels.current.delete(line.id); }} className={styles.label} data-active={activeKey === line.id || undefined} data-custom={line.color ? true : undefined} data-hidden={hidden.includes(line.id) || undefined} data-dim={(activeKey !== null && activeKey !== line.id) || undefined} textAnchor="middle" dominantBaseline="central">{line.label}</text>)}
        </svg>
        <ArcDistributionInspector open={plotWidth>0&&index!==null&&visible.length>0} point={[index===null?0:last>0?index/last*plotWidth:plotWidth/2,hover?.y??height/2]} content={tooltipContent} className={styles.tooltip} plot={plot.current} side="right" onDismiss={()=>setHover(null)} />
        {(empty || visible.length === 0) && <p className={styles.message}>{empty ? emptyLabel : "Choose a layer to show"}</p>}
      </div>
      <div className={styles.axis} aria-hidden="true">
        {picks.map(at => { const share = last > 0 ? at / last : .5; const item = data[at]!; return <span key={`${item.id}`} className={styles.axisLabel} style={{ left: `${share * 100}%`, translate: `${-share * 100}% 0` }}>{item.axisLabel}</span>; })}
      </div>
    </div>
    <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{announce}</p>
    <p className={styles.srOnly}>{summary}</p>
    {!empty && <div className={styles.srOnly}><table>
      <caption>{label}</caption>
      <thead><tr><th scope="col">{categoryLabel}</th>{series.map(line => <th key={line.id} scope="col">{line.label}</th>)}</tr></thead>
      <tbody>{data.map(item => <tr key={item.id}><th scope="row">{item.label}</th>{series.map(line => <td key={line.id}>{format(item.values[line.id] ?? 0, line)}</td>)}</tr>)}</tbody>
    </table></div>}
  </figure>;
}

export default Streamgraph;
