'use client';

/** Table-only odometer presentation. Owns interruptible digit motion, never counts, fetching, or navigation. */
import * as React from 'react';
import { useReducedMotion } from 'motion/react';
import { cn } from '#zero/lib/utils';
import { DATA_TABLE_MOTION } from './data-table-motion-tokens';

interface DigitMotion { generation: number; animations: Animation[] }
const digits = new WeakMap<HTMLElement, DigitMotion>();
const useLayout = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

/** Cancel this slot's own animations, not other table or caller-owned motion. */
function stopDigit(slot: HTMLElement) {
  const state = digits.get(slot);
  if (state) { state.generation++; for (const animation of state.animations) animation.cancel(); state.animations = []; }
}

/** Apply the reference's 75% travel and rightmost-first carries, continuing an interrupted incoming digit in place. */
export function updateDataTableRollingNumber(element: HTMLElement, value: number, previous: number | null,
  instant: boolean, durationFactor = 1) {
  const factor = Number.isFinite(durationFactor) && durationFactor > 0 ? durationFactor : 1;
  const text = value.toLocaleString('en-US');
  const slots = [...element.children] as HTMLElement[];
  while (slots.length < text.length) {
    const slot = document.createElement('span'); slot.dataset.slot = 'data-table-digit';
    element.prepend(slot); slots.unshift(slot);
  }
  while (slots.length > text.length) { const slot = slots.shift()!; stopDigit(slot); slot.remove(); }
  const direction = previous !== null && value < previous ? -1 : 1;
  slots.forEach((slot, index) => {
    const current = slot.lastElementChild as HTMLElement | null;
    if (!instant && current?.textContent === text[index]) return;
    const pose = current && !instant ? getComputedStyle(current) : null;
    const transform = pose?.transform ?? 'none', opacity = pose?.opacity ?? '1';
    stopDigit(slot);
    for (const child of [...slot.children]) if (child !== current) child.remove();
    if (current?.textContent === text[index]) { current.style.transform = ''; current.style.opacity = ''; return; }
    const incoming = document.createElement('span'); incoming.textContent = text[index]!; slot.append(incoming);
    if (instant || typeof incoming.animate !== 'function') { current?.remove(); return; }
    const state = digits.get(slot) ?? { generation: 0, animations: [] };
    digits.set(slot, state); const generation = state.generation;
    const delay = (text.length - 1 - index) * DATA_TABLE_MOTION.carryStagger * factor;
    if (current) {
      current.style.transform = transform; current.style.opacity = opacity;
      const outgoing = current.animate([{ transform, opacity },
        { transform: `translateY(${-direction * 75}%)`, opacity: 0 }],
      { duration: DATA_TABLE_MOTION.fast * factor, delay, easing: DATA_TABLE_MOTION.ease, fill: 'forwards' });
      outgoing.onfinish = () => { if (state.generation === generation) current.remove(); };
      state.animations.push(outgoing);
    }
    state.animations.push(incoming.animate([{ transform: `translateY(${direction * 75}%)`, opacity: 0 },
      { transform: 'none', opacity: 1 }],
    { duration: DATA_TABLE_MOTION.odo * factor, delay, easing: DATA_TABLE_MOTION.ease, fill: 'backwards' }));
  });
}

export interface DataTableRollingNumberProps {
  value: number;
  motionEnabled?: boolean;
  durationFactor?: number;
  className?: string;
}

/** Render the initial value without animation; caller supplies the accessible sentence around this visual-only number. */
export function DataTableRollingNumber({ value, motionEnabled = true, durationFactor = 1,
  className }: DataTableRollingNumberProps) {
  const reduced = useReducedMotion();
  const initial = React.useRef(value.toLocaleString('en-US'));
  const previous = React.useRef<number | null>(null);
  const element = React.useRef<HTMLSpanElement>(null);
  useLayout(() => {
    if (!element.current) return;
    updateDataTableRollingNumber(element.current, value, previous.current,
      previous.current === null || !motionEnabled || Boolean(reduced), durationFactor);
    previous.current = value;
  }, [value, motionEnabled, durationFactor, reduced]);
  useLayout(() => { const node = element.current; return () => {
    for (const slot of [...(node?.children ?? [])]) stopDigit(slot as HTMLElement);
  }; }, []);
  return <span ref={element} aria-hidden="true" data-slot="data-table-rolling-number" data-value={value}
    className={cn('data-table-rolling-number', className)}>{[...initial.current].map((character, index) => (
      <span data-slot="data-table-digit" key={index}><span>{character}</span></span>
    ))}</span>;
}
