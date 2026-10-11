import { expect, test } from 'bun:test';
import { selectClipCss, readSelectClip, selectMotionTime, selectTriggerClip, selectLocalTriggerClip, stepSelectSpring } from './select-motion-geometry';

test('Select clips stay bounded to the native collision-resolved rectangle on either side', () => {
  const content = { left: 20, top: 30, width: 200, height: 300 };
  expect(selectTriggerClip(content, { left: 40, top: 30, width: 120, height: 32 }, 8)).toEqual([0, 60, 268, 20, 8]);
  expect(selectTriggerClip(content, { left: 40, top: 298, width: 120, height: 32 }, 8)).toEqual([268, 60, 0, 20, 8]);
  const outside = selectTriggerClip(content, { left: -500, top: 900, width: 10, height: 10 }, 8);
  expect(outside).toEqual([300, 200, 0, 0, 8]);
  expect(readSelectClip(selectClipCss(outside))).toEqual(outside);
  expect(readSelectClip('circle(50%)')).toBeNull();
  expect(selectLocalTriggerClip({ left: 20, top: 30, width: 200, height: 300 }, { left: 40, top: 30, width: 120, height: 32 }, 8, .5, .5)).toEqual([0, 120, 536, 40, 8]);
});

test('visual timing admits bounded CSS times and physical springs remain finite on interruptions', () => {
  expect(selectMotionTime('.4s', 1)).toBe(400);
  expect(selectMotionTime('340ms', 1)).toBe(340);
  for (const input of ['-1ms', 'Infinitys', '120000ms', 'var(--duration)']) expect(selectMotionTime(input, 400)).toBe(400);
  const state = { value: 0, velocity: 0, target: 200 };
  for (let i = 0; i < 10; i++) stepSelectSpring(state, 280, .08, 1 / 60);
  expect(state.velocity).toBeGreaterThan(0);
  state.target = 0; const velocity = state.velocity;
  stepSelectSpring(state, 280, .08, 1 / 60);
  expect(state.velocity).not.toBe(0); expect(state.velocity).toBeLessThan(velocity);
  for (let i = 0; i < 300; i++) stepSelectSpring(state, 280, .08, 1 / 60);
  expect(state).toEqual({ value: 0, velocity: 0, target: 0 });
  state.target = 12; expect(stepSelectSpring(state, 0, 0, 0)).toBe(false); expect(state.value).toBe(12);
});
