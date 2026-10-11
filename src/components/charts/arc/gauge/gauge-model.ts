/**
 * Arc UI Free derivation. Copyright (c) 2026 Elia Kuratli, MIT.
 * Zero chart model layer: detached finite admission and mathematical layout;
 * no React, browser globals, subscriptions, authorization or transport.
 */
import type { GaugeModel, GaugeThreshold, GaugeTone } from "./gauge-types";
export const GAUGE_LIMITS = Object.freeze({ thresholds: 64, magnitude: 1e12 });
const CHART = "Gauge";

const fail = (message: string): never => { throw new TypeError(CHART + ": " + message); };
function plain(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("expected own plain data");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!)) fail("unknown or accessor field");
  }
  const own = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(descriptors)) own[key] = descriptor.value;
  return own;
}
function text(value: unknown, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || value.length > 4096) fail("invalid text");
  return value as string;
}
function number(value: unknown, minimum = 0, maximum = 1e12): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) fail("expected finite bounded number");
  return value as number;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  const n = number(value, minimum, maximum); if (!Number.isInteger(n)) fail("expected integer"); return n;
}
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("expected ordinary bounded array");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length?.value;
  if(typeof length !== "number" || !Number.isInteger(length) || length < 0 || length > maximum) fail("expected bounded array");
  for(const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key as string];
    if(typeof key !== "string" || (key !== "length" && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)) || !descriptor || !("value" in descriptor)) fail("accessor or extra array field");
  }
  const detached: unknown[] = [];
  for(let i=0; i<length; i++) { const descriptor = descriptors[String(i)]; if(!descriptor || !("value" in descriptor)) fail("sparse or accessor array"); detached.push(descriptor.value); }
  return detached;
}

/** Admit a real nonzero numeric range, then clip only the visible sweep; retains the exact raw value for descriptions. */
export function buildGaugeModel(value: number, min = 0, max = 100, thresholds: readonly GaugeThreshold[] = []): GaugeModel {
  number(value, -GAUGE_LIMITS.magnitude); number(min, -GAUGE_LIMITS.magnitude); number(max, -GAUGE_LIMITS.magnitude);
  if(max <= min) fail("max must exceed min");
  const starts = new Set<number>();
  const bands = list(thresholds, GAUGE_LIMITS.thresholds).map(raw => {
    const r = plain(raw, ["from", "tone", "label"]), from = number(r.from, min, max), tone = r.tone;
    if(starts.has(from)) fail("duplicate threshold"); starts.add(from);
    if(!["accent", "success", "warning", "danger"].includes(tone as string)) fail("invalid tone");
    return Object.freeze({ from, tone: tone as GaugeTone, label: text(r.label) });
  }).sort((a,b) => a.from - b.from);
  const percentage = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return Object.freeze({ value, min, max, percentage, displayValue: Math.round(percentage * 100), thresholds: Object.freeze(bands), band: bands.filter(band=>value>=band.from).at(-1) });
}

/** A 270 degree ring open at the bottom, drawn clockwise from its lower left end. Redrawn from the sweep every frame so the round cap stays exact. */
const radius = 42, start = -135, span = 270;
export function gaugeArcPath(sweep: number) {
  const end = start + span * Math.min(1, Math.max(0, sweep));
  const at = (angle: number) => `${(50 + radius * Math.sin((angle * Math.PI) / 180)).toFixed(3)} ${(50 - radius * Math.cos((angle * Math.PI) / 180)).toFixed(3)}`;
  return `M ${at(start)} A ${radius} ${radius} 0 ${end - start > 180 ? 1 : 0} 1 ${at(end)}`;
}
