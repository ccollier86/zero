/** Renderer lifecycle matching for admitted stream paths; no clocks, geometry rewriting or data transport. */
import type { RealtimePath } from './realtime-model';

export interface RealtimePathIdentity {
  readonly key: string;
  readonly sampleIds: readonly string[];
}
export interface RealtimePathState {
  readonly nextKey: number;
  readonly identities: readonly RealtimePathIdentity[];
}
export interface RealtimeRenderPath extends RealtimePath {
  readonly key: string;
  /** Reveal only genuinely new observations, never fragments of an already visible path. */
  readonly entering: boolean;
}
export const EMPTY_REALTIME_PATH_STATE: RealtimePathState = Object.freeze({ nextKey: 0, identities: Object.freeze([]) });

/**
 * Keep a continuous segment mounted as its window advances. Match strongest
 * observed-ID overlap first, so gap splits/merges never duplicate keys and
 * never replay an entrance over already visible measurements. The returned
 * state replaces, rather than accumulates, the committed visible snapshot.
 */
export function reconcileRealtimePaths(paths: readonly RealtimePath[], previous: RealtimePathState): {
  readonly paths: readonly RealtimeRenderPath[];
  readonly state: RealtimePathState;
} {
  const owners = new Map<string, number>();
  previous.identities.forEach((identity, index) => identity.sampleIds.forEach(id => owners.set(id, index)));
  const overlap: { current: number; previous: number; count: number }[] = [];
  const related = new Set<number>();
  paths.forEach((path, current) => {
    const counts = new Map<number, number>();
    for (const id of path.sampleIds) {
      const owner = owners.get(id);
      if (owner !== undefined) counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    for (const [owner, count] of counts) { overlap.push({ current, previous: owner, count }); related.add(current); }
  });
  overlap.sort((a, b) => b.count - a.count || a.previous - b.previous || a.current - b.current);
  const matched = new Map<number, string>(), used = new Set<number>();
  for (const candidate of overlap) {
    if (!matched.has(candidate.current) && !used.has(candidate.previous)) {
      matched.set(candidate.current, previous.identities[candidate.previous]!.key);
      used.add(candidate.previous);
    }
  }
  let nextKey = previous.nextKey;
  const rendered = paths.map((path, index) => Object.freeze({
    ...path, key: matched.get(index) ?? `stream-segment-${nextKey++}`, entering: !related.has(index),
  }));
  return Object.freeze({
    paths: Object.freeze(rendered),
    state: Object.freeze({ nextKey, identities: Object.freeze(rendered.map(path => Object.freeze({ key: path.key, sampleIds: path.sampleIds }))) }),
  });
}
