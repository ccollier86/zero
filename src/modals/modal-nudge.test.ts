/** Required-step feedback never substitutes or cancels the chosen entrance. */
import { expect, test } from 'bun:test';
import { animateModalNudge } from './modal-motion-animation';
import { resolveModalMotion } from './modal-motion';

test('required nudge is additive, uses the exact scaled timing, and coalesces repeated requests', async () => {
  const effects: { frames: Keyframe[]; options: KeyframeAnimationOptions; cancelled: boolean }[] = [];
  const shell = { animate(frames: Keyframe[], options: KeyframeAnimationOptions) {
    const effect = { frames, options, cancelled: false }; effects.push(effect);
    return { finished: Promise.resolve(), cancel() { effect.cancelled = true; } } as unknown as Animation;
  } } as unknown as HTMLElement;
  animateModalNudge(shell, resolveModalMotion(null, {}, false));
  animateModalNudge(shell, resolveModalMotion(null, {}, false));
  expect(effects).toHaveLength(2);
  expect(effects[0]!.cancelled).toBe(true);
  expect(effects[1]!.options).toMatchObject({ duration: 390, composite: 'add', easing: 'cubic-bezier(.2,0,0,1)' });
  expect(effects[1]!.frames).toEqual([{ transform: 'scale(1)' }, { transform: 'scale(1.015)' }, { transform: 'scale(1)' }]);
  await Promise.resolve();
  animateModalNudge(shell, resolveModalMotion(null, {}, true));
  expect(effects).toHaveLength(2);
});
