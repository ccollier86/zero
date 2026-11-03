'use client';

/** Native reset/setup presentation. Proof inspection, lifecycle and credential dispatch live in usePasswordAction. */
import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '#zero/lib/utils';
import { Button } from '#zero/components/ui/button';
import { Input } from '#zero/components/ui/input';
import { Label } from '#zero/components/ui/label';
import { AuthHeader } from '#zero/components/auth/auth-header';
import { AuthFlowContinuation } from '#zero/components/auth/auth-flow-continuation';
import { PasswordInput } from '#zero/components/auth/password-input';
import { AnimateIcon } from '#zero/components/animate-ui/icons/icon';
import { CircleCheck } from '#zero/components/animate-ui/icons/circle-check';
import { CircleX } from '#zero/components/animate-ui/icons/circle-x';
import { Loader } from '#zero/components/animate-ui/icons/loader';
import { AUTH_REQUEST_LIMITS } from '../../auth/auth-request-limits';
import { resolvePasswordAction } from './password-action-policy';
import { usePasswordAction } from './use-password-action';
import { useNativeAuthRoute } from './use-native-auth-route';
import { authFeedbackAnimate, authFeedbackExit, authFeedbackInitial, authPresenceTransition } from './auth-motion';

export interface PasswordActionFormProps {
  /** The complete secret from the emailed link, read by the owning route. Never log or persist it in analytics. */
  token?: string;
  mode?: 'auto' | 'reset' | 'setup';
  loginHref?: string;
  /** Recovery request page; navigating here never sends an email automatically. */
  forgotPasswordHref?: string;
  onSuccess?: () => void;
  className?: string;
}

/** Render an emailed password link, clear recovery instructions or an explicit inspection-only retry. */
export function PasswordActionForm({ token = '', mode = 'auto', loginHref = '#login',
  forgotPasswordHref = '/forgot-password', onSuccess, className }: PasswordActionFormProps) {
  const state = usePasswordAction(token.trim(), mode, onSuccess);
  const passwordId = React.useId(), confirmId = React.useId(), usernameId = React.useId();
  const continuedLoginHref = useNativeAuthRoute(loginHref);
  const continuedForgotHref = useNativeAuthRoute(forgotPasswordHref);
  const action = resolvePasswordAction(mode, state.info);
  const setup = action === 'setup' || mode === 'setup';
  const title = setup ? 'Set password' : 'Reset password';
  const login = <a href={continuedLoginHref} referrerPolicy="no-referrer" className="block text-center text-sm text-primary hover:underline">Back to sign in</a>;

  if (state.phase === 'continuation' && state.continuation) return <AuthFlowContinuation
    result={state.continuation} onSuccess={onSuccess} onBack={state.clearContinuation} className={className} />;

  if (state.phase === 'checking') return <div className={cn('flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground', className)}
    role="status" aria-live="polite"><AnimateIcon animate loop><Loader size={20} /></AnimateIcon>Checking password link…</div>;

  if (state.phase === 'complete') return <div className={cn('space-y-4', className)}>
    <AuthHeader title="Password updated" description="Sign in with your new password to continue." />
    <div role="status" className="flex items-center gap-2 rounded-md border border-success/35 bg-success/10 px-3 py-2 text-sm text-foreground dark:border-success/45 dark:bg-success/15">
      <AnimateIcon animate><CircleCheck size={16} className="text-success" /></AnimateIcon>Password updated successfully.
    </div>{login}
  </div>;

  if (state.phase === 'problem' && state.problem) return <div className={cn('space-y-4', className)} data-slot="password-action-recovery"
    role={state.problem.kind === 'missing' ? 'status' : 'alert'} aria-live="polite">
    <AuthHeader title={state.problem.title} description={state.problem.description} />
    <p className="text-sm text-muted-foreground">
      {setup ? 'If you need a new account setup link, ask your administrator to resend the setup email.'
        : 'Check your most recent reset email. Repeated requests may be delayed for security.'}
    </p>
    {state.problem.retry && <Button type="button" className="h-10 w-full" onClick={state.retry}>Retry link check</Button>}
    {!setup && state.problem.kind !== 'suspended' && <Button asChild className="h-10 w-full"><a href={continuedForgotHref} referrerPolicy="no-referrer">Request a new reset link</a></Button>}
    {login}
  </div>;

  const submitting = state.phase === 'submitting';
  return <form method="post" onSubmit={state.submit} className={cn('space-y-4', className)} aria-busy={submitting} data-slot="password-action-form">
    <AuthHeader title={title} description={state.info ? `For ${state.info.user.email}` : 'Enter a new password to continue'} />
    <div className="sr-only">
      <Label htmlFor={usernameId}>Account</Label>
      <Input id={usernameId} name="username" autoComplete="username" value={state.info?.user.username ?? ''} readOnly tabIndex={-1} data-zero-sensitive="true" />
    </div>
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={passwordId} className="text-sm font-medium">New password</Label>
        <PasswordInput id={passwordId} name="newPassword" value={state.password} onChange={event => state.setPassword(event.target.value)}
          autoComplete="new-password" minLength={8} maxLength={AUTH_REQUEST_LIMITS.password} showStrength required disabled={submitting} className="h-10 text-sm" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={confirmId} className="text-sm font-medium">Confirm password</Label>
        <PasswordInput id={confirmId} name="confirmPassword" value={state.confirm} onChange={event => state.setConfirm(event.target.value)}
          autoComplete="new-password" minLength={8} maxLength={AUTH_REQUEST_LIMITS.password} required disabled={submitting} className="h-10 text-sm" />
      </div>
    </div>
    <AnimatePresence>{state.error && <motion.div initial={authFeedbackInitial} animate={authFeedbackAnimate} exit={authFeedbackExit}
      transition={authPresenceTransition} className="overflow-hidden">
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5" role="alert">
        <AnimateIcon animate><CircleX size={16} className="mt-px flex-shrink-0 text-destructive" /></AnimateIcon>
        <p className="text-xs font-medium leading-relaxed text-destructive">{state.error}</p>
      </div>
    </motion.div>}</AnimatePresence>
    <Button type="submit" className="h-10 w-full" disabled={!action || submitting}>{submitting
      ? <><AnimateIcon animate loop><Loader size={16} /></AnimateIcon><span className="sr-only">Updating password</span></> : title}</Button>
  </form>;
}
