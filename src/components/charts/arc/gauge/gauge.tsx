/** Arc UI Free derivation. Copyright (c) 2026 Elia Kuratli, MIT. Owns finite meter motion and named state rendering only. */
"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform, type Variants } from "motion/react";
import { useArcChartEnvironment } from "../shared/use-arc-chart-environment";
import { motionTokens } from "../shared/motion-tokens";
import { styles } from "./gauge-classes";
import { buildGaugeModel, gaugeArcPath as arcFor } from "./gauge-model";
import type { GaugeProps } from "./gauge-types";
export type { GaugeProps, GaugeTone, GaugeThreshold } from "./gauge-types";
const track = arcFor(1);

/** Copy enters from the side the value moved toward: a rise comes up from below, a fall drops from above. */
const rise: Variants = { hidden: (direction: number) => ({ opacity: 0, y: `${.3 * direction}em`, filter: `blur(${motionTokens.blur.soft}px)` }), shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] } }, gone: (direction: number) => ({ opacity: 0, y: `${-.3 * direction}em`, filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } }) };
// Same keys as `rise` so the settled style is identical whichever branch renders on the server.
const fade: Variants = { hidden: { opacity: 0, y: 0, filter: "blur(0px)" }, shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: motionTokens.duration.instant } }, gone: { opacity: 0, y: 0, filter: "blur(0px)", transition: { duration: motionTokens.duration.instant } } };
/** The first fill is slower and never overshoots, like a ring closing when the view opens. */
const reveal = { ...motionTokens.spring.smooth, visualDuration: motionTokens.duration.considered * 1.6 };

/** New copy rises in while the old copy leaves, popped out of flow so the line never holds both. */
function Swap({ text, direction = 1, reduced = false }: { text: string; direction?: number; reduced?: boolean }) {
  const reduceMotion = !!useReducedMotion() || reduced;
  return <span className={styles.swap}><AnimatePresence mode="popLayout" initial={false} custom={direction}><motion.span key={text} className={styles.text} custom={direction} variants={reduceMotion ? fade : rise} initial="hidden" animate="shown" exit="gone">{text}</motion.span></AnimatePresence></span>;
}

/** Arc-derived finite meter with bounded input and named threshold states; owns presentation, not transport. */
export function Gauge({ value, min = 0, max = 100, label, detail, tone = "accent", thresholds, className, motion: motionEnabled = true }: GaugeProps) {
  const admitted = buildGaugeModel(value, min, max, thresholds);
  const signature = JSON.stringify([value, min, max, admitted.thresholds]);
  const model = useMemo(() => admitted, [signature]);
  if(typeof label !== "string" || (!label.trim() || label.length > 4096)) throw new TypeError("Gauge: label required");
  if(!["accent", "success", "warning", "danger"].includes(tone)) throw new TypeError("Gauge: invalid tone");
  const safeMax = model.max, percentage = model.percentage, displayValue = model.displayValue, bands = model.thresholds;
  const bandAt = (at: number) => bands.filter(threshold => at >= threshold.from).pop();
  const band = bandAt(value);
  const ref = useRef<HTMLElement>(null);
  const sizer = useRef<HTMLSpanElement>(null);
  const environment = useArcChartEnvironment(ref, { motion: motionEnabled });
  const inView = environment.inView, reduceMotion = environment.reduced;
  const sweep = useMotionValue(reduceMotion ? percentage : 0);
  const count = useMotionValue(reduceMotion ? percentage * 100 : 0);
  const digitsWidth = useMotionValue<number | "auto">("auto");
  const [filled, setFilled] = useState(false);
  const [live, setLive] = useState(band);
  useEffect(() => { setLive(bandAt(min + (count.get() / 100) * (safeMax - min))); }, [signature]);
  const path = useTransform(sweep, arcFor);
  // The cap fades in over the first sliver instead of popping in as a dot.
  const arcOpacity = useTransform(sweep, current => Math.min(1, Math.max(0, current / .02)));
  const digits = useTransform(count, current => String(Math.round(Math.min(100, Math.max(0, current)))));
  const [moved, setMoved] = useState({ value: displayValue, direction: 1 });
  if (moved.value !== displayValue) setMoved({ value: displayValue, direction: displayValue < moved.value ? -1 : 1 });

  // The ring fills once it is seen, then springs to each new value with a little life; the count follows without overshooting.
  useEffect(() => {
    // Reduced motion lands on the value at once; the state appears a frame later, after hydration has matched the server.
    if (reduceMotion) { sweep.jump(percentage); count.jump(percentage * 100); const frame = requestAnimationFrame(() => setFilled(true)); return () => cancelAnimationFrame(frame); }
    if (!inView) return;
    const arc = animate(sweep, percentage, filled ? motionTokens.spring.morph : reveal);
    const number = animate(count, percentage * 100, { ...(filled ? motionTokens.spring.smooth : reveal), onComplete: () => setFilled(true) });
    return () => { arc.stop(); number.stop(); };
  }, [count, filled, inView, percentage, reduceMotion, sweep]);

  // The state arrives as the first fill lands. After that it follows the number on screen, so the color and label change exactly as the count crosses a threshold.
  useMotionValueEvent(count, "change", current => {
    const next = bandAt(min + (current / 100) * (safeMax - min));
    const changed = next?.from !== live?.from || next?.label !== live?.label;
    if (filled) { if (changed) setLive(next); }
    else if (inView && Math.abs(current - percentage * 100) < 1) { if (changed) setLive(next); setFilled(true); }
  });
  const shown = reduceMotion || !filled ? band : live;
  const activeTone = shown?.tone ?? tone;

  // Digits are right aligned in a box sized to the target number, so the ones column never jumps while counting and the group recentres on a spring.
  useEffect(() => {
    const node = sizer.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let measured: string | null = null;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = entry.borderBoxSize?.[0]?.inlineSize ?? node.offsetWidth;
      if (measured !== null && measured !== node.textContent && !reduceMotion) animate(digitsWidth, next, motionTokens.spring.smooth);
      else digitsWidth.jump(next);
      measured = node.textContent;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [digitsWidth, reduceMotion]);

  return <figure data-slot="gauge" data-zero-arc-chart data-motion={reduceMotion ? "off" : undefined} ref={ref} className={[styles.figure, styles[activeTone], className].filter(Boolean).join(" ")} aria-label={`${label}: ${value} of ${safeMax}${band ? `, ${band.label}` : ""}`}>
    <div className={styles.visual} role="meter" aria-label={label} aria-valuemin={min} aria-valuemax={safeMax} aria-valuenow={Math.min(safeMax, Math.max(min, value))} aria-valuetext={`${displayValue}%${band ? `, ${band.label}` : ""}`}>
      <svg viewBox="0 0 100 90" aria-hidden="true" focusable="false"><path className={styles.track} d={track} /><motion.path className={styles.arc} d={path} style={{ opacity: arcOpacity }} /></svg>
      <div className={styles.readout} aria-hidden="true">
        <span className={styles.number}><motion.span className={styles.digits} style={{ width: digitsWidth }}>{digits}</motion.span><span className={styles.unit}>%</span><span ref={sizer} className={styles.sizer}>{displayValue}</span></span>
        {thresholds && <span className={styles.status}><Swap text={filled || reduceMotion ? shown?.label ?? "" : ""} direction={moved.direction} reduced={reduceMotion} /></span>}
      </div>
    </div>
    <figcaption><strong><Swap text={label} reduced={reduceMotion} /></strong>{detail && <span className={styles.detail}><Swap text={detail} direction={moved.direction} reduced={reduceMotion} /></span>}</figcaption>
  </figure>;
}

export default Gauge;
