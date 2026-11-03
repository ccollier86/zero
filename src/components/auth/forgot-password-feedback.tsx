'use client';

/** Privacy-safe request confirmation and public-policy countdown. Neither state proves provider delivery or account existence. */
import * as React from 'react';
import { motion } from 'motion/react';
import { Button } from '#zero/components/ui/button';
import { AnimateIcon } from '#zero/components/animate-ui/icons/icon';
import { CircleCheck } from '#zero/components/animate-ui/icons/circle-check';
import { CircleX } from '#zero/components/animate-ui/icons/circle-x';
import { authFeedbackAnimate, authFeedbackExit, authFeedbackInitial, authPanelAnimate, authPanelExit, authPanelInitial, authPresenceTransition } from './auth-motion';

/** Display the requested waiting period, without promising that the next request bypasses other security checks. */
export function passwordResetWaitMessage(seconds: number): string {
  if (seconds <= 0) return 'You can request another link now. Other security checks still apply.';
  const minutes = Math.ceil(seconds / 60);
  return seconds > 60
    ? `For security, wait another ${minutes} minutes before requesting a new link.`
    : `For security, wait another ${seconds} ${seconds === 1 ? 'second' : 'seconds'} before requesting a new link.`;
}

/** Uniform confirmation for known, unknown and privately suppressed addresses. */
export function ForgotPasswordSuccessState({ remainingSeconds = 300, loading = false, onRequestAgain }: {
  remainingSeconds?: number; loading?: boolean; onRequestAgain?: () => void;
}) {
  return <motion.div initial={authPanelInitial} animate={authPanelAnimate} exit={authPanelExit} transition={authPresenceTransition}
    className="flex flex-col items-center gap-3 py-2">
    <div className="flex items-center justify-center rounded-full bg-success/10 p-3 dark:bg-success/15">
      <AnimateIcon animate><CircleCheck size={32} className="text-success" /></AnimateIcon>
    </div>
    <p className="max-w-sm text-center text-xs text-muted-foreground" aria-live="polite">
      If an account exists for that address, a reset link will arrive shortly.
    </p>
    <p className="max-w-sm text-center text-xs text-muted-foreground">
      Check your most recent email. Repeated requests may be delayed for security.
    </p>
    <p className="max-w-sm text-center text-xs text-muted-foreground" data-slot="password-reset-wait" aria-live="off">
      {passwordResetWaitMessage(remainingSeconds)}
    </p>
    {onRequestAgain && <Button type="button" variant="outline" onClick={onRequestAgain} disabled={loading || remainingSeconds > 0} aria-busy={loading}>
      {loading ? 'Requesting another link…' : 'Request another link'}
    </Button>}
  </motion.div>;
}

/** Safe request feedback shared by the initial form and an explicit later resend. */
export function ForgotPasswordError({ error }: { error: string }) {
  return <motion.div initial={authFeedbackInitial} animate={authFeedbackAnimate} exit={authFeedbackExit} transition={authPresenceTransition} className="overflow-hidden">
    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5" role="alert">
      <AnimateIcon animate><CircleX size={16} className="mt-px flex-shrink-0 text-destructive" /></AnimateIcon>
      <p className="text-xs font-medium leading-relaxed text-destructive">{error}</p>
    </div>
  </motion.div>;
}
