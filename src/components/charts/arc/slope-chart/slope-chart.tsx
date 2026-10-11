"use client";

/** SlopeChart chart organism, adapted from Arc Free (MIT), copyright 2026 Elia Kuratli.
 * Owns browser rendering and interaction; consumes validated detached analytical inputs.
 * Source: https://uiarc.dev/components/slope-chart. No transport or database authority lives here.
 */


import { useImperativeHandle, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import { AnimatePresence, motion } from "motion/react";
import { motionTokens } from "../shared/motion-tokens";
import { useArcChartEnvironment } from "../shared/use-arc-chart-environment";
import { optionNumber, ownArray, ownNumber, ownString, ARC_DISTRIBUTION_LIMITS } from "../streamgraph/distribution-admission";
import styles from "./slope-chart-classes";
import { ArcDistributionInspector } from "../streamgraph/arc-distribution-inspector";
import type { ReactNode } from "react";

import { buildSlopeModel, computeSlopeLayout } from "./slope-chart-model";
import type { SlopeItem, SlopeRow as Row } from "./slope-chart-model";
export type { SlopeItem } from "./slope-chart-model";
/** Use a slope chart to show how several items changed between exactly two moments, and how their order changed. */
export interface SlopeTooltipContext { item:SlopeItem; startLabel:string;endLabel:string;change:number;startRank:number;endRank:number;formatValue:(value:number)=>string; }

export interface SlopeChartProps {
  data: readonly SlopeItem[];
  /** What is measured, such as "Conversion rate by channel". Names the chart for assistive technology. */
  label: string;
  /** Heading of the first column, such as "Q1". */
  startLabel: string;
  /** Heading of the second column, such as "Q2". */
  endLabel: string;
  formatValue?: (value: number) => string;
  /** Formats the change in the tooltip. Defaults to the difference in formatValue's terms. */
  formatChange?: (change: number, item: SlopeItem) => string;
  /** Plot height in pixels. Defaults to 44 pixels per item. */
  height?: number;
  /** The item drawn in the accent, such as the one the story is about. */
  highlightId?: string | null;
  /** Controlled item in focus. The others fade while one is in focus. */
  activeId?: string | null;
  onActiveChange?: (key: string | null) => void;
  /** Rank movement beside each end value. */
  ranks?: boolean;
  emptyLabel?: string;
  ref?: Ref<HTMLElement>;
  className?: string;
  /** undefined uses the reference inspector; null explicitly suppresses it. */
  renderTooltip?: (context:SlopeTooltipContext) => ReactNode;
  /** Disable chart geometry motion without altering measurements. */
  motion?: boolean;
}


const { spring } = motionTokens;
const HEAD = 28;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });


/** Rank change arrow: up, down, or level. The number rolls in when it changes. */
function Rank({ move, reduced }: { move: number; reduced: boolean }) {
  const text = move === 0 ? "=" : `${Math.abs(move)}`;
  return <span className={styles.rank} data-move={move > 0 ? "up" : move < 0 ? "down" : "level"} aria-hidden="true">
    {move !== 0 && <svg width="8" height="8" viewBox="0 0 8 8"><path d={move > 0 ? "M4 7V1M1.5 3.5 4 1l2.5 2.5" : "M4 1v6M1.5 4.5 4 7l2.5-2.5"} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    <span className={styles.rankSwap}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={text} initial={reduced ? { opacity: 0 } : { opacity: 0, y: move >= 0 ? 6 : -6 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: move >= 0 ? -6 : 6 }} transition={reduced ? { duration: 0 } : spring.snappy}>{text}</motion.span>
      </AnimatePresence>
    </span>
  </span>;
}

export function SlopeChart({ data: dataInput, label, startLabel, endLabel, formatValue, formatChange, height, highlightId = null, activeId, onActiveChange, ranks = true, emptyLabel = "No data", ref, className, renderTooltip, motion: motionEnabled = true }: SlopeChartProps) {
  const data = useMemo(()=>buildSlopeModel(dataInput),[dataInput]);
  label=ownString(label,"Chart label");
  const figure = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => figure.current as HTMLElement);
  const { inView, reduced } = useArcChartEnvironment(figure, { motion: motionEnabled });
  const empty = data.length === 0;

  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = stage.current;
    if (!node) return;
    const read = () => setWidth(node.clientWidth);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const { rows, byEnd, x0, x1, narrow, plotHeight } = computeSlopeLayout(data,{width,height,ranks});

  const [ownActive, setOwnActive] = useState<string | null>(null);
  const wanted = activeId !== undefined ? activeId : ownActive;
  const active = wanted && data.some(item => item.id === wanted) ? wanted : null;
  useEffect(()=>{if(ownActive&&!data.some(item=>item.id===ownActive))setOwnActive(null);},[data,ownActive]);
  const setActive = (key: string | null) => { if (activeId === undefined) setOwnActive(key); if (key !== active) onActiveChange?.(key); };

  // The shared Tooltip owns placement; retain exact last content during exit.
  const activeRow = rows.find(row=>row.item.id===active)??null;
  const [shownKey,setShownKey]=useState<string|null>(null);
  if(active&&active!==shownKey)setShownKey(active);
  const tipRow=activeRow??rows.find(row=>row.item.id===shownKey)??null;

  // The line nearest the pointer, measured at the pointer's position along the plot.
  const nearest = (clientX: number, clientY: number) => {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect || empty) return null;
    const x = clamp(clientX - rect.left, x0, x1), y = clientY - rect.top - HEAD;
    const t = (x - x0) / Math.max(1, x1 - x0);
    let best: Row | null = null, distance = Infinity;
    for (const row of rows) {
      const inLine = Math.abs(row.y0 + (row.y1 - row.y0) * t - y);
      const onLabel = clientX - rect.left < x0 ? Math.abs(row.l0 - y) : clientX - rect.left > x1 ? Math.abs(row.l1 - y) : Infinity;
      const d = Math.min(inLine, onLabel);
      if (d < distance) { distance = d; best = row; }
    }
    return distance <= 22 ? best?.item.id ?? null : null;
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType === "mouse" || event.buttons) setActive(nearest(event.clientX, event.clientY)); };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (empty) return;
    if (event.key === "Escape" && active) { event.preventDefault(); setActive(null); return; }
    const at = activeRow ? activeRow.order : -1;
    const moves: Record<string, number> = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at < 0 ? 0 : at - 1, ArrowLeft: at < 0 ? 0 : at - 1, Home: 0, End: byEnd.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    setActive(byEnd[clamp(moves[event.key]!, 0, byEnd.length - 1)]!.item.id);
  };

  const format = (value: number) => formatValue ? formatValue(value) : grouped.format(value);
  const change = (item: SlopeItem) => formatChange ? formatChange(item.end - item.start, item) : `${item.end >= item.start ? "+" : "−"}${format(Math.abs(item.end - item.start))}`;
  const rankText = (row: Row) => row.rank0 === row.rank1 ? "same rank" : row.rank1 < row.rank0 ? `up ${row.rank0 - row.rank1} to rank ${row.rank1}` : `down ${row.rank1 - row.rank0} to rank ${row.rank1}`;
  const announce = activeRow ? `${activeRow.item.label}, ${startLabel} ${format(activeRow.item.start)}, ${endLabel} ${format(activeRow.item.end)}, ${change(activeRow.item)}, ${rankText(activeRow)}` : "";
  const summary = empty ? `${label}. ${emptyLabel}.` : `${label}, ${startLabel} to ${endLabel}. ${byEnd.map(row => `${row.item.label} ${format(row.item.start)} to ${format(row.item.end)}`).join(", ")}.`;
  const settle = reduced ? { duration: 0 } : spring.morph;
  const drawn = inView || reduced;

  const tooltipContext:SlopeTooltipContext|null = activeRow ? {item:activeRow.item,startLabel,endLabel,change:activeRow.item.end-activeRow.item.start,startRank:activeRow.rank0,endRank:activeRow.rank1,formatValue:format}:null;
  const defaultTooltip = <div><p className={styles.tipTitle}>{tipRow?.item.label ?? ""}</p>
        <p className={styles.tipRow}><span className={styles.tipName}>{startLabel}</span><span className={styles.tipValue}>{tipRow ? format(tipRow.item.start) : ""}</span></p>
        <p className={styles.tipRow}><span className={styles.tipName}>{endLabel}</span><span className={styles.tipValue}>{tipRow ? format(tipRow.item.end) : ""}</span></p>
        <p className={styles.tipMeta}>{tipRow ? `${change(tipRow.item)}, ${rankText(tipRow)}` : ""}</p></div>;
  const customTooltip=tooltipContext?renderTooltip?.(tooltipContext):undefined;
  const tooltipContent=customTooltip===undefined?defaultTooltip:customTooltip;

  return <figure ref={figure} data-zero-arc-chart="slope-chart" data-motion={reduced?"off":"on"} className={[styles.figure, className].filter(Boolean).join(" ")} aria-label={label}>
    <div ref={stage} className={styles.stage} data-narrow={narrow || undefined} data-active={active ? true : undefined}
      role="group" tabIndex={empty ? -1 : 0} aria-roledescription="slope chart" aria-label={`${label}. Use up and down arrows to move between items in ${endLabel} order.`}
      onPointerMove={onPointerMove} onPointerDown={event => { if (event.pointerType !== "mouse") { event.currentTarget.setPointerCapture?.(event.pointerId); setActive(nearest(event.clientX, event.clientY)); } }}
      onPointerUp={event => { if (event.pointerType !== "mouse") setActive(null); }} onPointerCancel={() => setActive(null)} onPointerLeave={event => { if (event.pointerType === "mouse") setActive(null); }}
      onKeyDown={onKeyDown} onBlur={() => setActive(null)} onFocus={event => { if (event.currentTarget.matches(":focus-visible") && !empty && !active) setActive(byEnd[0]!.item.id); }}>
      {width > 0 && <>
        <div className={styles.columns} aria-hidden="true">
          <span className={styles.column} style={{ left: x0, translate: "-50% 0" }}>{startLabel}</span>
          <span className={styles.column} style={{ left: x1, translate: "-50% 0" }}>{endLabel}</span>
        </div>
        <div className={styles.plot} style={{ height: plotHeight }}>
          <svg className={styles.svg} width={width} height={plotHeight} aria-hidden="true" focusable="false">
            <line className={styles.axis} x1={x0} x2={x0} y1={0} y2={plotHeight} />
            <line className={styles.axis} x1={x1} x2={x1} y1={0} y2={plotHeight} />
            {rows.map((row, i) => {
              const key = row.item.id, on = active === key, accent = highlightId === key;
              const delay = reduced ? 0 : i * .05;
              return <g key={key} className={styles.item} data-on={on || undefined} data-accent={accent || undefined} data-dim={(active !== null && !on) || undefined}>
                <motion.path className={styles.leader} initial={false} animate={{ d: `M${x0 - 6},${row.l0}L${x0 - 1},${row.y0}` }} transition={settle} />
                <motion.path className={styles.leader} initial={false} animate={{ d: `M${x1 + 6},${row.l1}L${x1 + 1},${row.y1}` }} transition={settle} />
                <motion.line className={styles.line} x1={x0} x2={x1} initial={reduced ? false : { y1: row.y0, y2: row.y1, pathLength: 0 }} animate={{ y1: row.y0, y2: row.y1, pathLength: drawn ? 1 : 0 }}
                  transition={{ y1: settle, y2: settle, pathLength: reduced ? { duration: 0 } : { duration: .7, ease: motionTokens.ease.inOut, delay: .1 + delay } }} />
                <motion.circle className={styles.dot} cx={x0} r={4} initial={reduced ? false : { cy: row.y0, scale: 0 }} animate={{ cy: row.y0, scale: drawn ? 1 : 0 }} transition={{ cy: settle, scale: reduced ? { duration: 0 } : { ...spring.snappy, delay } }} />
                <motion.circle className={styles.dot} cx={x1} r={4} initial={reduced ? false : { cy: row.y1, scale: 0 }} animate={{ cy: row.y1, scale: drawn ? 1 : 0 }} transition={{ cy: settle, scale: reduced ? { duration: 0 } : { ...spring.snappy, delay: .7 + delay } }} />
              </g>;
            })}
          </svg>
          {rows.map((row, i) => {
            const key = row.item.id, on = active === key, accent = highlightId === key;
            const delay = reduced ? 0 : i * .05;
            return <div key={key} className={styles.labels} data-on={on || undefined} data-accent={accent || undefined} data-dim={(active !== null && !on) || undefined} aria-hidden="true">
              <motion.span className={styles.start} style={{ right: width - x0 + 10, maxWidth: x0 - 10 }} initial={reduced ? false : { y: row.l0, opacity: 0 }} animate={{ y: row.l0, opacity: drawn ? 1 : 0 }} transition={{ y: settle, opacity: { duration: .3, delay } }}>
                <span className={styles.name}>{row.item.label}</span>
                <span className={styles.value}>{format(row.item.start)}</span>
              </motion.span>
              <motion.span className={styles.end} style={{ left: x1 + 10 }} initial={reduced ? false : { y: row.l1, opacity: 0 }} animate={{ y: row.l1, opacity: drawn ? 1 : 0 }} transition={{ y: settle, opacity: { duration: .3, delay: .7 + delay } }}>
                <span className={styles.value}>{format(row.item.end)}</span>
                {ranks && <Rank move={row.rank0 - row.rank1} reduced={reduced} />}
              </motion.span>
            </div>;
          })}
        </div>
      </>}
      <ArcDistributionInspector open={width>0&&!!activeRow} point={[(x0+x1)/2,HEAD+(activeRow?(activeRow.y0+activeRow.y1)/2:0)]} content={tooltipContent} className={styles.tooltip} plot={stage.current} onDismiss={()=>setActive(null)} />
      {empty && <p className={styles.message}>{emptyLabel}</p>}
    </div>
    <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{announce}</p>
    <p className={styles.srOnly}>{summary}</p>
    {!empty && <div className={styles.srOnly}><table>
      <caption>{label}</caption>
      <thead><tr><th scope="col">Item</th><th scope="col">{startLabel}</th><th scope="col">{endLabel}</th><th scope="col">Change</th><th scope="col">Rank</th></tr></thead>
      <tbody>{byEnd.map(row => <tr key={row.item.id}><th scope="row">{row.item.label}</th><td>{format(row.item.start)}</td><td>{format(row.item.end)}</td><td>{change(row.item)}</td><td>{row.rank0} to {row.rank1}</td></tr>)}</tbody>
    </table></div>}
  </figure>;
}

export default SlopeChart;
