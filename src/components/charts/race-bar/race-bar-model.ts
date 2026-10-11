/**
 * Bounded, renderer-independent Race Bar aggregate validation and ranking.
 * Values are copied into dense vectors; this module never queries a database,
 * interpolates event timestamps or turns visual playback into live provenance.
 */
import { normalizeRaceBarPosition, raceBarBlend } from './race-bar-math';
import type { RaceBarData, RaceBarInspection, RaceBarModel, RaceBarModelFrame, RaceBarModelGroup,
  RaceBarModelItem, RaceBarSnapshot } from './race-bar-types';

/** Bounds cover both DOM work and the dense history/accessible-table matrix. */
export const RACE_BAR_LIMITS = Object.freeze({ items: 256, frames: 1024, groups: 32, cells: 65_536,
  visibleBars: 64, idLength: 256, labelLength: 4096 });

function identifier(value: unknown, kind: string): asserts value is string {
  if (typeof value !== 'string' || !value.length || value.length > RACE_BAR_LIMITS.idLength) {
    throw new Error(`Race Bar ${kind} must be a nonempty string of at most ${RACE_BAR_LIMITS.idLength} characters.`);
  }
}

function label(value: unknown, kind: string): asserts value is string | undefined {
  if (value !== undefined && (typeof value !== 'string' || value.length > RACE_BAR_LIMITS.labelLength)) {
    throw new Error(`Race Bar ${kind} must be a string of at most ${RACE_BAR_LIMITS.labelLength} characters.`);
  }
}

/**
 * Validate and copy a bounded history. Missing own item values mean zero;
 * explicitly supplied invalid values or unknown item keys are never coerced.
 * Frame identities use id ?? period, so repeated labels require explicit IDs.
 */
export function buildRaceBarModel(data: RaceBarData): RaceBarModel {
  if (!data || !Array.isArray(data.items) || !Array.isArray(data.frames)
    || (data.groups !== undefined && !Array.isArray(data.groups))) {
    throw new Error('Race Bar data requires items and frames arrays, and an optional groups array.');
  }
  if (data.items.length > RACE_BAR_LIMITS.items || data.frames.length > RACE_BAR_LIMITS.frames
    || (data.groups?.length ?? 0) > RACE_BAR_LIMITS.groups || data.items.length * data.frames.length > RACE_BAR_LIMITS.cells) {
    throw new Error(`Race Bar data is limited to ${RACE_BAR_LIMITS.items} items, ${RACE_BAR_LIMITS.frames} frames, ${RACE_BAR_LIMITS.groups} groups and ${RACE_BAR_LIMITS.cells} matrix cells.`);
  }
  const groups: RaceBarModelGroup[] = [], groupById = new Map<string, RaceBarModelGroup>();
  for (const [order, input] of (data.groups ?? []).entries()) {
    identifier(input?.id, 'group id'); label(input.label, 'group label');
    if (groupById.has(input.id)) throw new Error(`Duplicate Race Bar group id: ${input.id}`);
    const group: RaceBarModelGroup = Object.freeze({ id: input.id, label: input.label ?? input.id, order, series: order % 4 + 1 });
    groups.push(group); groupById.set(group.id, group);
  }
  const items: RaceBarModelItem[] = [], byId = new Map<string, RaceBarModelItem>();
  for (const [index, input] of data.items.entries()) {
    identifier(input?.id, 'item id'); label(input.label, 'item label');
    if (byId.has(input.id)) throw new Error(`Duplicate Race Bar item id: ${input.id}`);
    if (input.group !== undefined) identifier(input.group, 'item group');
    const group = input.group === undefined ? undefined : groupById.get(input.group);
    if (input.group !== undefined && !group) throw new Error(`Race Bar item group must name a declared group: ${input.group}`);
    const item: RaceBarModelItem = Object.freeze({ id: input.id, label: input.label ?? input.id,
      group: input.group ?? null, order: index, index, series: group?.series ?? index % 4 + 1 });
    items.push(item); byId.set(item.id, item);
  }
  const frames: RaceBarModelFrame[] = [], frameById = new Map<string, RaceBarModelFrame>();
  for (const [index, input] of data.frames.entries()) {
    if (!input || typeof input.period !== 'string' || !input.period.length || input.period.length > RACE_BAR_LIMITS.labelLength) {
      throw new Error(`Race Bar periods must be nonempty strings of at most ${RACE_BAR_LIMITS.labelLength} characters.`);
    }
    const id = input.id ?? input.period;
    identifier(id, 'frame id');
    if (frameById.has(id)) throw new Error(`Duplicate Race Bar frame identity: ${id}. Repeated period labels require distinct explicit IDs.`);
    const record = input.values;
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || (Object.getPrototypeOf(record) !== Object.prototype && Object.getPrototypeOf(record) !== null)) {
      throw new Error('Race Bar frame values must be a plain or null-prototype own-key record. Inherited values are not accepted.');
    }
    const values = new Float64Array(items.length);
    for (const key of Reflect.ownKeys(record)) {
      if (typeof key !== 'string' || !byId.has(key)) throw new Error(`Race Bar frame values contain an unknown item key: ${String(key)}`);
      const property = Object.getOwnPropertyDescriptor(record, key)!;
      const value: unknown = property.value;
      if (!('value' in property) || typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error('Race Bar values must be own finite nonnegative numbers, not accessors or coerced values.');
      }
      values[byId.get(key)!.index] = value;
    }
    let total = 0;
    for (const value of values) {
      total += value;
      if (!Number.isFinite(total)) throw new Error('Race Bar aggregate totals overflow a finite number.');
    }
    const frame: RaceBarModelFrame = Object.freeze({ id, index, period: input.period, values, total });
    frames.push(frame); frameById.set(id, frame);
  }
  return Object.freeze({ groups: Object.freeze(groups), items: Object.freeze(items), frames: Object.freeze(frames), byId, groupById, frameById });
}

const mix = (from: number, to: number, fraction: number): number => from + (to - from) * fraction;

/** Interpolate one item's nonnegative value with the reference's 55% smoothstep blend. */
export function raceBarValueAt(model: RaceBarModel, itemId: string, position: number): number {
  const item = model.byId.get(itemId);
  if (!item) throw new Error(`Unknown Race Bar item id: ${itemId}`);
  const p = normalizeRaceBarPosition(position, model.frames.length);
  if (!model.frames.length) return 0;
  const lower = Math.floor(p), upper = Math.min(lower + 1, model.frames.length - 1);
  return mix(model.frames[lower]!.values[item.index]!, model.frames[upper]!.values[item.index]!, raceBarBlend(p - lower));
}

/**
 * Compute a stable descending ranking at a fractional presentation position.
 * The finite total blends complete frame totals, not only the visible top N.
 */
export function computeRaceBarSnapshot(model: RaceBarModel, position: number): RaceBarSnapshot {
  const p = normalizeRaceBarPosition(position, model.frames.length);
  const lowerFrameIndex = Math.floor(p), upperFrameIndex = Math.min(lowerFrameIndex + 1, Math.max(0, model.frames.length - 1));
  const fraction = p - lowerFrameIndex, blend = raceBarBlend(fraction);
  const lower = model.frames[lowerFrameIndex], upper = model.frames[upperFrameIndex];
  const rows = model.items.map(item => ({ item, value: lower && upper ? mix(lower.values[item.index]!, upper.values[item.index]!, blend) : 0, rank: 0 }))
    .sort((a, b) => b.value - a.value || a.item.order - b.item.order);
  rows.forEach((row, rank) => { row.rank = rank; });
  return { position: p, lowerFrameIndex, upperFrameIndex, fraction, frameIndex: Math.round(p),
    interpolated: fraction > 0 && upperFrameIndex !== lowerFrameIndex, rows,
    total: lower && upper ? mix(lower.total, upper.total, blend) : 0 };
}

/**
 * Describe a displayed row without confusing interpolation with observed data.
 * Delta fields compare exact rounded-period values with the previous period;
 * consumers should label that comparison separately while interpolated=true.
 */
export function inspectRaceBarItem(model: RaceBarModel, snapshot: RaceBarSnapshot, itemId: string): RaceBarInspection | null {
  const row = snapshot.rows.find(candidate => candidate.item.id === itemId);
  if (!row) return null;
  const frame = model.frames[snapshot.frameIndex] ?? null, previousFrame = model.frames[snapshot.frameIndex - 1] ?? null;
  const frameValue = frame?.values[row.item.index] ?? 0, previousValue = previousFrame?.values[row.item.index] ?? null;
  const change = previousValue === null ? null : frameValue - previousValue;
  const ratio = change !== null && previousValue !== null && previousValue > 0 ? change / previousValue : null;
  return { item: row.item, value: row.value, rank: row.rank, itemCount: model.items.length,
    share: snapshot.total > 0 ? row.value / snapshot.total : 0, total: snapshot.total, position: snapshot.position,
    interpolated: snapshot.interpolated, fraction: snapshot.fraction, frameIndex: snapshot.frameIndex,
    frame, previousFrame, lowerFrame: model.frames[snapshot.lowerFrameIndex] ?? null,
    upperFrame: model.frames[snapshot.upperFrameIndex] ?? null, frameValue, previousValue, change,
    // An astronomically large relative change is undefined rather than Infinity.
    changeRatio: ratio !== null && Number.isFinite(ratio) ? ratio : null };
}

/**
 * Preserve a period identity when live history prepends, trims or replaces rows.
 * Fractional progress survives when its bounding periods remain adjacent;
 * otherwise retain the rounded period if present, then clamp the old index.
 */
export function preserveRaceBarFramePosition(previous: RaceBarModel, next: RaceBarModel, position: number): number {
  const p = normalizeRaceBarPosition(position, previous.frames.length);
  if (!next.frames.length) return 0;
  const lower = previous.frames[Math.floor(p)], upper = previous.frames[Math.ceil(p)];
  const newLower = lower ? next.frameById.get(lower.id) : undefined, newUpper = upper ? next.frameById.get(upper.id) : undefined;
  if (newLower && newUpper && newUpper.index - newLower.index <= 1 && newUpper.index >= newLower.index) {
    return newLower.index + (p - Math.floor(p));
  }
  const current = previous.frames[Math.round(p)], preserved = current ? next.frameById.get(current.id) : undefined;
  return preserved?.index ?? normalizeRaceBarPosition(p, next.frames.length);
}
