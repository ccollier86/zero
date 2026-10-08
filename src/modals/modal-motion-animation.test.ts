/** Fake-animation lifecycle qualification without running an app or network transport. */
import { expect, test } from 'bun:test';
import { animateModalIn, animateModalOut, modalOriginTransform, usableModalTrigger } from './modal-motion-animation';
import { resolveModalMotion } from './modal-motion';
import { createModalSceneMotion, modalStackTransform } from './modal-scene-motion';

class FakeStyle {
  values = new Map<string, { value: string; priority: string }>();
  getPropertyValue(name: string) { return this.values.get(name)?.value ?? ''; }
  getPropertyPriority(name: string) { return this.values.get(name)?.priority ?? ''; }
  setProperty(name: string, value: string, priority = '') { this.values.set(name, { value, priority }); }
  removeProperty(name: string) { this.values.delete(name); }
  get opacity() { return this.getPropertyValue('opacity'); } set opacity(v: string) { this.setProperty('opacity', v); }
  get transform() { return this.getPropertyValue('transform'); } set transform(v: string) { this.setProperty('transform', v); }
  get borderRadius() { return this.getPropertyValue('border-radius'); } set borderRadius(v: string) { this.setProperty('border-radius', v); }
  get transformOrigin() { return this.getPropertyValue('transform-origin'); } set transformOrigin(v: string) { this.setProperty('transform-origin', v); }
  get overflow() { return this.getPropertyValue('overflow'); } set overflow(v: string) { this.setProperty('overflow', v); }
  get willChange() { return this.getPropertyValue('will-change'); } set willChange(v: string) { this.setProperty('will-change', v); }
}

class FakeAnimation {
  playState = 'running'; cancelled = false;
  finished: Promise<void>; resolve!: () => void; reject!: () => void;
  constructor(readonly keyframes: Keyframe[], readonly options: KeyframeAnimationOptions) {
    this.finished = new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
  }
  cancel() { this.cancelled = true; this.playState = 'idle'; this.reject(); }
  finish() { if (this.playState !== 'idle') { this.playState = 'finished'; this.resolve(); } }
}

const fakeDocument = { documentElement: { clientWidth: 1200, clientHeight: 900 }, defaultView: {
  innerWidth: 1200, innerHeight: 900, CSS: { supports: () => true },
  getComputedStyle: (el: FakeElement) => ({ ...el.computed,
    opacity: el.computed.opacity ?? el.style.opacity ?? '1', transform: el.computed.transform ?? el.style.transform ?? 'none',
    borderRadius: el.computed.borderRadius ?? el.style.borderRadius ?? '14px', getPropertyValue: () => '' }),
} };

class FakeElement {
  isConnected = true; ownerDocument = fakeDocument; style = new FakeStyle();
  computed: Record<string, string> = { display: 'block', visibility: 'visible', opacity: '1', transform: 'none', filter: 'none', borderRadius: '14px' };
  rect = { left: 100, top: 100, width: 560, height: 300 };
  animations: FakeAnimation[] = [];
  getBoundingClientRect() { return this.rect; }
  animate(frames: Keyframe[], options: KeyframeAnimationOptions) { const animation = new FakeAnimation(frames, options); this.animations.push(animation); return animation; }
  html() { return this as unknown as HTMLElement; }
}
const normal = () => resolveModalMotion(null, {}, false);
const finish = (...elements: FakeElement[]) => elements.forEach(element => element.animations.forEach(animation => animation.finish()));

test('programmatic origin resolves to rise, and its exit cannot later turn into origin', async () => {
  const shell = new FakeElement(); const inner = new FakeElement(); const trigger = new FakeElement();
  const entered = animateModalIn(shell.html(), inner.html(), null, normal());
  expect(entered.entrance).toBe('rise');
  expect(shell.animations[0]?.options).toMatchObject({ duration: 900, easing: normal().easing.spring });
  expect(shell.animations[0]?.keyframes[0]).toEqual({ transform: 'translateY(18px) scale(0.98)' });
  const exit = animateModalOut(shell.html(), inner.html(), trigger.html(), normal(), entered.entrance);
  expect(exit.entrance).toBe('rise'); expect(shell.animations.at(-1)?.options.duration).toBe(390);
  expect(shell.animations.at(-1)?.keyframes.at(-1)?.transform).toBe('translateY(10px) scale(0.98)');
  finish(shell, inner); await exit.finished;
});

test('origin entrance and exit preserve tuned concurrent shell/inner timings and offset', async () => {
  const shell = new FakeElement(); const inner = new FakeElement(); const trigger = new FakeElement();
  trigger.rect = { left: 20, top: 40, width: 80, height: 32 }; trigger.computed.borderRadius = '8px';
  const entered = animateModalIn(shell.html(), inner.html(), trigger.html(), normal());
  expect(entered.entrance).toBe('origin');
  expect(shell.animations[0]?.options.duration).toBe(975); expect(shell.animations[1]?.options.duration).toBe(210);
  expect(inner.animations[0]?.options).toMatchObject({ duration: 330, delay: 240, fill: 'backwards' });
  expect(shell.animations[0]?.keyframes[0]?.borderRadius).toBe('8px');
  const exit = animateModalOut(shell.html(), inner.html(), trigger.html(), normal(), entered.entrance);
  expect(inner.animations.at(-1)?.options).toMatchObject({ duration: 180, fill: 'forwards' });
  expect(inner.animations.at(-1)?.options.delay).toBeUndefined();
  expect(shell.animations.at(-1)?.options.duration).toBe(570);
  expect(shell.animations.at(-1)?.keyframes[1]).toMatchObject({ opacity: .9, offset: .85, borderRadius: '8px' });
  finish(shell, inner); await exit.finished;
});

test('lost, hidden, zero, nonfinite, offscreen and cross-document triggers use rise', () => {
  const shell = new FakeElement(); const trigger = new FakeElement();
  expect(usableModalTrigger(trigger.html(), shell.html())).toBe(true);
  expect(modalOriginTransform(trigger.html(), shell.html())).toContain('scale(1, 1)');
  for (const adjust of [() => { trigger.isConnected = false; }, () => { trigger.computed.display = 'none'; },
    () => { trigger.computed.opacity = '0'; }, () => { trigger.rect.width = 0; }, () => { trigger.rect.width = Infinity; },
    () => { trigger.rect.left = -10000; }, () => { trigger.ownerDocument = { ...fakeDocument }; }]) {
    trigger.isConnected = true; trigger.computed.display = 'block'; trigger.computed.opacity = '1';
    trigger.rect = { left: 100, top: 100, width: 560, height: 300 }; trigger.ownerDocument = fakeDocument;
    adjust(); expect(usableModalTrigger(trigger.html(), shell.html())).toBe(false);
  }
  trigger.isConnected = false;
  const exit = animateModalOut(shell.html(), null, trigger.html(), normal(), 'origin');
  expect(exit.entrance).toBe('rise'); expect(shell.animations.at(-1)?.options.duration).toBe(390); exit.cancel();
});

test('quick fade is 270ms regardless of requested entrance', () => {
  const shell = new FakeElement(); const exit = animateModalOut(shell.html(), null, null, resolveModalMotion(null, { exit: 'fade' }, false), 'origin');
  expect(shell.animations[0]?.options).toMatchObject({ duration: 270, easing: normal().easing.out });
  expect(shell.animations[0]?.keyframes.at(-1)).toMatchObject({ opacity: 0, transform: 'scale(0.98)' }); exit.cancel();
});

test('all optional entrances preserve exact transform/fade/paired-exit timings and curves', () => {
  const profiles = [
    ['rise', 'translateY(18px) scale(0.98)', 600, 260, 260, 'spring'],
    ['grow', 'scale(0.86)', 500, 240, 240, 'out'],
    ['spring', 'scale(0.72)', 700, 200, 220, 'bouncy'],
    ['focus', 'scale(1.06)', 560, 300, 260, 'soft'],
    ['drop', 'translateY(-36px)', 600, 240, 240, 'spring'],
  ] as const;
  for (const [entrance, transform, enterMs, fadeMs, exitMs, curve] of profiles) {
    const shell = new FakeElement(); const motion = resolveModalMotion(null, { entrance, durationMultiplier: 1 }, false);
    const enter = animateModalIn(shell.html(), null, null, motion);
    expect(shell.animations[0]?.keyframes[0]?.transform).toBe(transform);
    expect(shell.animations[0]?.options).toMatchObject({ duration: enterMs, easing: motion.easing[curve] });
    expect(shell.animations[1]?.options).toMatchObject({ duration: fadeMs, easing: motion.easing.out });
    if (entrance === 'focus') expect(shell.animations[0]?.keyframes[0]?.filter).toBe('blur(12px)');
    const exit = animateModalOut(shell.html(), null, null, motion, enter.entrance);
    expect(shell.animations.at(-1)?.options).toMatchObject({ duration: exitMs, easing: motion.easing.in });
    if (entrance === 'focus') expect(shell.animations.at(-1)?.keyframes.at(-1)?.filter).toBe('blur(8px)');
    exit.cancel();
  }
});

test('closing midway through origin opacity never flashes brighter while flying back', () => {
  const shell = new FakeElement(); const trigger = new FakeElement(); shell.computed.opacity = '.2';
  const exit = animateModalOut(shell.html(), null, trigger.html(), normal(), 'origin');
  expect(shell.animations.at(-1)?.keyframes[1]?.opacity).toBe(.2); exit.cancel();
});

test('interrupted origin exit measures final unanimated shell bounds after capturing/cancelling entry', () => {
  const shell = new FakeElement(); const trigger = new FakeElement();
  trigger.rect = { left: 20, top: 40, width: 80, height: 32 };
  const base = shell.rect;
  shell.getBoundingClientRect = () => shell.animations.some(animation => animation.playState === 'running')
    ? { left: 20, top: 40, width: 140, height: 75 } : base;
  const entered = animateModalIn(shell.html(), null, trigger.html(), normal());
  shell.computed.transform = 'matrix(0.25, 0, 0, 0.25, -80, -40)';
  const exit = animateModalOut(shell.html(), null, trigger.html(), normal(), entered.entrance);
  expect(shell.animations.at(-1)?.keyframes[0]?.transform).toBe('matrix(0.25, 0, 0, 0.25, -80, -40)');
  expect(shell.animations.at(-1)?.keyframes.at(-1)?.transform).toBe('translate(-320px, -194px) scale(0.14285714285714285, 0.10666666666666667)');
  exit.cancel();
});

test('interrupted exit starts from current composited transform/opacity, and old handles cannot cancel replacements', async () => {
  const shell = new FakeElement(); const old = animateModalIn(shell.html(), null, null, normal());
  shell.computed.transform = 'matrix(1, 0, 0, 1, 0, 7)'; shell.computed.opacity = '.4';
  const replacement = animateModalOut(shell.html(), null, null, normal(), old.entrance);
  expect(shell.animations.at(-1)?.keyframes[0]).toMatchObject({ transform: 'matrix(1, 0, 0, 1, 0, 7)', opacity: '.4' });
  old.cancel(); expect(shell.animations.at(-1)?.cancelled).toBe(false);
  finish(shell); await old.finished; await replacement.finished;
});

test('reduced entrance/exit are 1ms and suppress origin travel/blur/overshoot', async () => {
  const shell = new FakeElement(); const inner = new FakeElement(); const trigger = new FakeElement();
  const reduced = resolveModalMotion(null, {}, true);
  const enter = animateModalIn(shell.html(), inner.html(), trigger.html(), reduced);
  expect(shell.animations[0]?.options.duration).toBe(1); expect(inner.animations).toHaveLength(0);
  expect(shell.animations[0]?.keyframes[0]).toMatchObject({ transform: 'none', filter: 'none', opacity: 1 });
  const exit = animateModalOut(shell.html(), inner.html(), trigger.html(), reduced, enter.entrance);
  expect(shell.animations.at(-1)?.options.duration).toBe(1); finish(shell); await exit.finished;
});

test('stack transform is separate and bounds nonfinite/extreme depth', () => {
  expect(modalStackTransform(1, normal())).toBe('translateY(-12px) scale(0.96)');
  expect(modalStackTransform(Infinity, normal())).toBe('translateY(0px) scale(1)');
  expect(modalStackTransform(999, normal())).toBe('translateY(-72px) scale(0.76)');
});

test('scene cleanup waits for the longer 630ms restore and keeps exact prior inline priorities', async () => {
  const backdrop = new FakeElement(); const surface = new FakeElement();
  surface.style.setProperty('transform', 'rotate(1deg)', 'important'); surface.computed.transform = 'rotate(1deg)';
  surface.style.overflow = 'auto'; surface.style.willChange = 'opacity';
  const scene = createModalSceneMotion(backdrop.html(), surface.html());
  const entered = scene.update({ visible: true, recedes: true, motion: normal() });
  expect(surface.animations[0]?.options.duration).toBe(900); expect(surface.style.transform).toBe('rotate(1deg) scale(0.965)');
  finish(backdrop, surface); await entered;
  const exiting = scene.update({ visible: false, recedes: false, motion: normal() });
  const repeat = scene.update({ visible: false, recedes: false, motion: normal() });
  expect(repeat).toBe(exiting); expect(surface.style.overflow).toBe('hidden');
  expect(surface.animations.at(-1)?.options.duration).toBe(630);
  finish(backdrop, surface); await exiting;
  expect(surface.style.transform).toBe('rotate(1deg)'); expect(surface.style.getPropertyPriority('transform')).toBe('important');
  expect(surface.style.overflow).toBe('auto'); expect(surface.style.willChange).toBe('opacity'); scene.dispose();
});

test('scene stale restore cannot clear a newly receding surface', async () => {
  const backdrop = new FakeElement(); const surface = new FakeElement(); const scene = createModalSceneMotion(backdrop.html(), surface.html());
  const entered = scene.update({ visible: true, recedes: true, motion: normal() }); finish(backdrop, surface); await entered;
  const oldExit = scene.update({ visible: false, recedes: false, motion: normal() });
  const reopened = scene.update({ visible: true, recedes: true, motion: normal() });
  await oldExit; expect(surface.style.transform).toBe('scale(0.965)'); expect(surface.style.overflow).toBe('hidden');
  finish(backdrop, surface); await reopened; scene.dispose(); expect(surface.style.transform).toBe(''); expect(surface.style.overflow).toBe('');
});

test('plain hosts can dim/blur without registering or transforming the body', async () => {
  const backdrop = new FakeElement(); const scene = createModalSceneMotion(backdrop.html());
  const update = scene.update({ visible: true, recedes: true, motion: normal() });
  expect(backdrop.style.getPropertyValue('backdrop-filter')).toBe('blur(6px)'); expect(backdrop.animations[0]?.options.duration).toBe(480);
  finish(backdrop); await update; scene.dispose(); expect(backdrop.style.opacity).toBe('');
});

test('host-derived recession demand survives a top modal that disables its own page recession', async () => {
  const backdrop = new FakeElement(); const surface = new FakeElement();
  const scene = createModalSceneMotion(backdrop.html(), surface.html());
  const motion = resolveModalMotion(null, { pageRecedes: false }, false);
  const settled = scene.update({ visible: true, recedes: true, motion });
  expect(surface.style.transform).toBe('scale(0.965)');
  expect(surface.animations.at(-1)?.options.duration).toBe(900);
  finish(backdrop, surface); await settled; scene.dispose();
  expect(surface.style.transform).toBe('');
});

test('rapid close/reopen then reduced preference removal restores full scene durations and original styles', async () => {
  const backdrop = new FakeElement(); const surface = new FakeElement();
  surface.style.overflow = 'auto';
  const scene = createModalSceneMotion(backdrop.html(), surface.html());
  const entered = scene.update({ visible: true, recedes: true, motion: normal() });
  finish(backdrop, surface); await entered;
  const closing = scene.update({ visible: false, recedes: false, motion: normal() });
  const reduced = scene.update({ visible: true, recedes: true, motion: resolveModalMotion(null, {}, true) });
  expect(surface.animations.at(-1)?.options.duration).toBe(1);
  finish(backdrop, surface); await closing; await reduced;
  expect(surface.style.overflow).toBe('auto');
  const resumed = scene.update({ visible: true, recedes: true, motion: normal() });
  expect(surface.animations.at(-1)?.options.duration).toBe(900);
  expect(backdrop.animations.at(-1)?.options.duration).toBe(480);
  finish(backdrop, surface); await resumed;
  const restored = scene.update({ visible: false, recedes: false, motion: normal() });
  expect(surface.animations.at(-1)?.options.duration).toBe(630);
  finish(backdrop, surface); await restored; scene.dispose();
  expect(surface.style.overflow).toBe('auto');
  expect(surface.style.transform).toBe('');
});

test('settled normal close then reduced open/close never awaits a cancelled idle finished promise', async () => {
  const backdrop = new FakeElement(); const surface = new FakeElement();
  surface.style.overflow = 'auto';
  const scene = createModalSceneMotion(backdrop.html(), surface.html());
  const entered = scene.update({ visible: true, recedes: true, motion: normal() });
  finish(backdrop, surface); await entered;
  const closed = scene.update({ visible: false, recedes: false, motion: normal() });
  finish(backdrop, surface); await closed;
  const previous = surface.animations.at(-1)!;
  const oldFinished = previous.finished;
  const idleFinished = new Promise<void>(() => {});
  // Native Animation.finished is reset after cancel(), even when the old
  // finished promise had already resolved. Reading it now cannot settle.
  Object.defineProperty(previous, 'finished', { get: () => previous.playState === 'idle' ? idleFinished : oldFinished });
  const reduced = resolveModalMotion(null, {}, true);
  const reducedOpen = scene.update({ visible: true, recedes: true, motion: reduced });
  expect(previous.playState).toBe('idle'); finish(backdrop); await reducedOpen;
  const reducedClose = scene.update({ visible: false, recedes: false, motion: reduced });
  finish(backdrop); await reducedClose;
  expect(surface.style.overflow).toBe('auto'); expect(surface.style.transform).toBe('');
  const restoredPace = scene.update({ visible: true, recedes: true, motion: normal() });
  expect(surface.animations.at(-1)?.options.duration).toBe(900);
  finish(backdrop, surface); await restoredPace; scene.dispose();
}, 1000);
