"use client";

/** Treemap chart organism, adapted from Arc Free (MIT), copyright 2026 Elia Kuratli.
 * Owns browser rendering and interaction; consumes validated detached analytical inputs.
 * Source: https://uiarc.dev/components/treemap. No transport or database authority lives here.
 */


import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import { AnimatePresence, animate, motion } from "motion/react";
import { motionTokens } from "../shared/motion-tokens";
import { useArcChartEnvironment } from "../shared/use-arc-chart-environment";
import { optionNumber, ownArray, ownNumber, ownString, ARC_DISTRIBUTION_LIMITS } from "../streamgraph/distribution-admission";
import styles from "./treemap-classes";
import { ArcDistributionInspector } from "../streamgraph/arc-distribution-inspector";
import type { ReactNode } from "react";

import { buildTreemapModel, computeTreemapLayout as layoutFrom, carryTreemapRect as carry, normalizeTreemapFocus } from "./treemap-model";
import type { TreemapNode, TreemapRect as Rect, TreemapFlat as Flat, TreemapDrawn as Drawn } from "./treemap-model";
export type { TreemapNode } from "./treemap-model";
/** Use a treemap for a hierarchy of parts, such as revenue by region, country, and plan, when sizes matter more than exact comparisons. */
export interface TreemapTooltipContext { node:Flat;parent:Flat;share:number|null;focus:Flat;formatValue:(value:number)=>string; }

export interface TreemapProps {
  /** The root. Its label names the whole in the first breadcrumb. */
  data: TreemapNode;
  /** What the whole is, such as "Revenue". Names the chart for assistive technology. */
  label: string;
  formatValue?: (value: number) => string;
  /** Names the shading measure in the tooltip and scale, such as "Growth". Tiles take the hue of their top level branch and grow deeper with the measure. Leave it out to draw every tile at one depth. */
  colorLabel?: string;
  formatColor?: (value: number) => string;
  /** Range of the color measure. Defaults to the range of the leaves. */
  colorDomain?: readonly [number, number];
  /** Controlled id of the node that fills the view. */
  focusId?: string;
  defaultFocusId?: string;
  onFocusChange?: (id: string) => void;
  /** Height of the tiles in pixels. */
  height?: number;
  emptyLabel?: string;
  ref?: Ref<HTMLElement>;
  className?: string;
  /** undefined uses the reference inspector; null explicitly suppresses it. */
  renderTooltip?: (context:TreemapTooltipContext) => ReactNode;
  /** Disable chart geometry motion without altering measurements. */
  motion?: boolean;
}

const { spring, ease, blur, duration } = motionTokens;
const physical = ({ visualDuration, bounce }: { visualDuration: number; bounce: number }, restDelta = .0005) => { const root = (2 * Math.PI) / (visualDuration * 1.2); return { type: "spring" as const, stiffness: root * root, damping: 2 * (1 - bounce) * root, restDelta, restSpeed: restDelta * 2 }; };
const zoom = physical({ visualDuration: .62, bounce: .06 });
const reveal = physical({ visualDuration: .9, bounce: 0 });
/** Top level branches take the four series hues in order; a fifth and beyond stay neutral rather than reuse a hue. */
const hueOf = (index: number) => index < 0 ? "var(--zero-arc-series-1, var(--zero-chart-blue))" : index < 4 ? `var(--zero-arc-series-${index + 1}, var(--zero-chart-${["blue","purple","amber","teal"][index]}))` : "var(--zero-arc-foreground, var(--zero-chart-foreground, var(--foreground)))";
const STEPS = 5;
const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;


export function Treemap({ data, label, formatValue = value => grouped.format(value), colorLabel, formatColor = value => grouped.format(value), colorDomain, focusId, defaultFocusId, onFocusChange, height = 420, emptyLabel = "No data yet", ref, className, renderTooltip, motion: motionEnabled = true }: TreemapProps) {
  height=optionNumber(height,420,40,4096,"Treemap height");
  label=ownString(label,"Chart label");
  const figure = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const tiles = useRef(new Map<string, HTMLDivElement>());
  useImperativeHandle(ref, () => figure.current as HTMLElement);
  const { inView, reduced } = useArcChartEnvironment(figure, { motion: motionEnabled });

  const flat = useMemo(() => buildTreemapModel(data), [data]);
  const root = normalizeTreemapFocus(flat,undefined);
  const nodes = useMemo(() => [...flat.values()].filter(node => node.depth > 0), [flat]);
  const [ownFocus, setOwnFocus] = useState(defaultFocusId ?? root.id);
  const center = normalizeTreemapFocus(flat,focusId ?? ownFocus);
  const zoomTo = (id: string) => { if (focusId === undefined) setOwnFocus(id); onFocusChange?.(id); };
  const [active, setActive] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = stage.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);
  const view = useMemo<Rect>(() => ({ x: 0, y: 0, w: width, h: height }), [width, height]);
  const target = useMemo(() => layoutFrom(flat, center.id, view), [flat, center.id, view]);
  const levelOf = (node: Flat) => node.depth - center.depth;

  // Color scale: a few neutral steps from light to dark, so shade reads as more without adding a hue.
  const leaves = nodes.filter(node => !node.children.length && node.color !== null);
  const admittedDomain=colorDomain?ownArray(colorDomain,2,"Treemap color domain").map(v=>ownNumber(v,"Treemap color boundary")):undefined;
  if(admittedDomain&&(admittedDomain.length!==2||admittedDomain[0]!>admittedDomain[1]!))throw new TypeError("Treemap color domain must be ordered finite values");
  const [lo, hi] = admittedDomain ?? (leaves.length ? [Math.min(...leaves.map(node => node.color!)), Math.max(...leaves.map(node => node.color!))] : [0, 1]);
  const colored = colorLabel !== undefined && leaves.length > 0;
  const shade = (value: number | null) => { if (!colored || value === null) return 34; const t = clamp((value - lo) / (hi - lo || 1), 0, 1); return Math.round(14 + Math.round(t * (STEPS - 1)) / (STEPS - 1) * 44); };
  const branchOf = useMemo(() => { const map = new Map<string, number>(); root.children.forEach((id, index) => { const walk = (at: string) => { map.set(at, index); flat.get(at)?.children.forEach(walk); }; walk(id); }); return map; }, [flat, root]);

  // Every tile keeps its on screen rect; a spring carries it to the new layout. Tiles entering or leaving ride the same zoom as the tile they belong to.
  const drawn = useRef(new Map<string, Drawn>());
  const levels = useRef(new Map<string, number>());
  const lastFocus = useRef<{ id: string; layout: Map<string, Rect> } | null>(null);
  const paint = () => {
    for (const node of nodes) {
      const el = tiles.current.get(node.id), d = drawn.current.get(node.id);
      if (!el) continue;
      if (!d || d.o < .01 || d.w < .5 || d.h < .5) { el.style.visibility = "hidden"; el.style.pointerEvents = "none"; continue; }
      el.style.visibility = "visible";
      el.style.transform = `translate3d(${d.x.toFixed(2)}px, ${d.y.toFixed(2)}px, 0)`;
      el.style.width = `${d.w.toFixed(2)}px`; el.style.height = `${d.h.toFixed(2)}px`;
      el.style.opacity = d.o.toFixed(3);
      el.style.pointerEvents = d.o > .6 ? "auto" : "none";
      const level = levels.current.get(node.id) ?? 0;
      el.dataset.level = String(level);
      el.dataset.room = d.w > 64 && d.h > 38 ? (d.h > 54 ? "full" : "name") : "none";
    }
  };
  const paintRef = useRef(paint);
  useLayoutEffect(() => { paintRef.current = paint; });

  const shown = (inView || reduced) && width > 0;
  useEffect(() => {
    if (!shown) return;
    const prev = lastFocus.current;
    const isUnder = (id: string, ancestor: string) => { for (let at: Flat | undefined = flat.get(id); at; at = at.parent ? flat.get(at.parent) : undefined) if (at.id === ancestor) return true; return false; };
    const visible = (node: Flat) => { const l = node.depth - center.depth; return l >= 1 && l <= 2 && isUnder(node.id, center.id); };
    const nextVisible = new Set(nodes.filter(visible).map(node => node.id));
    const before = new Map(drawn.current);
    const wasVisible = new Set([...before].filter(([, d]) => d.o > .5).map(([id]) => id));
    // The pivot: the tile that grows to fill the view, or the view that shrinks back into its tile.
    let toOld: ((r: Rect) => Rect) | null = null, toNew: ((r: Rect) => Rect) | null = null;
    if (prev && prev.id !== center.id && before.size) {
      if (isUnder(center.id, prev.id)) { const inOld = prev.layout.get(center.id); if (inOld) { toOld = r => carry(r, view, inOld); toNew = r => carry(r, inOld, view); } }
      else if (isUnder(prev.id, center.id)) { const inNew = target.get(prev.id); if (inNew) { toOld = r => carry(r, inNew, view); toNew = r => carry(r, view, inNew); } }
    }
    const from = new Map<string, Drawn>(), to = new Map<string, Drawn>();
    const first = !before.size;
    for (const node of nodes) {
      const goal = target.get(node.id), now = before.get(node.id);
      const inNext = nextVisible.has(node.id), inPrev = wasVisible.has(node.id);
      if (inNext && goal) {
        to.set(node.id, { ...goal, o: 1 });
        if (inPrev && now) from.set(node.id, now);
        else if (first) from.set(node.id, { x: goal.x + goal.w / 2, y: goal.y + goal.h / 2, w: 0, h: 0, o: 0 });
        else from.set(node.id, { ...(toOld ? toOld(goal) : goal), o: 0 });
        levels.current.set(node.id, levelOf(node));
      } else if (inPrev && now) {
        from.set(node.id, now);
        to.set(node.id, { ...(toNew ? toNew(now) : now), o: 0 });
      }
    }
    for (const node of nodes) if (!from.has(node.id)) drawn.current.set(node.id, { x: 0, y: 0, w: 0, h: 0, o: 0 });
    lastFocus.current = { id: center.id, layout: target };
    const finish = () => { for (const [id, d] of to) drawn.current.set(id, d); paintRef.current(); };
    if (reduced) { finish(); return; }
    const controls = animate(0, 1, { ...(first ? reveal : zoom), onUpdate: t => {
      for (const [id, a] of from) {
        const b = to.get(id)!;
        // On the first reveal, tiles grow in a quick wave from the largest.
        const local = first ? clamp((t - Math.min(.3, (1 - b.w * b.h / (view.w * view.h || 1)) * .3)) / .7, 0, 1) : t;
        drawn.current.set(id, { x: mix(a.x, b.x, local), y: mix(a.y, b.y, local), w: mix(a.w, b.w, local), h: mix(a.h, b.h, local), o: mix(a.o, b.o, local) });
      }
      paintRef.current();
    }, onComplete: finish });
    return () => controls.stop();
  }, [shown, target, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { paintRef.current(); });

  const candidateNode = active ? flat.get(active) ?? null : null;
  const activeNode = candidateNode && target.has(candidateNode.id) && candidateNode.depth > center.depth && candidateNode.depth-center.depth <=2 ? candidateNode : null;
  useEffect(()=>{if(active&&!activeNode)setActive(null);if(!flat.get(ownFocus)?.children.length)setOwnFocus(root.id);},[flat,activeNode,active,ownFocus,root.id]);
  const parentOf = (node: Flat) => node.parent ? flat.get(node.parent)! : node;
  const share = (node: Flat, of: Flat) => of.value ? node.value / of.value : 0;

  // Shared Tooltip owns chart-local inspection positioning and portal elevation.

  // Keyboard: arrows hop to the nearest tile in that direction on the top level, Enter zooms in, Escape zooms out.
  const topTiles = center.children.map(id => flat.get(id)!).filter(node => node.value > 0);
  const topOf = (node: Flat | null) => { let at = node; while (at && at.parent && at.parent !== center.id) at = flat.get(at.parent) ?? null; return at && at.parent === center.id ? at : null; };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = topOf(activeNode);
    const dirs: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
    if (event.key in dirs) {
      event.preventDefault(); setPointer(null);
      if (!current) { setActive(topTiles[0]?.id ?? null); return; }
      const [dx, dy] = dirs[event.key]!, o = target.get(current.id)!, ox = o.x + o.w / 2, oy = o.y + o.h / 2;
      let best: Flat | null = null, score = Infinity;
      for (const node of topTiles) { if (node.id === current.id) continue; const r = target.get(node.id); if (!r) continue; const vx = r.x + r.w / 2 - ox, vy = r.y + r.h / 2 - oy, along = vx * dx + vy * dy, across = Math.abs(vx * dy - vy * dx); if (along <= 1) continue; const s = along + across * 1.5; if (s < score) { score = s; best = node; } }
      if (best) setActive(best.id);
    } else if (event.key === "Home" || event.key === "End") { event.preventDefault(); setPointer(null); setActive((event.key === "Home" ? topTiles[0] : topTiles[topTiles.length - 1])?.id ?? null); }
    else if (event.key === "Enter" || event.key === " ") { if (current?.children.length) { event.preventDefault(); zoomTo(current.id); setActive(current.children[0]!); } }
    else if (event.key === "Escape" || event.key === "Backspace") { if (center.parent) { event.preventDefault(); zoomTo(center.parent); setActive(center.id); } else if (active) { event.preventDefault(); setActive(null); } }
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>, id: string) => {
    if (event.pointerType !== "mouse") return;
    const rect = stage.current?.getBoundingClientRect();
    if (rect) setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    setActive(id);
  };
  const onTileClick = (node: Flat) => { const top = topOf(node); if (top?.children.length) zoomTo(top.id); else if (!activeNode || activeNode.id !== node.id) setActive(node.id); };

  const trail: Flat[] = [];
  for (let at: Flat | undefined = center; at; at = at.parent ? flat.get(at.parent) : undefined) trail.unshift(at);
  const empty = !root.value;
  const describe = (node: Flat) => `${node.path.join(", ")}, ${formatValue(node.value)}, ${percent.format(share(node, parentOf(node)))} of ${parentOf(node).label}${colored && node.color !== null ? `, ${colorLabel} ${formatColor(node.color)}` : ""}`;
  const focusTop = topOf(activeNode);

  const tooltipContext:TreemapTooltipContext|null = activeNode ? {node:activeNode,parent:parentOf(activeNode),share:parentOf(activeNode).value?activeNode.value/parentOf(activeNode).value:null,focus:center,formatValue}:null;
  const defaultTooltip = <div>{activeNode && <>
          <p className={styles.tipTitle}>{activeNode.path.slice(0, -1).join(" / ") || root.label}</p>
          <p className={styles.tipValue}><span className={styles.tipName}>{activeNode.label}</span><span className={styles.tipAmount}>{formatValue(activeNode.value)}</span></p>
          <p className={styles.tipNote}>{percent.format(share(activeNode, parentOf(activeNode)))} of {parentOf(activeNode).label}</p>
          {colored && activeNode.color !== null && <p className={styles.tipNote}>{colorLabel} {formatColor(activeNode.color)}</p>}
        </>}</div>;
  const customTooltip=tooltipContext?renderTooltip?.(tooltipContext):undefined;
  const tooltipContent=customTooltip===undefined?defaultTooltip:customTooltip;

  return <figure ref={figure} data-zero-arc-chart="treemap" data-motion={reduced?"off":"on"} className={[styles.figure, className].filter(Boolean).join(" ")} aria-label={label}>
    <div className={styles.bar}>
      <nav className={styles.crumbs} aria-label={`${label} path`}>
        <ol className={styles.crumbList}>
          <AnimatePresence initial={false} mode="popLayout">
            {trail.map((node, index) => <motion.li key={node.id} className={styles.crumb} layout={reduced ? false : "position"} initial={{ opacity: 0, x: reduced ? 0 : -6, filter: reduced ? "none" : `blur(${blur.subtle}px)` }} animate={{ opacity: 1, x: 0, filter: "blur(0px)" }} exit={{ opacity: 0, x: reduced ? 0 : -6, transition: { duration: duration.instant, ease: [...ease.exit] } }} transition={{ ...spring.smooth }}>
              {index > 0 && <span className={styles.crumbSep} aria-hidden="true">/</span>}
              {index < trail.length - 1 ? <button type="button" className={styles.crumbButton} onClick={() => { zoomTo(node.id); setActive(null); }}>{node.label}</button> : <span className={styles.crumbCurrent} aria-current="location">{node.label}</span>}
            </motion.li>)}
          </AnimatePresence>
        </ol>
      </nav>
      <p className={styles.total}><AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={formatValue(center.value)} className={styles.totalValue} initial={{ opacity: 0, y: reduced ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -6 }} transition={{ duration: duration.standard, ease: [...ease.enter] }}>{formatValue(center.value)}</motion.span>
      </AnimatePresence></p>
    </div>
    <div ref={stage} className={styles.stage} style={{ height }} data-active={activeNode ? true : undefined} role="group" tabIndex={empty ? -1 : 0} aria-roledescription="treemap"
      aria-label={`${label}, ${center.label}. Arrow keys move between tiles, Enter zooms in, Escape zooms out.`}
      onKeyDown={onKeyDown} onBlur={() => setActive(null)} onPointerLeave={() => { setActive(null); setPointer(null); }}>
      {nodes.map(node => { const top = topOf(node); return <div key={node.id} ref={element => { if (element) tiles.current.set(node.id, element); else tiles.current.delete(node.id); }} className={styles.tile}
        data-branch={node.children.length > 0 || undefined} data-active={active === node.id || undefined} data-lineage={focusTop?.id === node.id && active !== node.id || undefined} data-dim={focusTop !== null && top !== null && focusTop.id !== top.id || undefined}
        style={{ "--hue": hueOf(branchOf.get(node.id) ?? -1), "--fill": `color-mix(in oklab, ${hueOf(branchOf.get(node.id) ?? -1)} ${shade(node.color)}%, var(--zero-arc-surface, var(--zero-chart-surface, var(--card))))`, zIndex: node.depth } as CSSProperties}
        onPointerMove={event => { event.stopPropagation(); onPointerMove(event, node.id); }} onClick={event => { event.stopPropagation(); onTileClick(node); }}>
        <span className={styles.tileLabel}>{node.label}</span>
        <span className={styles.tileValue}>{formatValue(node.value)}</span>
      </div>; })}
      {empty && <p className={styles.message}>{emptyLabel}</p>}
      <ArcDistributionInspector open={width>0&&!!activeNode} point={[pointer?.x??(activeNode?(target.get(activeNode.id)?.x??0)+(target.get(activeNode.id)?.w??0)/2:0),pointer?.y??(activeNode?(target.get(activeNode.id)?.y??0)+Math.min((target.get(activeNode.id)?.h??0)/2,28):0)]} content={tooltipContent} className={styles.tooltip} plot={stage.current} side="right" onDismiss={()=>setActive(null)} />
    </div>
    {colored && <div className={styles.scale} aria-hidden="true">
      <span className={styles.scaleLabel}>{colorLabel}</span>
      <span className={styles.scaleEnd}>{formatColor(lo)}</span>
      <span className={styles.steps}>{Array.from({ length: STEPS }, (_, i) => <span key={i} className={styles.step} style={{ "--fill": `color-mix(in oklab, ${center.depth === 0 ? "var(--zero-arc-foreground, var(--zero-chart-foreground, var(--foreground)))" : hueOf(branchOf.get(center.id) ?? -1)} ${Math.round(14 + (i / (STEPS - 1)) * 44)}%, var(--zero-arc-surface, var(--zero-chart-surface, var(--card))))` } as CSSProperties} />)}</span>
      <span className={styles.scaleEnd}>{formatColor(hi)}</span>
    </div>}
    <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{activeNode ? describe(activeNode) : `${center.label}, ${formatValue(center.value)}`}</p>
    {!empty && <div className={styles.srOnly}><table>
      <caption>{label}</caption>
      <thead><tr><th scope="col">Path</th><th scope="col">Value</th><th scope="col">Share of parent</th>{colored && <th scope="col">{colorLabel}</th>}</tr></thead>
      <tbody>{nodes.map(node => <tr key={node.id}><th scope="row">{node.path.join(" / ")}</th><td>{formatValue(node.value)}</td><td>{percent.format(share(node, parentOf(node)))}</td>{colored && <td>{node.color === null ? "" : formatColor(node.color)}</td>}</tr>)}</tbody>
    </table></div>}
  </figure>;
}

export default Treemap;
