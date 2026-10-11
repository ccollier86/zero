'use client';

/** Composable card status with one polite announcement and token-resolved changed-word presentation only. */
import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../../../lib/utils';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { composeOverlayRefs } from '../../overlays/overlay-scope';
import { useCardFeedback } from './card-presentation';

export interface CardStatusProps extends Omit<React.ComponentProps<'span'>, 'children'> { children: string; animate?: boolean }
export function CardStatus({ children: text, animate = true, className, ref, ...props }: CardStatusProps) {
  const [element, setElement] = React.useState<HTMLSpanElement | null>(null);
  const statusRef = React.useMemo(() => composeOverlayRefs<HTMLSpanElement>(setElement, ref), [ref]);
  const reduced = Boolean(useMediaQuery('(prefers-reduced-motion: reduce)')) || !animate;
  const feedback = useCardFeedback(element, reduced), previous = React.useRef(text), changed = previous.current !== text;
  React.useLayoutEffect(() => { previous.current = text; }, [text]);
  const parts = text.split(/(\s+)/u);
  return <span data-slot="card-status" role="status" className={cn('relative min-w-0 truncate text-[length:var(--zero-type-caption-size,var(--text-xs,.75rem))] leading-[var(--zero-type-caption-leading,1.5)] text-muted-foreground tabular-nums', className)} {...props} ref={statusRef}>
    <span className="sr-only">{text}</span><span aria-hidden="true" className="relative block">
      {reduced ? text : <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={text} className="block truncate" initial={false} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={reduced ? undefined : { opacity: 0, y: '-.3em', filter: `blur(${feedback.statusBlurPx / 2}px)` }}
          transition={{ duration: feedback.statusExitMs / 1000, ease: [.22, 1, .36, 1] }}>
          {parts.map((part, index) => <motion.span key={index} className="inline-block whitespace-pre"
            initial={changed && !reduced ? { opacity: 0, y: '.3em', filter: `blur(${feedback.statusBlurPx}px)` } : false}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: feedback.statusEnterMs / 1000, ease: [.16, 1, .3, 1], delay: reduced ? 0 : Math.min(index / 2 * feedback.statusStaggerMs, 400) / 1000 }}>{part}</motion.span>)}
        </motion.span>
      </AnimatePresence>}
    </span>
  </span>;
}
