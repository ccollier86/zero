/** Small DOM-free Morph Select geometry/physics; Radix remains the position owner. */
export interface SelectSpring { value: number; velocity: number; target: number }
export interface SelectRect { left: number; top: number; width: number; height: number }
export type SelectClip = readonly [number, number, number, number, number];

export function selectMotionTime(value: string, fallback: number): number {
  const match = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/u.exec(value.trim());
  const result = match ? Number(match[1]) * (match[2] === 's' ? 1000 : 1) : NaN;
  return Number.isFinite(result) && result <= 60_000 ? result : fallback;
}

/** Arc's visual-duration calibration, integrated analytically to avoid frame-rate instability. */
export function stepSelectSpring(state: SelectSpring, duration: number, bounce: number, seconds: number): boolean {
  if (duration <= 0) { state.value = state.target; state.velocity = 0; return false; }
  const dt = Math.max(0, Math.min(.05, seconds)), w = 2 * Math.PI / (duration / 1000 * 1.2);
  const z = 1 - Math.max(0, Math.min(.5, Number.isFinite(bounce) ? bounce : 0));
  const x = state.value - state.target, v = state.velocity, decay = Math.exp(-z * w * dt);
  if (z === 1) {
    const b = v + w * x;
    state.value = state.target + decay * (x + b * dt);
    state.velocity = decay * (v - w * b * dt);
  } else {
    const a = w * Math.sqrt(1 - z * z), b = (v + z * w * x) / a;
    const c = Math.cos(a * dt), s = Math.sin(a * dt), y = x * c + b * s;
    state.value = state.target + decay * y;
    state.velocity = decay * (-z * w * y - x * a * s + b * a * c);
  }
  if (Math.abs(state.value - state.target) < .05 && Math.abs(state.velocity) < .05) {
    state.value = state.target; state.velocity = 0; return false;
  }
  return true;
}

/** The trigger-facing inset stays within the actual collision-resolved content bounds. */
export function selectTriggerClip(content: SelectRect, trigger: SelectRect, radius: number): SelectClip {
  const left = Math.max(0, Math.min(content.width, trigger.left - content.left));
  const top = Math.max(0, Math.min(content.height, trigger.top - content.top));
  const right = Math.max(left, Math.min(content.width, trigger.left + trigger.width - content.left));
  const bottom = Math.max(top, Math.min(content.height, trigger.top + trigger.height - content.top));
  return [top, content.width - right, content.height - bottom, left, Math.max(0, radius)];
}

/** DOMRects include ancestor scale; CSS geometry is expressed in unscaled layout pixels. */
export function selectLocalTriggerClip(content: SelectRect, trigger: SelectRect, radius: number, scaleX: number, scaleY: number): SelectClip {
  const sx = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1, sy = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;
  return selectTriggerClip({ left: content.left / sx, top: content.top / sy, width: content.width / sx, height: content.height / sy },
    { left: trigger.left / sx, top: trigger.top / sy, width: trigger.width / sx, height: trigger.height / sy }, radius);
}

/** Collision can move the live panel away from the trigger. Paint may translate back without changing Radix's live position. */
export function selectDepartureTarget(content: SelectRect, trigger: SelectRect, radius: number, sx: number, sy: number) {
  const width = content.width / sx, height = content.height / sy;
  const w = Math.min(width, trigger.width / sx), h = Math.min(height, trigger.height / sy);
  const left = Math.max(0, Math.min(width - w, (trigger.left - content.left) / sx));
  const top = Math.max(0, Math.min(height - h, (trigger.top - content.top) / sy));
  return { clip: [top, width - left - w, height - top - h, left, radius] as SelectClip,
    x: (trigger.left - content.left) / sx - left, y: (trigger.top - content.top) / sy - top };
}

/**
 * Close-paint handoff is geometric, not a wait for imperceptible spring velocity.
 * Compare painted edges in viewport pixels, including collision translation and
 * scaled portals. Opening/highlight springs keep their precise physics contract.
 */
export function selectDepartureLanded(clip: readonly SelectSpring[], translation: readonly SelectSpring[], sx: number, sy: number,
  tolerance = .5): boolean {
  const delta = (state: SelectSpring) => state.value - state.target;
  const x = delta(translation[0]!), y = delta(translation[1]!);
  return Math.max(Math.abs(x + delta(clip[3]!)) * sx, Math.abs(x - delta(clip[1]!)) * sx,
    Math.abs(y + delta(clip[0]!)) * sy, Math.abs(y - delta(clip[2]!)) * sy,
    Math.abs(delta(clip[4]!)) * Math.max(sx, sy)) <= tolerance;
}

export function selectClipCss(clip: SelectClip): string {
  return `inset(${clip.slice(0, 4).map(value => `${Math.max(0, value).toFixed(3)}px`).join(' ')} round ${Math.max(0, clip[4]).toFixed(3)}px)`;
}

/** Parse only our own computed pixel inset recipe; arbitrary consumer shapes are never interpreted. */
export function readSelectClip(value: string): SelectClip | null {
  const match = /^inset\(([-\d.]+)px ([-\d.]+)px ([-\d.]+)px ([-\d.]+)px round ([-\d.]+)px\)$/u.exec(value);
  if (!match) return null;
  const numbers = match.slice(1).map(Number);
  return numbers.every(Number.isFinite) ? numbers as unknown as SelectClip : null;
}
