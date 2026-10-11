/**
 * Pure, aggregate-derived Funnel particle distributions and deterministic
 * sampling. These dots illustrate cohort retention probabilistically; no dot
 * is claimed to be an observed person, session, ingestion or database event.
 */
import { normalizeFunnelView } from './funnel-model';
import type { FunnelModel, FunnelParticleDistribution, FunnelParticleSample, FunnelView } from './funnel-types';

/** Compute entry-weighted segment shares and each segment's exact departure proportions. */
export function computeFunnelParticleDistribution(model: FunnelModel, view: FunnelView): readonly FunnelParticleDistribution[] {
  const selected = normalizeFunnelView(model, view), first = model.stages[0];
  if (!first || !first.total) return Object.freeze([]);
  const indices = selected.kind === 'segment' ? [model.segmentById.get(selected.id)!.index]
    : Array.from({ length: model.segmentCount }, (_, index) => index);
  const baseline = selected.kind === 'segment' ? first.values[indices[0]!]! : first.total;
  if (!baseline) return Object.freeze([]);
  return Object.freeze(indices.filter(index => first.values[index]! > 0).map(segmentIndex => {
    const start = first.values[segmentIndex]!, departures = Array<number>(model.stageCount + 1).fill(0);
    for (let i = 0; i < model.stageCount - 1; i++) {
      departures[i] = Math.max(0, (model.stages[i]!.values[segmentIndex]! - model.stages[i + 1]!.values[segmentIndex]!) / start);
    }
    departures[model.stageCount] = model.stages[model.stageCount - 1]!.values[segmentIndex]! / start;
    return Object.freeze({ segmentIndex, segmentId: model.segments[segmentIndex]?.id ?? null,
      weight: start / baseline, departures: Object.freeze(departures) });
  }));
}

function randomUnit(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Funnel particle RNG must return a finite number in [0, 1).');
  return value;
}

/**
 * Pick a segment by entry cohort weight and a preselected terminal stage by
 * that segment's retention. Finite samples only approximate the aggregate
 * rates; they are illustrative rather than telemetry or event provenance.
 */
export function sampleFunnelParticle(model: FunnelModel, view: FunnelView, random: () => number): FunnelParticleSample | null {
  const distributions = computeFunnelParticleDistribution(model, view);
  if (!distributions.length) return null;
  let threshold = randomUnit(random), selected = distributions[distributions.length - 1]!;
  for (const candidate of distributions) {
    threshold -= candidate.weight;
    if (threshold < 0) { selected = candidate; break; }
  }
  threshold = randomUnit(random);
  let leaveStage = model.stageCount;
  for (let i = 0; i < model.stageCount; i++) {
    threshold -= selected.departures[i]!;
    if (threshold < 0) { leaveStage = i; break; }
  }
  return Object.freeze({ segmentIndex: selected.segmentIndex, segmentId: selected.segmentId, leaveStage,
    lane: 0.08 + randomUnit(random) * 0.84, speed: 0.85 + randomUnit(random) * 0.3 });
}

/** Reproducible local illustration RNG; never suitable for security or sampling real events. */
export function createFunnelRandom(seed = 3): () => number {
  if (!Number.isSafeInteger(seed)) throw new Error('Funnel particle seed must be a safe integer.');
  let state = ((seed % 2_147_483_646) + 2_147_483_646) % 2_147_483_646 + 1;
  return () => (state = state * 16_807 % 2_147_483_647) / 2_147_483_647;
}
