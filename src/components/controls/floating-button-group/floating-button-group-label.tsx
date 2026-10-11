'use client';

/** Decorative reserved-label slot; native button aria-label supplies the single current accessible name. */
import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { FloatingButtonGroupFeedback } from './use-floating-button-group-highlight';

/** Hidden alternatives measure natural width without exposing ghosts or departing labels to assistive technology. */
export function FloatingButtonGroupLabel({ label, icon, iconOnly, reserveLabels, feedback }: {
  label: string; icon?: React.ReactNode; iconOnly: boolean; reserveLabels?: readonly string[]; feedback: FloatingButtonGroupFeedback;
}) {
  const labels = iconOnly ? [] : [...new Set([label, ...(reserveLabels ?? [])])];
  return <span className="zero-floating-button-group-body" aria-hidden="true">
    {icon != null && <span className="zero-floating-button-group-icon">{icon}</span>}
    {!iconOnly && <span className="zero-floating-button-group-label">
    {labels.map(text => <span key={text} className="zero-floating-button-group-ghost">
      <span>{text}</span>
    </span>)}
    {feedback.reduced ? <span className="zero-floating-button-group-phase">{label}</span> : <AnimatePresence initial={false}>
      <motion.span key={label} className="zero-floating-button-group-phase"
        initial={{ opacity: 0, y: feedback.labelEnterY, filter: `blur(${feedback.labelBlur}px)` }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        exit={{ opacity: 0, y: feedback.labelExitY, filter: `blur(${feedback.labelBlur}px)`,
          transition: { duration: feedback.labelExitMs / 1000, ease: feedback.feedbackEasing } }}
        transition={{ duration: feedback.labelEnterMs / 1000, ease: feedback.enterEasing }}>{label}</motion.span>
    </AnimatePresence>}
    </span>}
  </span>;
}
