'use client';

/** Shared bottom-bar action disclosure. Rendering/touch intent only; callers retain all action authorization and mutation policy. */
import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '#zero/lib/utils';
import type { NavigationAction } from './record-navigation-bar';

/** Reuse ManagementBar's width/label springs while making focus and touch disclosure explicit. */
export function RecordNavigationActionButton({ action, labelMode, contextKey, className }: {
  action: NavigationAction; labelMode: 'expand' | 'visible'; contextKey?: string; className: string;
}) {
  const reduced = useReducedMotion();
  const button = React.useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = React.useState(false), [focused, setFocused] = React.useState(false), [touchContext, setTouchContext] = React.useState<string | null>(null);
  const signature = JSON.stringify([contextKey ?? null, action.label, Boolean(action.disabled), labelMode]);
  const touchArmed = React.useRef(false), revealClick = React.useRef(false), identity = React.useRef({ signature, revision: 0 });
  if (identity.current.signature !== signature) {
    identity.current = { signature, revision: identity.current.revision + 1 }; touchArmed.current = false; revealClick.current = false;
  }
  const touchKey = JSON.stringify([identity.current.revision, signature]);
  const touchOpen = touchContext === touchKey;
  const expanded = labelMode === 'visible' || hovered || focused || touchOpen;
  return <motion.button ref={button} type="button" layout={reduced ? false : 'position'}
    data-slot="record-navigation-action" data-label-mode={labelMode} data-expanded={expanded ? 'true' : 'false'}
    whileTap={reduced ? undefined : { scale: .95 }} disabled={action.disabled}
    className={cn('flex h-10 shrink-0 items-center whitespace-nowrap rounded-lg px-2.5 py-2 transition-[background-color,color,box-shadow,opacity] duration-200 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none', className)}
    aria-label={action.label}
    onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(true); }}
    onPointerLeave={event => { if (event.pointerType !== 'touch') setHovered(false); }}
    onPointerDown={event => {
      if (event.pointerType !== 'touch' || labelMode === 'visible' || action.disabled) return;
      revealClick.current = !touchArmed.current; touchArmed.current = true; setTouchContext(touchKey);
    }}
    onPointerCancel={() => { touchArmed.current = false; revealClick.current = false; setTouchContext(null); }}
    onFocus={event => setFocused(event.currentTarget.matches(':focus-visible'))}
    onBlur={() => { setFocused(false); setTouchContext(null); touchArmed.current = false; revealClick.current = false; }}
    onClick={event => {
      if (revealClick.current && event.detail > 0) { revealClick.current = false; event.preventDefault(); event.stopPropagation(); return; }
      revealClick.current = false; action.onClick();
    }}>
    <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-full">{action.icon}</span>
    <motion.span aria-hidden="true" data-slot="record-navigation-action-label" initial={false}
      animate={{ width: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0, x: expanded ? 0 : 4 }}
      transition={reduced ? { duration: 0 } : { width: { type: 'spring', stiffness: expanded ? 200 : 250,
        damping: expanded ? 35 : 25, delay: hovered && !focused && !touchOpen ? .15 : 0 },
      opacity: { type: 'spring', stiffness: 200, damping: 25 }, x: { type: 'spring', stiffness: 200, damping: 25 } }}
      onAnimationComplete={() => { if (document.activeElement === button.current && expanded) button.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }}
      className="overflow-hidden text-sm"><span className="pl-2">{action.label}</span></motion.span>
  </motion.button>;
}
