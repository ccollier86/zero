/**
 * Arc UI Free derivation. Copyright (c) 2026 Elia Kuratli, MIT.
 * Zero chart model layer: detached finite admission and mathematical layout;
 * no React, browser globals, subscriptions, authorization or transport.
 */
import type { ActivityDay } from "./activity-heatmap-types";
export const ACTIVITY_HEATMAP_LIMITS = Object.freeze({ entries: 10000, days: 3660, magnitude: 1e12 });
const CHART = "Activity Heatmap";
export const ACTIVITY_DAY_MS = 86_400_000;
const DAY = ACTIVITY_DAY_MS;

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

/** Parse a strict Gregorian UTC date, rejecting rollover, timezone ambiguity and malformed calendar values. */
export function parseActivityDate(iso: string): number {
  if(typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso.startsWith("0000")) fail("expected YYYY-MM-DD Gregorian date");
  const value = Date.parse(iso + "T00:00:00Z");
  if(!Number.isFinite(value) || new Date(value).toISOString().slice(0,10)!==iso) fail("invalid Gregorian date");
  return value;
}
/** Stable UTC date identity used for range arithmetic and selection. */
export const activityDateISO = (time: number): string => new Date(time).toISOString().slice(0,10);
const toUtc = parseActivityDate;

export type ActivityHeatmapModel = {
  readonly start: number; readonly length: number; readonly lead: number; readonly weeks: number; readonly total: number;
  readonly counts: readonly number[]; readonly levels: readonly number[]; readonly thresholds: readonly [number, number, number];
  readonly months: readonly { readonly month: number; readonly col: number; readonly label: string }[];
  /** How many days in the range sit at each level. */
  readonly perLevel: readonly number[];
};
/** Build a complete bounded UTC calendar; missing days are zero and duplicate observations are summed. */
export function buildActivityHeatmapModel(input: readonly ActivityDay[], weekStartsOn: 0 | 1 = 0, thresholds?: readonly [number, number, number], locale = "en-US"): ActivityHeatmapModel {
  if(weekStartsOn !== 0 && weekStartsOn !== 1) fail("week must begin on Sunday or Monday");
  text(locale); new Intl.DateTimeFormat(locale, { timeZone: "UTC" });
  let admittedThresholds: [number,number,number] | undefined;
  if(thresholds !== undefined) { const values = list(thresholds, 3); if(values.length !== 3) fail("three thresholds required"); admittedThresholds = values.map(v=>integer(v, 1, 1e12)) as [number,number,number]; if(!(admittedThresholds[0]<admittedThresholds[1] && admittedThresholds[1]<admittedThresholds[2])) fail("thresholds must increase"); }
  const days = list(input, ACTIVITY_HEATMAP_LIMITS.entries).map(raw => {
    const day=plain(raw, ["date", "count"]); const date=text(day.date); parseActivityDate(date); const count=integer(day.count, 0, 1e12); return { date, count };
  });
  const dates = days.map(day => toUtc(day.date)).filter(Number.isFinite);
  const start = dates.length ? Math.min(...dates) : toUtc("2025-01-01");
  const length = dates.length ? Math.round((Math.max(...dates) - start) / DAY) + 1 : 0;
  if(length > ACTIVITY_HEATMAP_LIMITS.days) fail("calendar range budget exceeded");
  const counts = new Array<number>(length).fill(0);
  days.forEach(day => { const index = Math.round((toUtc(day.date) - start) / DAY); if (index >= 0 && index < length) counts[index]! += day.count; });
  if(counts.some(v=>v>1e12) || counts.reduce((a,b)=>a+b,0)>1e12) fail("count total budget exceeded");
  const max = counts.reduce((a, b) => Math.max(a, b), 0);
  const bounds = admittedThresholds ?? [Math.max(1, Math.ceil(max * .25)), Math.max(2, Math.ceil(max * .5)), Math.max(3, Math.ceil(max * .75))] as [number, number, number];
  const levels = counts.map(count => count <= 0 ? 0 : count <= bounds[0] ? 1 : count <= bounds[1] ? 2 : count <= bounds[2] ? 3 : 4);
  const lead = (new Date(start).getUTCDay() - weekStartsOn + 7) % 7;
  const weeks = length ? Math.ceil((lead + length) / 7) : 0;
  const monthName = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const months: { month: number; col: number; label: string }[] = [];
  for (let index = 0; index < length; index++) {
    const date = new Date(start + index * DAY);
    if (index === 0 || date.getUTCDate() === 1) months.push({ month: date.getUTCFullYear() * 12 + date.getUTCMonth(), col: Math.floor((lead + index) / 7), label: monthName.format(date) });
  }
  // A partial first month keeps its label only when there is room before the next one.
  if (months.length > 1 && months[1]!.col - months[0]!.col < 3) months.shift();
  const perLevel = [0, 0, 0, 0, 0];
  levels.forEach(level => perLevel[level]!++);
  months.forEach(Object.freeze); Object.freeze(months); Object.freeze(counts); Object.freeze(levels); Object.freeze(bounds); Object.freeze(perLevel);
  return Object.freeze({ start, length, lead, weeks, total: counts.reduce((a, b) => a + b, 0), counts, levels, thresholds: bounds, months, perLevel });
}
