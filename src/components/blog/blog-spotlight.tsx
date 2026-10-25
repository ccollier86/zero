'use client';

import * as React from 'react';
import { cn } from '../../lib/utils';

export interface SpotlightBorderProps extends React.ComponentProps<'div'> { enabled?: boolean; radius?: number; color?: string; borderRadius?: string; containerClassName?: string }
/** Pointer paint only: no idle animation, extra control, selection state or global listener. */
export function SpotlightBorder({ enabled = true, radius, color, borderRadius, containerClassName, className, style, children, onPointerMove, onPointerLeave, ...props }: SpotlightBorderProps) {
  const [active, setActive] = React.useState(false);
  return <div {...props} className={cn('zero-blog-spotlight', className)} data-active={enabled && active || undefined} data-enabled={enabled || undefined}
    style={{ ...(Number.isFinite(radius) ? { '--zero-blog-spotlight-radius': `${Math.max(0, Math.min(1000, radius!))}px` } : {}), ...(color ? { '--zero-blog-spotlight-color': color } : {}), ...(borderRadius ? { '--zero-blog-spotlight-rounding': borderRadius } : {}), ...style } as React.CSSProperties}
    onPointerMove={event => { onPointerMove?.(event); if (!enabled || event.defaultPrevented || event.pointerType === 'touch') return; const r = event.currentTarget.getBoundingClientRect();
      event.currentTarget.style.setProperty('--zero-blog-spotlight-x', `${event.clientX - r.left}px`); event.currentTarget.style.setProperty('--zero-blog-spotlight-y', `${event.clientY - r.top}px`); if (!active) setActive(true); }}
    onPointerLeave={event => { onPointerLeave?.(event); setActive(false); }}><div className={cn('zero-blog-spotlight-content', containerClassName)}>{children}</div></div>;
}
