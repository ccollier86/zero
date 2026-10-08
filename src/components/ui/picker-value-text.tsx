'use client';

/**
 * picker-value-text.tsx
 *
 * Owns the private date/time label roller shared by Zero's pickers. It consumes
 * calendar motion tokens and never parses, changes, or submits field values.
 */

import * as React from 'react';
import { resolveCalendarMotion } from './calendar-motion';
import { useMediaQuery } from '../../hooks/use-media-query';

interface PickerValueTextProps {
  readonly parts: readonly { readonly type: string; readonly value: string }[];
  readonly identity: number | string | undefined;
  readonly animate?: boolean;
}

/** Keep unchanged label segments still while changed values move with time. */
export function PickerValueText({ parts, identity, animate = true }: PickerValueTextProps) {
  const previous = React.useRef(identity);
  const direction = React.useRef(0);
  if (previous.current !== identity) {
    direction.current = previous.current == null || identity == null ? 0 : identity > previous.current ? 1 : -1;
    previous.current = identity;
  }
  return <span data-slot="picker-value-text" aria-hidden="true" className="inline-flex min-w-0 whitespace-pre tabular-nums">
    {parts.map((part, index) => <ValuePart key={`${index}:${part.type}`} text={part.value}
      direction={part.type === 'literal' || !animate ? 0 : direction.current} />)}
  </span>;
}

function ValuePart({ text, direction }: { text: string; direction: number }) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const ref = React.useRef<HTMLSpanElement>(null);
  const before = React.useRef(text);
  React.useLayoutEffect(() => {
    const current = ref.current;
    const oldText = before.current;
    before.current = text;
    if (!current || oldText === text) return;
    const parent = current.parentElement!;
    const sampled = getComputedStyle(current);
    const opacity = sampled.opacity;
    const transform = sampled.transform;
    current.getAnimations().forEach(animation => animation.cancel());
    parent.querySelector('[data-picker-previous]')?.remove();
    if (reduced || !direction || typeof current.animate !== 'function') return;
    const motion = resolveCalendarMotion(current);
    if (motion.spring <= 1) return;
    const old = current.cloneNode(false) as HTMLSpanElement;
    old.textContent = oldText;
    old.dataset.pickerPrevious = '';
    Object.assign(old.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    parent.append(old);
    const leave = old.animate([
      { opacity, transform: transform === 'none' ? 'none' : transform },
      { opacity: 0, transform: `translateY(${-direction * 0.32}em)` },
    ], { duration: motion.fast + 40, easing: motion.easeStandard, fill: 'forwards' });
    leave.onfinish = () => old.remove();
    current.animate([{ transform: `translateY(${direction * 0.35}em)` }, { transform: 'none' }], {
      duration: motion.spring, easing: motion.easeSpring,
    });
    current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motion.fast + 60, easing: motion.easeStandard });
    return () => {
      leave.cancel(); old.remove();
      current.getAnimations().forEach(animation => animation.cancel());
    };
  }, [text, direction, reduced]);
  return <span className="relative inline-grid"><span ref={ref} className="inline-block whitespace-pre">{text}</span></span>;
}
