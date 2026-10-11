"use client";

/**
 * Arc-derived chart renderer. UI/presentation only; consumes admitted detached data,
 * Zero motion/tokens, and React/Motion. Does not perform transport or persistence.
 * Adapted from Arc UI (https://uiarc.dev), MIT, Copyright (c) 2026 Elia Kuratli.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useTransform, type Variants } from "motion/react";
import { motionTokens } from "../shared/motion-tokens";
import { useArcChartEnvironment } from "../shared/use-arc-chart-environment";
import styles from "./sparkline-classes";
import { buildSparklineModel, computeSparklineCurve as curveFor, sparklineHeightAt as heightAt, computeSparklineGeometry as geometryOf, sparklineTipAt as tipAt, type Point } from "./sparkline-model";
import { chartDimension,chartLabel,chartText,chartFlag,chartSelector,CARTESIAN_LIMITS } from "../line-chart/cartesian-admission";
import { useCartesianSelection } from '../line-chart/cartesian-selection';
const cap=1.25;
const grid=Array.from({length:161},(_,index)=>index/160);

export interface SparklineProps {
  /** Disable all presentation motion; never changes the measured data. */
  motion?: boolean;
  data: readonly number[];
  label: string;
  value?: string;
  change?: string;
  tone?: "accent" | "success" | "warning" | "danger";
  width?: number;
  height?: number;
  /** One label per point, such as a date. It replaces the change while that point is scrubbed. */
  labels?: readonly string[];
  /** Formats a scrubbed point for the headline. Defaults to a grouped number. */
  formatValue?: (value: number, index: number) => string;
  /** A quiet neutral fill under the line. */
  area?: boolean;
  /** Pointer and keyboard scrubbing through the points. */
  interactive?: boolean;
  /** Numeric arrays have intrinsic index identity. Retired indexes are masked. */
  activeIndex?: number | null;
  defaultActiveIndex?: number | null;
  onActiveChange?: (index:number|null,value:number|null)=>void;
  className?: string;
}

/** Copy that holds a number enters from the side it moved toward: a larger value rises from below, a smaller one drops from above. */
const rise: Variants = { hidden: (direction: number) => ({ opacity: 0, y: `${.3 * direction}em`, filter: `blur(${motionTokens.blur.soft}px)` }), shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] } }, gone: (direction: number) => ({ opacity: 0, y: `${-.3 * direction}em`, filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } }) };
const fade: Variants = { hidden: { opacity: 1, y: 0, filter: "blur(0px)" }, shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0 } }, gone: { opacity: 0, y: 0, filter: "blur(0px)", transition: { duration: 0 } } };
const amountIn = (text: string) => Number(text.replace(/,/g, "").replace(/−/g, "-").match(/-?\d+(?:\.\d+)?/)?.[0] ?? NaN);
const grouped = new Intl.NumberFormat("en-US");
/** The first draw: one smooth stroke, slow at both ends like a pen. */
const draw = { duration: motionTokens.duration.considered * 1.75, ease: [...motionTokens.ease.inOut] } as const;
const quick = { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } as const;

type Chunk = { slot: string; key: string; text: string };
/** A number keeps its unchanged digits still, keyed by place from the right. Words key on everything up to them, so only the first changed word and what follows it roll. */
function chunksOf(text: string, whole: boolean): Chunk[] {
  if (!text) return [];
  if (whole) return [{ slot: "all", key: text, text }];
  if (!/\p{L}/u.test(text)) return [...text].map((char, index, all) => ({ slot: `n${all.length - index}`, key: char, text: char }));
  const words = text.split(/(?<=\s)/);
  return words.map((word, index) => ({ slot: `w${index}`, key: words.slice(0, index + 1).join(""), text: word }));
}

/** Text that changes rolls in place, like a numeric content transition; `morph` springs the wrapper to the new width so nothing beside it jumps. */
function Roll({ text, direction, whole = false, morph = false, tone, reduced }: { text: string; direction?: number; whole?: boolean; morph?: boolean; tone?: string; reduced:boolean }) {
  const reduceMotion=reduced;
  const sizer = useRef<HTMLSpanElement>(null);
  const width = useMotionValue<number | "auto">("auto");
  const [shown, setShown] = useState({ text, direction: 1 });
  if (shown.text !== text) setShown({ text, direction: direction ?? (amountIn(text) < amountIn(shown.text) ? -1 : 1) });
  useEffect(() => {
    const node = sizer.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let measured: string | null = null;
    let resizing:{stop:()=>void}|undefined;
    // Layout size, not the transformed rect, so a scaling parent never leaves the text clipped. Only a new text springs; font loads jump.
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = entry.borderBoxSize?.[0]?.inlineSize ?? node.offsetWidth;
      resizing?.stop();
      if (measured !== null && measured !== node.textContent && !reduceMotion) resizing=animate(width, next, motionTokens.spring.morph);
      else width.jump(next);
      measured = node.textContent;
    });
    observer.observe(node);
    return () => {observer.disconnect();resizing?.stop();};
  }, [morph, reduceMotion, width]);
  const numeric = !whole && !/\p{L}/u.test(text);
  const variants = reduceMotion ? fade : rise;
  const anchor = numeric ? "right" : "left";
  return <motion.span className={styles.roll} data-end={numeric || undefined} data-whole={whole || undefined} style={morph ? { width } : undefined}>
    {morph && <span ref={sizer} className={styles.sizer} aria-hidden="true">{text}</span>}
    {/* One flex item holds the pieces, so they stay inline and the text reads and copies as one string. */}
    <span className={styles.track}><AnimatePresence mode="popLayout" initial={false} custom={shown.direction} anchorX={anchor}>
      {chunksOf(text, whole).map(chunk => <motion.span key={chunk.slot} className={styles.slot} custom={shown.direction} variants={variants} initial="hidden" animate="shown" exit="gone">
        <AnimatePresence mode="popLayout" initial={false} custom={shown.direction} anchorX={anchor}>
          <motion.span key={`${tone ?? ""}${chunk.key}`} className={tone ? `${styles.glyph} ${tone}` : styles.glyph} custom={shown.direction} variants={variants} initial="hidden" animate="shown" exit="gone">{chunk.text}</motion.span>
        </AnimatePresence>
      </motion.span>)}
    </AnimatePresence></span>
  </motion.span>;
}

function SparklineRenderer({ motion:motionEnabled, data, label, value, change, tone = "accent", width = 160, height = 52, labels, formatValue, area = true, interactive = true,activeIndex,defaultActiveIndex,onActiveChange,className }: SparklineProps) {
  const safeData = data;
  const empty = data.length === 0;
  const last = safeData.length - 1;
  const key = safeData.join(",");
  const target = useMemo(() => curveFor(safeData), [key]);
  const description = empty ? `${label}. No data.` : `${label}: ${value ?? safeData[last]}. ${change ?? ""}`.trim();
  const uid = `sparkline${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const ref = useRef<HTMLElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const environment=useArcChartEnvironment(ref,{motion:motionEnabled});
  const inView=environment.inView;
  const reduceMotion=environment.reduced;
  const [box, setBox] = useState({ w: width, h: height });
  const [active,setActive]=useCartesianSelection(data,(_,index)=>String(index),activeIndex===undefined?undefined:activeIndex===null?null:String(activeIndex),defaultActiveIndex==null?null:String(defaultActiveIndex),onActiveChange);
  const [landed, setLanded] = useState(false);
  const index = active === null || empty ? null : Math.min(active, last);
  const [moved, setMoved] = useState({ index, direction: 1 });
  if (moved.index !== index) setMoved({ index, direction: index === null || moved.index === null ? 1 : Math.sign(index - moved.index) || 1 });

  const [first] = useState(() => geometryOf(target, width, height, 1));
  const shape = useRef(target);
  const size = useRef(box);
  const drawn = useMotionValue(0), cursor = useMotionValue(1);
  const line = useMotionValue(first.line), trail = useMotionValue(first.trail), fill = useMotionValue(first.fill), dot = useMotionValue(first.dot);
  const cursorX = useMotionValue(first.cx), lit = useMotionValue(first.cx + cap + 16), dim = useMotionValue(first.cx + cap), reveal = useMotionValue(0);
  const lineOpacity = useTransform(drawn, progress => progress > .001 ? 1 : 0);

  // One writer for every drawn attribute: the morphing shape, the cursor, the pen and the measured size all repaint through here.
  const paint = useCallback(() => {
    const { w, h } = size.current, progress = drawn.get();
    const next = geometryOf(shape.current, w, h, cursor.get());
    line.set(next.line); trail.set(next.trail); fill.set(next.fill); dot.set(next.dot);
    cursorX.set(next.cx); lit.set(next.cx + cap + 16); dim.set(next.cx + cap);
    reveal.set(progress >= 1 ? w + 32 : tipAt(next.points, progress) + 16);
  }, [cursor, cursorX, dim, dot, drawn, fill, line, lit, reveal, trail]);
  useMotionValueEvent(cursor, "change", paint);
  useMotionValueEvent(drawn, "change", paint);

  // The chart draws in its own pixels: measure the width, keep the height in proportion.
  useLayoutEffect(() => {
    const node = plot.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { const w = node.clientWidth; if (w) setBox(current => Math.abs(current.w - w) < .5 ? current : { w, h: (w * height) / width }); });
    observer.observe(node);
    return () => observer.disconnect();
  }, [height, width]);
  useLayoutEffect(() => { size.current = box; paint(); }, [box, paint]);

  // The line draws left to right once it is seen, the fill follows the pen, then the end dot lands.
  useEffect(() => {
    if (empty) { drawn.jump(0); setLanded(false); return; }
    if (!inView) return;
    // Reduced motion shows the finished line at once; the dot lands a frame later, after hydration has matched the server.
    if (reduceMotion) { drawn.jump(1); const frame = requestAnimationFrame(() => setLanded(true)); return () => cancelAnimationFrame(frame); }
    if (!inView) return;
    const controls = animate(drawn, 1, { ...draw, onComplete: () => setLanded(true) });
    return () => controls.stop();
  }, [drawn, empty, inView, reduceMotion]);

  // New data morphs the line from the shape on screen, sampled on shared x positions so a series that gains or loses points still flows.
  useEffect(() => {
    const from = shape.current;
    if (from === target) return;
    if (reduceMotion) { shape.current = target; paint(); return; }
    const xs = [...new Set([...grid, ...target.map(([x]) => x)])].sort((a, b) => a - b);
    const start = xs.map(x => heightAt(from, x)), goal = xs.map(x => heightAt(target, x));
    const controls = animate(0, 1, { ...motionTokens.spring.smooth, onUpdate: progress => { shape.current = xs.map((x, at): Point => [x, start[at]! + (goal[at]! - start[at]!) * progress]); paint(); }, onComplete: () => { shape.current = target; paint(); } });
    return () => controls.stop();
  }, [paint, reduceMotion, target]);

  // The cursor springs to the scrubbed point and rides the line between points; leaving sends it home to the latest value.
  useEffect(() => {
    const to = index === null ? 1 : last > 0 ? index / last : .5;
    if (reduceMotion) { cursor.jump(to); return; }
    const controls = animate(cursor, to, motionTokens.spring.snappy);
    return () => controls.stop();
  }, [cursor, index, last, reduceMotion]);

  const scrubbing = index !== null;
  const format = (at: number) => empty ? '—' : formatValue ? formatValue(safeData[at]!, at) : grouped.format(safeData[at]!);
  const point = format(index ?? last), when = labels?.[index ?? last];
  const headline = value === undefined ? undefined : scrubbing ? point : value;
  const aside = index === null ? change ?? "" : value === undefined ? [point, when].filter(Boolean).join(" · ") : when ?? `${index + 1} of ${last + 1}`;
  const pointAt = (clientX: number) => { const rect = plot.current?.getBoundingClientRect(); return rect?.width ? Math.max(0, Math.min(last, Math.round(((clientX - rect.left) / rect.width) * last))) : last; };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (empty) return;
    if (event.key === "Escape" && scrubbing) { event.preventDefault(); setActive(null); return; }
    const from = index ?? last, page = Math.max(1, Math.round((last + 1) / 6));
    const next = ({ ArrowLeft: from - 1, ArrowDown: from - 1, ArrowRight: from + 1, ArrowUp: from + 1, PageDown: from - page, PageUp: from + page, Home: 0, End: last } as Record<string, number>)[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(Math.max(0, Math.min(last, next)));
  };
  const scrub = interactive && !empty ? {
    role: "slider", tabIndex: 0, "aria-label": `${label}, explore values`, "aria-valuemin": 1, "aria-valuemax": last + 1, "aria-valuenow": (index ?? last) + 1, "aria-valuetext": `${when ?? (index === null ? "Latest" : `Point ${index + 1} of ${last + 1}`)}: ${point}`,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => setActive(pointAt(event.clientX)),
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType === "mouse" || event.buttons) setActive(pointAt(event.clientX)); },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType !== "mouse") setActive(null); },
    onPointerLeave: () => setActive(null), onPointerCancel: () => setActive(null), onBlur: () => setActive(null), onKeyDown,
  } : {};
  return <figure data-motion={reduceMotion?'off':undefined} data-zero-arc-chart="sparkline" ref={ref} className={[styles.figure,className].filter(Boolean).join(' ')} aria-label={description}>
    <figcaption className={styles.caption}>
      <span className={styles.label}><Roll reduced={reduceMotion} text={label} whole /></span>
      {headline !== undefined && <strong><Roll reduced={reduceMotion} text={headline} morph /></strong>}
      <small className={styles[tone]}><Roll reduced={reduceMotion} text={aside} direction={scrubbing ? moved.direction : undefined} tone={scrubbing ? styles.point : undefined} morph /></small>
    </figcaption>
    <div ref={plot} className={styles.plot} data-interactive={interactive || undefined} {...scrub}>
      <svg className={styles.chart} viewBox={`0 0 ${box.w} ${box.h}`} aria-hidden="true" focusable="false">
        <defs>
          <clipPath id={`${uid}-lit`} clipPathUnits="userSpaceOnUse"><motion.rect x={-16} y={-16} width={lit} height={box.h + 32} /></clipPath>
          <clipPath id={`${uid}-dim`} clipPathUnits="userSpaceOnUse"><motion.rect x={dim} y={-16} width={box.w + 32} height={box.h + 32} /></clipPath>
          <clipPath id={`${uid}-fill`} clipPathUnits="userSpaceOnUse"><motion.rect x={-16} y={-16} width={reveal} height={box.h + 32} /></clipPath>
        </defs>
        {area && <motion.path className={`${styles.area} ${styles[tone]}`} d={fill} clipPath={`url(#${uid}-fill)`} />}
        <line className={styles.baseline} x1="0" y1={box.h - .5} x2={box.w} y2={box.h - .5} />
        {/* While scrubbing, the stretch after the cursor dims, as if the later points have not happened yet. */}
        <motion.path className={styles.trail} d={trail} clipPath={`url(#${uid}-dim)`} initial={false} animate={{ opacity: scrubbing && landed ? 1 : 0 }} transition={reduceMotion ? { duration: 0 } : quick} />
        <motion.polyline className={[styles.line, styles[tone]].join(" ")} points={line} clipPath={`url(#${uid}-lit)`} style={{ pathLength: drawn, opacity: lineOpacity }} />
        <motion.line className={styles.cursor} x1={cursorX} x2={cursorX} y1={0} y2={box.h} initial={false} animate={{ opacity: scrubbing ? 1 : 0 }} transition={reduceMotion ? { duration: 0 } : quick} />
        {/* A zero-length round-capped stroke is a true circle, and it takes the line's colour. It rests on the latest point and becomes the scrub handle. */}
        <motion.polyline className={[styles.end, styles[tone]].join(" ")} points={dot} initial={false} animate={{ opacity: landed ? 1 : 0, strokeWidth: landed ? scrubbing ? 10 : 7 : 0 }} transition={reduceMotion ? { duration: 0 } : { opacity: quick, strokeWidth: motionTokens.spring.snappy }} fill="none" strokeLinecap="round" />
      </svg>
    </div>
    <div className="zero-arc-sparkline__srOnly"><table><caption>{label}</caption><thead><tr><th scope="col">Point</th><th scope="col">Value</th></tr></thead><tbody>{data.map((point,index)=><tr key={index}><th scope="row">{labels?.[index]??String(index+1)}</th><td>{formatValue?formatValue(point,index):grouped.format(point)}</td></tr>)}</tbody></table></div>
  </figure>;
}

/** Render a bounded numeric mini-trend without inventing observations for missing data. */
export function Sparkline(props:SparklineProps){
 const model=useMemo(()=>buildSparklineModel(props.data,props.labels),[props.data,props.labels]);chartDimension(props.width??160,'width');chartDimension(props.height??52,'height',12);
 chartLabel(props.label,'label');chartSelector(props.tone,'tone',['accent','success','warning','danger']);
 for(const key of ['value','change'] as const)if(props[key]!==undefined)chartText(props[key],key);
 for(const key of ['motion','area','interactive'] as const)chartFlag(props[key],key);
 for(const key of ['activeIndex','defaultActiveIndex'] as const){const value=props[key];if(value!==undefined&&value!==null&&(!Number.isInteger(value)||value<0||value>=CARTESIAN_LIMITS.points))throw new TypeError(`${key} must be a bounded nonnegative observation index`);}
 return <SparklineRenderer {...props} data={model.data} labels={model.labels}/>;
}
export default Sparkline;
