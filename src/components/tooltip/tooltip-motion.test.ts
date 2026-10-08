/** Motion Kit token parity, option admission and isolated visual lifecycle qualification. */
import { expect, test } from 'bun:test';
import { TOOLTIP_MOTION_DEFAULTS, TOOLTIP_MOTION_EASING, TOOLTIP_MOTION_GEOMETRY, TOOLTIP_MOTION_TIMINGS, TOOLTIP_MOTION_TIMING_TOKENS, resolveTooltipMotion, validateTooltipMotionOptions } from './tooltip-motion';
import { cancelTooltipAnimations, captureTooltipVisualState, createTooltipSwingController, finishTooltipAnimations, playTooltipAnimation, playTooltipEnter, playTooltipExit } from './tooltip-motion-runtime';

test('Motion Kit CSS and runtime timings, curves and component geometry stay paired', async () => {
  const css = await Bun.file(new URL('../../frontend/styles/tooltip-tokens.css', import.meta.url)).text();
  for (const [key, value] of Object.entries(TOOLTIP_MOTION_TIMINGS)) {
    expect(css).toContain(`${TOOLTIP_MOTION_TIMING_TOKENS[key as keyof typeof TOOLTIP_MOTION_TIMINGS]}: ${value}ms;`);
  }
  for (const [name, curve] of Object.entries(TOOLTIP_MOTION_EASING)) expect(css).toContain(`--zero-tooltip-ease-${name}: ${curve};`);
  for (const [name, amount] of Object.entries(TOOLTIP_MOTION_GEOMETRY)) {
    const token = `--zero-tooltip-${name.replace(/[A-Z]/gu, letter => `-${letter.toLowerCase()}`)}`;
    const declaration = new RegExp(`${token}: ([^;]+);`, 'u').exec(css);
    expect(declaration).not.toBeNull(); expect(Number(declaration?.[1]?.replace(/px$/u, ''))).toBe(amount);
  }
  expect(css).toContain('--zero-tooltip-neutral-background: var(--popover);');
  expect(css).toContain('--zero-tooltip-accent-background: var(--primary);');
  expect(css).toContain('--zero-tooltip-light-background: var(--background);');
  expect(css).toContain('--zero-tooltip-neutral-background: var(--public-surface-raised);');
  expect(css).toContain('--zero-tooltip-max-width: 260px;');
  expect(css).toContain('--zero-tooltip-mono-max-width: 420px;');
  expect(css).not.toMatch(/#[\da-f]{3,8}\b/iu);
});

test('defaults are exact 400ms grow and neutral styling with an enabled arrow, including SSR', () => {
  const motion = resolveTooltipMotion(null, {}, false);
  expect(motion).toMatchObject({ motion: 'grow', durationMultiplier: 1, arrow: true, variant: 'neutral' });
  expect(motion.timings).toEqual(TOOLTIP_MOTION_TIMINGS);
  expect(motion.easing).toEqual(TOOLTIP_MOTION_EASING);
  expect(motion.geometry).toEqual(TOOLTIP_MOTION_GEOMETRY);
  for (const value of [TOOLTIP_MOTION_DEFAULTS, motion, motion.timings, motion.easing, motion.geometry]) expect(Object.isFrozen(value)).toBe(true);
});

test('speed is a duration multiplier and never changes hover intent or 120ms feedback', () => {
  const motion = resolveTooltipMotion(null, { durationMultiplier: 1.5 }, false);
  expect(motion.timings).toMatchObject({ growEnter: 600, growFade: 300, growExit: 300, springEnter: 1125,
    morphMove: 630, morphTextOut: 240, morphTextIn: 450, morphTextDelay: 120, openDelay: 450, warm: 450, grace: 70, ui: 120 });
  expect(resolveTooltipMotion(null, { durationMultiplier: .5 }, false).timings.growEnter).toBe(200);
  expect(resolveTooltipMotion(null, { durationMultiplier: 2.5 }, false).timings.growEnter).toBe(1000);
});

test('reduced motion is instant without unexpectedly removing the hover-intent delay', () => {
  const motion = resolveTooltipMotion(null, { durationMultiplier: 2.5, motion: 'swing' }, true);
  expect(motion.timings).toMatchObject({ growEnter: 1, growFade: 1, growExit: 1, springEnter: 1, blurEnter: 1, swingEnter: 1,
    morphMove: 1, morphTextOut: 1, morphTextIn: 1, morphTextDelay: 1, ui: 1, openDelay: 450, warm: 450, grace: 70 });
});

test('malformed options fail admission instead of leaking consumer values into errors', () => {
  for (const options of [null, [], 'grow', { motion: 'unknown' }, { variant: 'unknown' }, { arrow: 1 },
    ...[0, .49, 2.51, Infinity, Number.NaN, '1'].map(durationMultiplier => ({ durationMultiplier }))]) {
    expect(() => validateTooltipMotionOptions(options as never)).toThrow(TypeError);
  }
});

function themedElement(properties: Record<string, string>, supports: (property: string, value: string) => boolean = () => true): Element {
  return { ownerDocument: { defaultView: { getComputedStyle: () => ({ getPropertyValue: (name: string) => properties[name] ?? '' }),
    matchMedia: () => ({ matches: false }), CSS: { supports } } } } as unknown as Element;
}

test('inherited CSS settings resolve at the element and explicit consumer options win', () => {
  const element = themedElement({ '--zero-tooltip-motion': 'spring', '--zero-tooltip-variant': 'accent', '--zero-tooltip-arrow': 'false',
    '--zero-tooltip-duration-multiplier': '2', '--zero-tooltip-motion-grow-enter': '.6s', '--zero-tooltip-gap': '12px',
    '--zero-tooltip-ease-out': 'linear' });
  const theme = resolveTooltipMotion(element);
  expect(theme).toMatchObject({ motion: 'spring', variant: 'accent', arrow: false, durationMultiplier: 2 });
  expect(theme.timings.growEnter).toBe(1200); expect(theme.geometry.gap).toBe(12); expect(theme.easing.out).toBe('linear');
  const explicit = resolveTooltipMotion(element, { motion: 'grow', variant: 'light', arrow: true, durationMultiplier: 1 });
  expect(explicit).toMatchObject({ motion: 'grow', variant: 'light', arrow: true, durationMultiplier: 1 });
  expect(explicit.timings.growEnter).toBe(600);
});

test('sampled curves fall back only when the rendering engine lacks linear() support', () => {
  const element = themedElement({}, (_property, value) => !value.startsWith('linear('));
  const motion = resolveTooltipMotion(element, {}, false);
  expect(motion.easing.spring).toBe('cubic-bezier(.22,1.2,.36,1)');
  expect(motion.easing.bouncy).toBe('cubic-bezier(.34,1.56,.64,1)');
  expect(motion.easing.out).toBe(TOOLTIP_MOTION_EASING.out);
});

test('malformed theme values cannot produce infinite timing, scale or geometry', () => {
  const motion = resolveTooltipMotion(themedElement({ '--zero-tooltip-motion': 'broken', '--zero-tooltip-variant': 'broken',
    '--zero-tooltip-duration-multiplier': 'Infinity', '--zero-tooltip-motion-grow-enter': '9999999s', '--zero-tooltip-gap': '-9px',
    '--zero-tooltip-spring-scale': '999', '--zero-tooltip-blur': 'Infinitypx' }), {}, false);
  expect(motion).toMatchObject(TOOLTIP_MOTION_DEFAULTS); expect(motion.timings.growEnter).toBe(400);
  expect(motion.geometry).toEqual(TOOLTIP_MOTION_GEOMETRY);
});

class FakeAnimation {
  playState = 'running'; cancelled = false;
  readonly finished: Promise<void>; resolve!: () => void; reject!: () => void;
  constructor(readonly keyframes: Keyframe[], readonly options: KeyframeAnimationOptions) {
    this.finished = new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
  }
  cancel() { this.cancelled = true; this.playState = 'idle'; this.reject(); }
  finish() { if (this.playState !== 'idle') { this.playState = 'finished'; this.resolve(); } }
}

class FakeElement {
  isConnected = true; style = { transform: '', transformOrigin: '' }; animations: FakeAnimation[] = [];
  computed = { transform: 'none', opacity: '1', filter: 'none' };
  rect = { left: 100, top: 100, width: 40, height: 40 };
  raf = new Map<number, FrameRequestCallback>(); nextFrame = 0; now = 0;
  ownerDocument = { defaultView: {
    getComputedStyle: (element: FakeElement) => element.computed,
    performance: { now: () => this.now },
    requestAnimationFrame: (callback: FrameRequestCallback) => { const id = ++this.nextFrame; this.raf.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => this.raf.delete(id),
  } };
  getBoundingClientRect() { return this.rect; }
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) { const animation = new FakeAnimation(keyframes, options); this.animations.push(animation); return animation; }
  html() { return this as unknown as HTMLElement; }
  stepFrame() { this.now += 16; const batch = [...this.raf.values()]; this.raf.clear(); batch.forEach(callback => callback(this.now)); }
}
const normal = () => resolveTooltipMotion(null, {}, false);

test('grow uses independent exact 400ms scale and 200ms fade from the supplied arrow origin', async () => {
  const element = new FakeElement(); const enter = playTooltipEnter(element.html(), normal(), 'top', '38px 35px');
  expect(element.style.transformOrigin).toBe('38px 35px');
  expect(element.animations[0]?.keyframes).toEqual([{ transform: 'scale(0)', filter: 'none' }, { transform: 'none', filter: 'none' }]);
  expect(element.animations[0]?.options).toMatchObject({ duration: 400, easing: TOOLTIP_MOTION_EASING.out });
  expect(element.animations[1]?.options).toMatchObject({ duration: 200, easing: TOOLTIP_MOTION_EASING.out });
  enter.finish(); await enter.finished;
  const exit = playTooltipExit(element.html(), normal());
  expect(element.animations.at(-1)?.options).toMatchObject({ duration: 200, easing: TOOLTIP_MOTION_EASING.in, fill: 'forwards' });
  expect(element.animations.at(-1)?.keyframes[1]).toEqual({ opacity: '1', offset: .55 });
  expect(element.animations.at(-1)?.keyframes.at(-1)?.transform).toBe('scale(0)');
  exit.cancel(); await exit.finished;
});

test('all optional presets use exact reference entrance, fade and exit values', async () => {
  const profiles = [
    ['spring', 'scale(0.7)', 750, 220, 200, 'spring', 'scale(0.92)'],
    ['blur', 'translateY(8px) scale(0.96)', 500, null, 220, 'soft', undefined],
    ['swing', 'translateY(14px) scale(0.6)', 620, 200, 220, 'bouncy', 'translateY(8px) scale(0.8)'],
  ] as const;
  for (const [motion, transform, entrance, fade, exitMs, easing, exitTransform] of profiles) {
    const element = new FakeElement(); const resolved = resolveTooltipMotion(null, { motion }, false);
    const enter = playTooltipEnter(element.html(), resolved);
    expect(element.animations[0]?.keyframes[0]?.transform).toBe(transform);
    expect(element.animations[0]?.options).toMatchObject({ duration: entrance, easing: resolved.easing[easing] });
    if (fade) expect(element.animations[1]?.options.duration).toBe(fade);
    else expect(element.animations[0]?.keyframes[0]?.filter).toBe('blur(8px)');
    const exit = playTooltipExit(element.html(), resolved);
    expect(element.animations.at(-1)?.options.duration).toBe(exitMs);
    expect(element.animations.at(-1)?.keyframes.at(-1)?.transform).toBe(exitTransform);
    if (motion === 'blur') expect(element.animations.at(-1)?.keyframes.at(-1)?.filter).toBe('blur(6px)');
    exit.cancel(); await enter.finished; await exit.finished;
  }
});

test('blur nudges and swing travel respect the actual flipped side', () => {
  const blur = resolveTooltipMotion(null, { motion: 'blur' }, false);
  const swing = resolveTooltipMotion(null, { motion: 'swing' }, false);
  for (const [side, transform] of [['top', 'translateY(8px)'], ['bottom', 'translateY(-8px)'], ['left', 'translateX(8px)'], ['right', 'translateX(-8px)']] as const) {
    const element = new FakeElement(); const handle = playTooltipEnter(element.html(), blur, side);
    expect(element.animations[0]?.keyframes[0]?.transform).toBe(`${transform} scale(0.96)`); handle.cancel();
  }
  const element = new FakeElement(); const enter = playTooltipEnter(element.html(), swing, 'bottom');
  expect(element.animations[0]?.keyframes[0]?.transform).toBe('translateY(-14px) scale(0.6)');
  const exit = playTooltipExit(element.html(), swing, 'bottom');
  expect(element.animations.at(-1)?.keyframes.at(-1)?.transform).toBe('translateY(-8px) scale(0.8)'); enter.cancel(); exit.cancel();
});

test('interruptions capture composed pose before cancellation and old handles cannot retire replacements', async () => {
  const element = new FakeElement(); const old = playTooltipEnter(element.html(), normal());
  element.computed = { transform: 'matrix(0.3,0,0,0.3,0,0)', opacity: '.4', filter: 'none' };
  expect(captureTooltipVisualState(element.html())).toEqual(element.computed);
  const exit = playTooltipExit(element.html(), normal());
  expect(element.animations.at(-1)?.keyframes[0]).toMatchObject(element.computed);
  element.computed = { transform: 'matrix(0.2,0,0,0.2,0,0)', opacity: '.15', filter: 'none' };
  const reopened = playTooltipEnter(element.html(), normal());
  expect(element.animations.at(-2)?.keyframes[0]?.transform).toBe(element.computed.transform);
  expect(element.animations.at(-1)?.keyframes[0]?.opacity).toBe('.15');
  old.cancel(); exit.cancel(); expect(element.animations.at(-1)?.cancelled).toBe(false);
  reopened.finish(); await old.finished; await exit.finished; await reopened.finished;
});

test('explicit shared-host resume poses preserve independent exact grow transform and fade timings', async () => {
  const element = new FakeElement();
  const pose = { transform: 'matrix(0.3,0,0,0.3,0,0)', opacity: '.4', filter: 'none' };
  const resumed = playTooltipEnter(element.html(), normal(), 'top', undefined, pose);
  expect(element.animations[0]?.keyframes[0]).toMatchObject({ transform: pose.transform });
  expect(element.animations[1]?.keyframes[0]).toMatchObject({ opacity: pose.opacity });
  expect(element.animations[0]?.options.duration).toBe(400);
  expect(element.animations[1]?.options.duration).toBe(200);
  resumed.finish(); await resumed.finished;
});

test('owned cancellation and finishing preserve consumer-created animations', async () => {
  const element = new FakeElement(); const consumer = element.animate([{ opacity: .5 }, { opacity: 1 }], { duration: 100 });
  const owned = playTooltipAnimation(element.html(), [{ transform: 'none' }, { transform: 'translateX(10px)' }], { duration: 100, fill: 'forwards' }) as unknown as FakeAnimation;
  finishTooltipAnimations(element.html()); expect(owned.playState).toBe('finished'); expect(consumer.playState).toBe('running');
  cancelTooltipAnimations(element.html()); expect(owned.cancelled).toBe(true); expect(consumer.cancelled).toBe(false);
  consumer.finish(); await owned.finished;
});

test('reduced playback suppresses travel, blur and overshoot and safely handles missing WAAPI', async () => {
  const element = new FakeElement(); const reduced = resolveTooltipMotion(null, { motion: 'swing' }, true);
  const enter = playTooltipEnter(element.html(), reduced);
  expect(element.animations).toHaveLength(1); expect(element.animations[0]?.options.duration).toBe(1);
  expect(element.animations[0]?.keyframes[0]).toMatchObject({ transform: 'none', opacity: 1, filter: 'none' });
  const exit = playTooltipExit(element.html(), reduced); expect(element.animations.at(-1)?.options.duration).toBe(1);
  exit.finish(); await enter.finished; await exit.finished;
  const plain = { ownerDocument: element.ownerDocument, style: element.style } as unknown as HTMLElement;
  await playTooltipEnter(plain, normal()).finished; await playTooltipExit(plain, normal()).finished;
});

test('swing uses the reference physics but retires its frame loop when settled or stopped', () => {
  const element = new FakeElement(); const trigger = new FakeElement(); trigger.ownerDocument = element.ownerDocument;
  const swing = createTooltipSwingController(element.html(), resolveTooltipMotion(null, { motion: 'swing' }, false));
  expect(element.raf.size).toBe(0); swing.track(trigger.html(), 140); expect(element.raf.size).toBe(1);
  element.stepFrame(); expect(element.style.transform).toMatch(/translateX\([\d.]+px\) rotate\([\d.]+deg\)/u);
  for (let frame = 0; frame < 600; frame++) element.stepFrame();
  expect(element.raf.size).toBe(0); expect(element.style.transform).toBe('translateX(16.00px) rotate(18.00deg)');
  swing.track(trigger.html(), 100); expect(element.raf.size).toBe(1); swing.stop(); expect(element.raf.size).toBe(0);
  swing.reset(); expect(element.style.transform).toBe('');
});

test('swing never starts on reduced motion, stale triggers, other documents or invalid cursor geometry', () => {
  const element = new FakeElement(); const trigger = new FakeElement(); trigger.ownerDocument = element.ownerDocument;
  const reduced = createTooltipSwingController(element.html(), resolveTooltipMotion(null, { motion: 'swing' }, true));
  reduced.track(trigger.html(), 140); expect(element.raf.size).toBe(0);
  const swing = createTooltipSwingController(element.html(), normal());
  trigger.isConnected = false; swing.track(trigger.html(), 140); expect(element.raf.size).toBe(0);
  trigger.isConnected = true; trigger.rect.width = 0; swing.track(trigger.html(), 140); expect(element.raf.size).toBe(0);
  trigger.rect.width = 40; swing.track(trigger.html(), Number.NaN); expect(element.raf.size).toBe(0);
  trigger.ownerDocument = new FakeElement().ownerDocument; swing.track(trigger.html(), 140); expect(element.raf.size).toBe(0);
  swing.reset();
});
