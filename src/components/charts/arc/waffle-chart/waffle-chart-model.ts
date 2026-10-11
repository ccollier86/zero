/**
 * Arc UI Free derivation. Copyright (c) 2026 Elia Kuratli, MIT.
 * Zero chart model layer: detached finite admission and mathematical layout;
 * no React, browser globals, subscriptions, authorization or transport.
 */
import type { WaffleCategory } from "./waffle-chart-types";
import { isChartCssColor } from '../../chart-color';
export const WAFFLE_LIMITS = Object.freeze({ data: 256, cells: 4096, dimension: 64 });
export interface WaffleCell { readonly id: number; readonly categoryId: string | null; readonly slot: number }
export interface WaffleModel { readonly data: readonly Readonly<WaffleCategory>[]; readonly total: number; readonly rows: number; readonly columns: number; readonly cellCount: number; readonly counts: readonly number[] }
const CHART = "Waffle";

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
function color(value: unknown): string { const result=text(value); if(!isChartCssColor(result)) fail("expected a supported resource-free CSS color"); return result; }
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

/** Admit finite nonnegative parts and exact bounded grid dimensions; returns detached immutable data and allocation. */
export function buildWaffleModel(input: readonly WaffleCategory[], rows = 10, columns = 10, decimals = 0): WaffleModel {
  integer(rows, 1, WAFFLE_LIMITS.dimension); integer(columns, 1, WAFFLE_LIMITS.dimension); integer(decimals, 0, 6);
  const cellCount = rows * columns; if(cellCount > WAFFLE_LIMITS.cells) fail("grid cell budget exceeded");
  const ids = new Set<string>(); let total = 0;
  const data = list(input, WAFFLE_LIMITS.data).map(raw => {
    const r = plain(raw, ["id", "label", "value", "color"]), id = text(r.id);
    if(!id || id.length > 256 || ids.has(id)) fail("invalid or duplicate identity"); ids.add(id);
    const value = number(r.value); total += value; if(total > 1e12) fail("total budget exceeded");
    return Object.freeze({ id, label: text(r.label, id), value, ...(r.color !== undefined ? { color: color(r.color) } : {}) });
  });
  return Object.freeze({ data: Object.freeze(data), total, rows, columns, cellCount, counts: Object.freeze(allocateWaffleCells(data, total, cellCount)) });
}

/** Whole cells per category by largest remainder, so the counts always add up to the grid. */
export function allocateWaffleCells(data: readonly WaffleCategory[], total: number, cells: number): number[] {
  if (total <= 0) return data.map(() => 0);
  const exact = data.map(item => Math.max(0, item.value) / total * cells);
  const counts = exact.map(Math.floor);
  let left = cells - counts.reduce((sum, count) => sum + count, 0);
  const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest);
  for (let k = 0; left > 0 && k < order.length; k++, left--) counts[order[k]!.index]!++;
  return counts;
}

/**
 * Hands cells to categories while moving as few as possible: each category keeps the cells it already had,
 * surplus cells join the categories that grew, and every block takes its cells in their previous order so paths never cross.
 */
export function reassignWaffleCells(previous: readonly WaffleCell[], data: readonly WaffleCategory[], counts: readonly number[]): WaffleCell[] {
  const bySlot = [...previous].sort((a, b) => a.slot - b.slot);
  const kept = new Map<string, WaffleCell[]>();
  const pool: WaffleCell[] = [];
  const want = new Map(data.map((item, index) => [item.id, counts[index]]));
  for (const cell of bySlot) {
    const list = cell.categoryId !== null ? kept.get(cell.categoryId) ?? [] : [];
    if (cell.categoryId !== null && list.length < (want.get(cell.categoryId) ?? 0)) { list.push(cell); kept.set(cell.categoryId, list); } else pool.push(cell);
  }
  const next: WaffleCell[] = [];
  let slot = 0;
  data.forEach((item, index) => {
    const own = kept.get(item.id) ?? [];
    while (own.length < counts[index]! && pool.length) own.push(pool.shift()!);
    own.sort((a, b) => a.slot - b.slot).forEach(cell => next.push({ id: cell.id, categoryId: item.id, slot: slot++ }));
  });
  pool.forEach(cell => next.push({ id: cell.id, categoryId: null, slot: slot++ }));
  return next.sort((a, b) => a.id - b.id);
}
