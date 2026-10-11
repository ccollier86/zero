/** Synthetic lifecycle regressions: rolling windows, corrected gaps, bounded retirement and pure speculative work. */
import { expect, test } from 'bun:test';
import { buildRealtimeModel, computeRealtimePaths, computeRealtimeWindow, type RealtimeSample } from './realtime-model';
import { EMPTY_REALTIME_PATH_STATE, reconcileRealtimePaths } from './realtime-path-state';
const samples = (values: readonly (number | null)[]): RealtimeSample[] => values.map((value, time) => ({ id: `s${time}`, time, value }));
const geometry = (data: readonly RealtimeSample[], duration = 100) => computeRealtimePaths(computeRealtimeWindow(buildRealtimeModel(data), duration));

test('rolling windows retain mounted segment identity and exact every-sample geometry', () => {
  const initial = reconcileRealtimePaths(geometry(samples([1, 2, 3, 4]), 2), EMPTY_REALTIME_PATH_STATE);
  const next = reconcileRealtimePaths(geometry(samples([1, 2, 3, 4, 5]), 2), initial.state);
  expect(initial.paths[0]!.id).toBe('s1'); expect(next.paths[0]!.id).toBe('s2');
  expect(next.paths[0]!.key).toBe(initial.paths[0]!.key); expect(next.paths[0]!.entering).toBe(false);
  expect(next.paths[0]!.sampleIds).toEqual(['s2', 's3', 's4']); expect(next.paths[0]!.d.split('L')).toHaveLength(3);
  expect(Object.isFrozen(next.paths[0]!.sampleIds)).toBe(true);
});
test('corrected null gaps split and merge mounted segments without duplicate identities or replayed reveals', () => {
  const initial = reconcileRealtimePaths(geometry(samples([1, 2, 3, 4, 5, 6])), EMPTY_REALTIME_PATH_STATE);
  const split = reconcileRealtimePaths(geometry(samples([1, null, 3, 4, 5, 6])), initial.state);
  expect(split.paths).toHaveLength(2); expect(new Set(split.paths.map(path => path.key)).size).toBe(2);
  expect(split.paths[1]!.key).toBe(initial.paths[0]!.key); expect(split.paths.every(path => !path.entering)).toBe(true);
  const merged = reconcileRealtimePaths(geometry(samples([1, 2, 3, 4, 5, 6])), split.state);
  expect(merged.paths).toHaveLength(1); expect(merged.paths[0]!.key).toBe(initial.paths[0]!.key); expect(merged.paths[0]!.entering).toBe(false);
});
test('retired snapshots and new segments cannot inherit an unrelated mounted identity', () => {
  const initial = reconcileRealtimePaths(geometry(samples([1, null, 3])), EMPTY_REALTIME_PATH_STATE);
  const incoming = reconcileRealtimePaths(geometry(samples([1, null, 3, null, 5])), initial.state);
  expect(incoming.paths.slice(0, 2).map(path => path.key)).toEqual(initial.paths.map(path => path.key)); expect(incoming.paths[2]!.entering).toBe(true);
  const retired = reconcileRealtimePaths([], incoming.state); expect(retired.state.identities).toHaveLength(0);
  const returned = reconcileRealtimePaths(geometry(samples([1])), retired.state);
  expect(returned.paths[0]!.key).not.toBe(initial.paths[0]!.key); expect(returned.paths[0]!.entering).toBe(true);
  const replaced = reconcileRealtimePaths(geometry([{ id: 'new-scope', time: 10, value: 4 }]), incoming.state);
  expect(replaced.paths[0]!.entering).toBe(true); expect(replaced.state.identities).toHaveLength(1);
});
test('matching is deterministic and does not mutate committed state during speculative renders', () => {
  const initial = reconcileRealtimePaths(geometry(samples([1, 2, 3])), EMPTY_REALTIME_PATH_STATE);
  const previousKeys = initial.state.nextKey;
  const candidate = geometry(samples([1, null, 3]));
  const first = reconcileRealtimePaths(candidate, initial.state), second = reconcileRealtimePaths(candidate, initial.state);
  expect(first).toEqual(second); expect(initial.state.nextKey).toBe(previousKeys); expect(initial.state.identities).toHaveLength(1);
});
test('repeated stream windows store only current identities within the admitted work budget', () => {
  let state = EMPTY_REALTIME_PATH_STATE;
  for (let end = 0; end < 100; end++) {
    const data = Array.from({ length: Math.min(11, end + 1) }, (_, i) => { const time = end - Math.min(10, end) + i; return { id: `s${time}`, time, value: time % 3 === 0 ? null : time }; });
    const result = reconcileRealtimePaths(geometry(data, 10), state); state = result.state;
    expect(new Set(result.paths.map(path => path.key)).size).toBe(result.paths.length);
    expect(state.identities.flatMap(identity => identity.sampleIds).length).toBeLessThanOrEqual(11);
  }
});
