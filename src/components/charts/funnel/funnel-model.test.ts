/** Qualifies Funnel cohort boundaries, ownership, inspection and aggregate particle semantics. */
import { describe, expect, test } from 'bun:test';
import { buildFunnelModel, computeFunnelSnapshot, FUNNEL_LIMITS, funnelRate, funnelStageValue,
  inspectFunnelStage, normalizeFunnelView } from './funnel-model';
import { computeFunnelParticleDistribution, createFunnelRandom, sampleFunnelParticle } from './funnel-particles';
import type { FunnelData, FunnelView } from './funnel-types';

const total: FunnelView = { kind: 'total' }, split: FunnelView = { kind: 'split' };
const data: FunnelData = {
  segments: [{ id: 'mobile', label: 'Mobile' }, { id: 'desktop', label: 'Desktop' }],
  stages: [
    { id: 'visit', label: 'Visited store', values: { mobile: 70_200, desktop: 29_800 } },
    { id: 'view', label: 'Viewed product', values: { mobile: 41_100, desktop: 20_400 } },
    { id: 'cart', label: 'Added to cart', values: { mobile: 9600, desktop: 7100 } },
    { id: 'checkout', label: 'Started checkout', values: { mobile: 4500, desktop: 4000 } },
    { id: 'buy', label: 'Purchased', values: { mobile: 1600, desktop: 2100 } },
  ],
};
const invalid = (value: unknown): void => { expect(() => buildFunnelModel(value as FunnelData)).toThrow(); };

describe('Funnel model', () => {
  test('retains ordered exact total, per-segment retention and drop-off', () => {
    const model = buildFunnelModel(data), snapshot = computeFunnelSnapshot(model);
    expect(model.stageCount).toBe(5); expect(model.segmentCount).toBe(2);
    expect(model.stages.map(stage => stage.total)).toEqual([100_000, 61_500, 16_700, 8500, 3700]);
    expect(snapshot.baseline).toBe(100_000); expect(snapshot.conversionRate).toBe(0.037);
    expect(snapshot.values[0]!.keptFromPrevious).toBeNull();
    expect(snapshot.values[1]!.fromStart).toBe(0.615); expect(snapshot.values[1]!.dropOff).toBeCloseTo(0.385);
    const inspection = inspectFunnelStage(model, split, 'buy')!;
    expect(inspection.total).toBe(3700); expect(inspection.previousStage?.id).toBe('checkout');
    expect(inspection.rows.map(row => row.value)).toEqual([1600, 2100]);
    expect(inspection.rows[0]!.keptFromPrevious).toBeCloseTo(1600 / 4500);
    expect(inspection.rows[1]!.fromStart).toBeCloseTo(2100 / 29_800);
    expect(inspectFunnelStage(model, total, 'retired')).toBeNull();
    expect(funnelStageValue(model, 'cart', { kind: 'segment', id: 'desktop' })).toBe(7100);
    expect(() => funnelStageValue(model, 'retired')).toThrow();
  });

  test('owns immutable detached labels, stages, and numeric vectors', () => {
    const input = { segments: [{ id: 'one', label: 'One' }], stages: [{ id: 'a', values: { one: 100 } }, { id: 'b', values: { one: 25 } }] };
    const model = buildFunnelModel(input);
    input.segments[0]!.label = 'Changed'; input.stages[0]!.values.one = 500; input.stages.reverse();
    expect(model.segments[0]!.label).toBe('One'); expect(model.stages[0]!.values[0]).toBe(100);
    expect(model.stages[0]!.id).toBe('a'); expect(Object.isFrozen(model.stages[0]!.values)).toBe(true);
    expect(Object.isFrozen(model.stages)).toBe(true); expect(Object.isFrozen(model.segments)).toBe(true);
  });

  test('IDs, not prototype keys or reserved words, identify cohorts and views', () => {
    const values = Object.assign(Object.create(null), { total: 10, split: 5, constructor: 2, __proto__: 0 });
    Object.defineProperty(values, '__proto__', { value: 3, enumerable: true });
    const model = buildFunnelModel({ segments: ['total', 'split', 'constructor', '__proto__'].map(id => ({ id })), stages: [{ id: '__proto__', values }] });
    expect(computeFunnelSnapshot(model, { kind: 'segment', id: 'total' }).baseline).toBe(10);
    expect(computeFunnelSnapshot(model, { kind: 'segment', id: 'split' }).baseline).toBe(5);
    expect(computeFunnelSnapshot(model, total).baseline).toBe(20);
    expect(normalizeFunnelView(model, { kind: 'segment', id: 'retired' })).toEqual(total);
    expect(() => normalizeFunnelView(model, 'total' as unknown as FunnelView)).toThrow();
    expect(() => normalizeFunnelView(model, { kind: 'segment', id: '' })).toThrow();
  });

  test('missing own counts mean zero and zero baselines have unknown rates', () => {
    const model = buildFunnelModel({ segments: [{ id: 'one' }, { id: 'zero' }], stages: [{ id: 'a', values: { one: 10 } }, { id: 'b' }] });
    expect(model.stages[1]!.values).toEqual([0, 0]);
    expect(computeFunnelSnapshot(model, { kind: 'segment', id: 'zero' }).conversionRate).toBeNull();
    expect(computeFunnelSnapshot(buildFunnelModel({ stages: [{ id: 'a' }, { id: 'b', value: 0 }] })).values[1]!.dropOff).toBeNull();
    expect(computeFunnelSnapshot(buildFunnelModel({ stages: [] })).conversionRate).toBeNull();
    expect(funnelRate(0, 10)).toBe(0); expect(funnelRate(0, 0)).toBeNull();
    expect(() => funnelRate(-1, 2)).toThrow(); expect(() => funnelRate(Infinity, 2)).toThrow();
    expect(normalizeFunnelView(buildFunnelModel({ stages: [] }), split)).toEqual(total);
  });

  test('rejects ambiguous, nonfinite, increasing, inherited, accessor, and unknown counts', () => {
    for (const value of [null, {}, { stages: null }, { stages: [], segments: {} }, { stages: [undefined] }]) invalid(value);
    for (const value of [NaN, Infinity, -Infinity, -1, '2', undefined, null]) invalid({ stages: [{ id: 'a', value }] });
    invalid({ stages: [{ id: 'a', value: 1 }, { id: 'b', value: 2 }] });
    invalid({ stages: [{ id: 'a', values: {} }] });
    invalid({ segments: [{ id: 'one' }], stages: [{ id: 'a', value: 0, values: { one: 1 } }] });
    invalid({ segments: [{ id: 'one' }], stages: [{ id: 'a', values: { unknown: 1 } }] });
    invalid({ segments: [{ id: 'one' }], stages: [{ id: 'a', values: Object.create({ one: 1 }) }] });
    const accessor = Object.defineProperty({}, 'one', { get() { throw new Error('Must not run'); }, enumerable: true });
    invalid({ segments: [{ id: 'one' }], stages: [{ id: 'a', values: accessor }] });
    const stageAccessor = Object.defineProperty({ id: 'a' }, 'value', { get() { throw new Error('Must not run'); } });
    invalid({ stages: [stageAccessor] });
    invalid({ segments: [{ id: 'one' }], stages: [{ id: 'a', values: { one: 1 } }, { id: 'b', values: { one: 2 } }] });
    invalid({ segments: [{ id: 'one' }], stages: [{ id: 'a', values: [] }] });
    invalid({ segments: [{ id: 'one' }], stages: [{ id: 'a', values: { [Symbol('one')]: 1 } }] });
  });

  test('rejects duplicate and excessive IDs/count matrices, accepts exact budget and finite extremes', () => {
    invalid({ stages: [{ id: 'a' }, { id: 'a' }] });
    invalid({ segments: [{ id: 'a' }, { id: 'a' }], stages: [] });
    invalid({ stages: [{ id: '' }] }); invalid({ stages: [{ id: 'a', label: false }] });
    invalid({ stages: [{ id: 'a'.repeat(FUNNEL_LIMITS.idLength + 1) }] });
    invalid({ stages: Array.from({ length: FUNNEL_LIMITS.stages + 1 }, (_, i) => ({ id: String(i) })) });
    invalid({ segments: Array.from({ length: FUNNEL_LIMITS.segments + 1 }, (_, i) => ({ id: String(i) })), stages: [] });
    const segments = Array.from({ length: 16 }, (_, i) => ({ id: String(i) }));
    const stages = Array.from({ length: 32 }, (_, i) => ({ id: String(i), values: Object.fromEntries(segments.map(segment => [segment.id, 32 - i])) }));
    expect(buildFunnelModel({ segments, stages }).stageCount).toBe(32);
    invalid({ segments: [{ id: 'a' }, { id: 'b' }], stages: [{ id: 'start', values: { a: Number.MAX_VALUE, b: Number.MAX_VALUE } }] });
    const huge = buildFunnelModel({ stages: [{ id: 'a', value: Number.MAX_VALUE }, { id: 'b', value: Number.MAX_VALUE / 2 }] });
    expect(computeFunnelSnapshot(huge).conversionRate).toBe(0.5);
    const tiny = buildFunnelModel({ stages: [{ id: 'a', value: Number.MIN_VALUE * 2 }, { id: 'b', value: Number.MIN_VALUE }] });
    expect(computeFunnelSnapshot(tiny).conversionRate).toBe(0.5);
  });

  test('new declaration orders reindex stable identities without retaining retired stages', () => {
    const first = buildFunnelModel({ segments: [{ id: 'a' }, { id: 'b' }], stages: [{ id: 'start', values: { a: 10, b: 20 } }, { id: 'end', values: { a: 5, b: 10 } }] });
    const next = buildFunnelModel({ segments: [{ id: 'b' }, { id: 'a' }], stages: [{ id: 'start', values: { a: 10, b: 20 } }] });
    expect(first.segmentById.get('a')!.index).toBe(0); expect(next.segmentById.get('a')!.index).toBe(1);
    expect(funnelStageValue(next, 'start', { kind: 'segment', id: 'a' })).toBe(10); expect(next.stageById.has('end')).toBe(false);
  });
});

describe('Funnel aggregate illustration distributions', () => {
  test('weights by entry share and normalizes each cohort departure distribution', () => {
    const model = buildFunnelModel(data), distributions = computeFunnelParticleDistribution(model, total);
    expect(distributions.map(row => row.weight)).toEqual([0.702, 0.298]);
    expect(distributions[0]!.departures[0]).toBeCloseTo((70_200 - 41_100) / 70_200);
    expect(distributions[1]!.departures[5]).toBeCloseTo(2100 / 29_800);
    for (const distribution of distributions) expect(distribution.departures.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    const isolated = computeFunnelParticleDistribution(model, { kind: 'segment', id: 'desktop' });
    expect(isolated).toHaveLength(1); expect(isolated[0]!.weight).toBe(1);
  });

  test('seeded samples approximate per-segment and terminal aggregate shares', () => {
    const model = buildFunnelModel(data), random = createFunnelRandom(3), counts = [0, 0], survivors = [0, 0];
    let bounded = true;
    for (let i = 0; i < 20_000; i++) {
      const particle = sampleFunnelParticle(model, total, random)!;
      counts[particle.segmentIndex]!++; if (particle.leaveStage === model.stageCount) survivors[particle.segmentIndex]!++;
      bounded &&= particle.lane >= 0.08 && particle.lane < 0.92 && particle.speed >= 0.85 && particle.speed < 1.15;
    }
    expect(bounded).toBe(true);
    expect(counts[0]! / 20_000).toBeCloseTo(0.702, 1); expect(counts[1]! / 20_000).toBeCloseTo(0.298, 1);
    expect(survivors[0]! / 20_000).toBeCloseTo(1600 / 100_000, 2); expect(survivors[1]! / 20_000).toBeCloseTo(2100 / 100_000, 2);
  });

  test('empty/zero cohorts produce no dots, single-stage cohorts survive, RNG errors never coerce', () => {
    const zero = buildFunnelModel({ stages: [{ id: 'a', value: 0 }] });
    expect(sampleFunnelParticle(zero, total, () => 0.5)).toBeNull();
    const one = buildFunnelModel({ stages: [{ id: 'a', value: 2 }] });
    expect(sampleFunnelParticle(one, total, () => 0)!.leaveStage).toBe(1);
    for (const value of [1, -1, NaN, Infinity]) expect(() => sampleFunnelParticle(one, total, () => value)).toThrow();
    const a = createFunnelRandom(17), b = createFunnelRandom(17);
    expect(Array.from({ length: 8 }, a)).toEqual(Array.from({ length: 8 }, b));
    expect(() => createFunnelRandom(0.5)).toThrow();
  });
});
