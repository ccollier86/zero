/**
 * Bounded conversion-cohort validation and exact aggregate inspection. This
 * pure layer copies own numeric counts, requires nonincreasing cohort values,
 * and does not fetch data, infer cohort membership or report synthetic events.
 */
import type { FunnelData, FunnelInspection, FunnelInspectionRow, FunnelModel,
  FunnelModelSegment, FunnelModelStage, FunnelSnapshot, FunnelView } from './funnel-types';

/** Bounds cover rendering, geometry, controls and the accessible count matrix. */
export const FUNNEL_LIMITS = Object.freeze({ stages: 32, segments: 16, cells: 512,
  idLength: 256, labelLength: 4096 });

const TOTAL_VIEW: FunnelView = Object.freeze({ kind: 'total' });
const SPLIT_VIEW: FunnelView = Object.freeze({ kind: 'split' });

function own(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (!('value' in descriptor)) throw new Error('Funnel data fields must be own data properties, not accessors.');
  return descriptor.value;
}

function plain(value: unknown, kind: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`Funnel ${kind} must be a plain or null-prototype own-key record.`);
  }
}

function identifier(value: unknown, kind: string): asserts value is string {
  if (typeof value !== 'string' || !value.length || value.length > FUNNEL_LIMITS.idLength) {
    throw new Error(`Funnel ${kind} must be a nonempty string of at most ${FUNNEL_LIMITS.idLength} characters.`);
  }
}

function label(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > FUNNEL_LIMITS.labelLength) {
    throw new Error(`Funnel labels must be strings of at most ${FUNNEL_LIMITS.labelLength} characters.`);
  }
  return value;
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Funnel counts must be own finite nonnegative numbers, not accessors or coerced values.');
  }
  return value;
}

/**
 * Validate a bounded, ordered funnel and detach it from caller-owned records.
 * Missing own counts mean zero. Unknown segments, accessors, inherited counts,
 * nonfinite sums and increasing stage counts are rejected, not silently fixed.
 */
export function buildFunnelModel(data: FunnelData): FunnelModel {
  plain(data, 'data');
  const stageInputs = own(data, 'stages'), segmentInputs = own(data, 'segments');
  if (!Array.isArray(stageInputs) || (segmentInputs !== undefined && !Array.isArray(segmentInputs))) {
    throw new Error('Funnel data requires a stages array and an optional segments array.');
  }
  const inputSegments: unknown[] = segmentInputs ?? [];
  if (stageInputs.length > FUNNEL_LIMITS.stages || inputSegments.length > FUNNEL_LIMITS.segments
    || stageInputs.length * Math.max(1, inputSegments.length) > FUNNEL_LIMITS.cells) {
    throw new Error(`Funnel data is limited to ${FUNNEL_LIMITS.stages} stages, ${FUNNEL_LIMITS.segments} segments and ${FUNNEL_LIMITS.cells} cells.`);
  }
  const segments: FunnelModelSegment[] = [], segmentById = new Map<string, FunnelModelSegment>();
  for (const [index, input] of inputSegments.entries()) {
    plain(input, 'segment');
    const id = own(input, 'id'); identifier(id, 'segment id');
    if (segmentById.has(id)) throw new Error(`Duplicate Funnel segment id: ${id}`);
    const segment = Object.freeze({ id, label: label(own(input, 'label'), id), index, series: index % 4 + 1 });
    segments.push(segment); segmentById.set(id, segment);
  }
  const stages: FunnelModelStage[] = [], stageById = new Map<string, FunnelModelStage>();
  const K = Math.max(1, segments.length);
  for (const [index, input] of stageInputs.entries()) {
    plain(input, 'stage');
    const id = own(input, 'id'); identifier(id, 'stage id');
    if (stageById.has(id)) throw new Error(`Duplicate Funnel stage id: ${id}`);
    const numeric = own(input, 'value'), record = own(input, 'values');
    const values = Array<number>(K).fill(0);
    if (segments.length) {
      if (Object.hasOwn(input, 'value')) throw new Error('Segmented Funnel stages use values, not value.');
      if (Object.hasOwn(input, 'values')) {
        plain(record, 'stage values');
        for (const key of Reflect.ownKeys(record)) {
          if (typeof key !== 'string' || !segmentById.has(key)) {
            throw new Error(`Funnel stage values contain an unknown segment key: ${String(key)}`);
          }
          values[segmentById.get(key)!.index] = count(own(record, key));
        }
      }
    } else {
      if (Object.hasOwn(input, 'values')) throw new Error('Unsegmented Funnel stages use value, not values.');
      if (Object.hasOwn(input, 'value')) values[0] = count(numeric);
    }
    let total = 0;
    for (let k = 0; k < K; k++) {
      const value = values[k]!;
      if (index && value > stages[index - 1]!.values[k]!) {
        throw new Error('Funnel cohort counts must be nonincreasing at every ordered stage, for every segment.');
      }
      total += value;
      if (!Number.isFinite(total)) throw new Error('Funnel stage aggregate total overflows a finite number.');
    }
    const stage = Object.freeze({ id, label: label(own(input, 'label'), id), index,
      values: Object.freeze(values), total });
    stages.push(stage); stageById.set(id, stage);
  }
  return Object.freeze({ segments: Object.freeze(segments), stages: Object.freeze(stages), segmentById,
    stageById, stageCount: stages.length, segmentCount: K });
}

/** Validate a tagged view; retired/unknown segment IDs and unsegmented splits fall back to total. */
export function normalizeFunnelView(model: FunnelModel, view: FunnelView = TOTAL_VIEW): FunnelView {
  if (!view || (view.kind !== 'total' && view.kind !== 'split' && view.kind !== 'segment')) {
    throw new Error('Funnel view must be a tagged total, split or segment choice.');
  }
  if (view.kind === 'total' || !model.segments.length) return TOTAL_VIEW;
  if (view.kind === 'split') return SPLIT_VIEW;
  identifier(view.id, 'view segment id');
  return model.segmentById.has(view.id) ? Object.freeze({ kind: 'segment', id: view.id }) : TOTAL_VIEW;
}

/** Return one exact stage count for a view; totals include every declared segment. */
export function funnelStageValue(model: FunnelModel, stageId: string, view: FunnelView = TOTAL_VIEW): number {
  const stage = model.stageById.get(stageId);
  if (!stage) throw new Error(`Unknown Funnel stage id: ${stageId}`);
  const selected = normalizeFunnelView(model, view);
  return selected.kind === 'segment' ? stage.values[model.segmentById.get(selected.id)!.index]! : stage.total;
}

/** A zero count baseline has no defined rate; no artificial denominator is substituted. */
export function funnelRate(value: number, baseline: number): number | null {
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(baseline) || baseline < 0) {
    throw new Error('Funnel rates require finite nonnegative values and baselines.');
  }
  if (!baseline) return null;
  const ratio = value / baseline;
  return Number.isFinite(ratio) ? ratio : null;
}

/** Exact retention and conversion rates for one view, independent of animation. */
export function computeFunnelSnapshot(model: FunnelModel, view: FunnelView = TOTAL_VIEW): FunnelSnapshot {
  const selected = normalizeFunnelView(model, view);
  const index = selected.kind === 'segment' ? model.segmentById.get(selected.id)!.index : null;
  const valueOf = (stage: FunnelModelStage): number => index === null ? stage.total : stage.values[index]!;
  const baseline = model.stages.length ? valueOf(model.stages[0]!) : 0;
  const values = model.stages.map((stage, i) => {
    const value = valueOf(stage), previous = i ? valueOf(model.stages[i - 1]!) : null;
    const keptFromPrevious = previous === null ? null : funnelRate(value, previous);
    return Object.freeze({ stage, value, fromStart: funnelRate(value, baseline), keptFromPrevious,
      dropOff: keptFromPrevious === null ? null : Math.max(0, 1 - keptFromPrevious) });
  });
  return Object.freeze({ view: selected, baseline, values: Object.freeze(values),
    conversionRate: values.length ? values[values.length - 1]!.fromStart : null });
}

/** Inspect an existing stage by stable ID, with per-segment rows in split view. */
export function inspectFunnelStage(model: FunnelModel, view: FunnelView, stageId: string): FunnelInspection | null {
  const stage = model.stageById.get(stageId);
  if (!stage) return null;
  const snapshot = computeFunnelSnapshot(model, view), selected = snapshot.view;
  const previousStage = model.stages[stage.index - 1] ?? null, first = model.stages[0]!;
  const row = (segment: FunnelModelSegment | null): FunnelInspectionRow => {
    const value = segment ? stage.values[segment.index]! : stage.total;
    const start = segment ? first.values[segment.index]! : first.total;
    const previous = previousStage ? (segment ? previousStage.values[segment.index]! : previousStage.total) : null;
    return Object.freeze({ segment, value, fromStart: funnelRate(value, start),
      keptFromPrevious: previous === null ? null : funnelRate(value, previous) });
  };
  const rows = selected.kind === 'segment' ? [row(model.segmentById.get(selected.id)!)]
    : selected.kind === 'split' ? model.segments.map(row) : [row(null)];
  return Object.freeze({ ...snapshot.values[stage.index]!, view: selected, total: stage.total,
    previousStage, rows: Object.freeze(rows), conversionRate: snapshot.conversionRate });
}
