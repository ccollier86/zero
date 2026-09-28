'use client';

/**
 * password-action-form.tsx
 *
 * Renders the reusable reset/setup password flow for auth action tokens. This
 * file owns token inspection and form interaction only; token validation and
 * password mutation remain server-side.
 */

import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { AuthActionTokenInfo } from '../../frontend/client/auth-client';
import { useAuth } from '../../frontend/client/auth-hooks';
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
import { getAuthDisplayMessage, reportAuthUiError } from './auth-error';
import {
  isPasswordActionModeMismatch,
  resolvePasswordAction,
} from './password-action-policy';
import {
  authFeedbackAnimate,
  authFeedbackExit,
  authFeedbackInitial,
  authPresenceTransition,
} from './auth-motion';
import {
  type AuthFlowContinuationResult,
  isAuthFlowContinuationResult,
} from './auth-continuation';
import { useNativeAuthRoute } from './use-native-auth-route';

export interface PasswordActionFormProps {
  token?: string;
  mode?: 'auto' | 'reset' | 'setup';
  loginHref?: string;
  onSuccess?: () => void;
  className?: string;
}

/** Render a token-backed password reset or account setup form. */
export function PasswordActionForm({
  token,
  mode = 'auto',
  loginHref = '#login',
  onSuccess,
  className,
}: PasswordActionFormProps) {
  const { inspectActionToken, resetPassword, setupPassword } = useAuth();
  const tokenInputId = React.useId();
  const newPasswordId = React.useId();
  const confirmPasswordId = React.useId();
  const [tokenInfo, setTokenInfo] = React.useState<AuthActionTokenInfo | null>(null);
  const [tokenInput, setTokenInput] = React.useState('');
  const [manualToken, setManualToken] = React.useState('');
  const [loadingToken, setLoadingToken] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [complete, setComplete] = React.useState(false);
  const [authContinuation, setAuthContinuation] = React.useState<
    AuthFlowContinuationResult | null
  >(null);
  const activeToken = (token?.trim() || manualToken.trim()).trim();
  const continuedLoginHref = useNativeAuthRoute(loginHref);

  React.useEffect(() => {
    let active = true;
    if (!activeToken) {
      setLoadingToken(false);
      setError(null);
      setTokenInfo(null);
      return () => {
        active = false;
      };
    }

    setLoadingToken(true);
    setError(null);
    inspectActionToken(activeToken)
      .then((info) => {
        if (!active) return;
        setTokenInfo(info);
      })
      .catch((err) => {
        if (!active) return;
        reportAuthUiError('inspectActionToken', err);
        setError(getAuthDisplayMessage(err, 'Invalid or expired link'));
        setTokenInfo(null);
      })
      .finally(() => {
        if (active) setLoadingToken(false);
      });

    return () => {
      active = false;
    };
  }, [activeToken, inspectActionToken]);

  const action = resolvePasswordAction(mode, tokenInfo);
  const actionMismatch = isPasswordActionModeMismatch(mode, tokenInfo);
  const titleAction = action ?? (mode === 'setup' ? 'setup' : 'reset');
  const title = titleAction === 'setup' ? 'Set password' : 'Reset password';
  const displayError = error ?? (actionMismatch ? 'This link does not match this password action.' : null);
  const shouldShowTokenEntry = !activeToken || (!tokenInfo && Boolean(displayError));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!action || submitting || !activeToken) return;

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = action === 'setup'
        ? await setupPassword(activeToken, password)
        : await resetPassword(activeToken, password);
      if (isAuthFlowContinuationResult(result)) {
        setAuthContinuation(result);
        return;
      }
      setComplete(true);
      onSuccess?.();
    } catch (err) {
      reportAuthUiError(action === 'setup' ? 'setupPassword' : 'resetPassword', err);
      setError(getAuthDisplayMessage(err, 'Failed to update password'));
    } finally {
      setSubmitting(false);
    }
  }

  function handleTokenSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextToken = tokenInput.trim();
    if (!nextToken) {
      setError('Enter the token from your email.');
      return;
    }
    setError(null);
    setManualToken(nextToken);
  }

  if (loadingToken) {
    return (
      <div
        className={cn('flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground', className)}
        role="status"
        aria-live="polite"
      >
        <AnimateIcon animate loop>
          <Loader size={20} />
        </AnimateIcon>
        Checking password link…
      </div>
    );
  }

  if (authContinuation) {
    return (
      <AuthFlowContinuation
        result={authContinuation}
        onSuccess={onSuccess}
        onBack={() => setAuthContinuation(null)}
        className={className}
      />
    );
  }

  if (complete) {
    return (
      <div className={cn('space-y-4', className)}>
        <AuthHeader
          title="Password updated"
          description="Sign in with your new password to continue."
        />
        <div className="flex items-center gap-2 rounded-md border border-success/35 bg-success/10 px-3 py-2 text-sm text-foreground dark:border-success/45 dark:bg-success/15">
          <AnimateIcon animate>
            <CircleCheck size={16} className="text-success" />
          </AnimateIcon>
          Password updated successfully.
        </div>
        <a href={continuedLoginHref} className="block text-center text-sm text-primary hover:underline">
          Back to sign in
        </a>
      </div>
    );
  }

  if (shouldShowTokenEntry) {
    return (
      <form onSubmit={handleTokenSubmit} className={cn('space-y-4', className)}>
        <AuthHeader
          title={mode === 'setup' ? 'Set password' : 'Reset password'}
          description="Paste the token from your email to continue."
        />

        <div className="space-y-1.5">
          <Label htmlFor={tokenInputId} className="text-sm font-medium">Email token</Label>
          <Input
            id={tokenInputId}
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            autoComplete="one-time-code"
            placeholder="Paste token"
            className={cn('h-10 text-sm', error && 'ring-[1px] ring-destructive/30')}
          />
        </div>

        <AnimatePresence>
          {displayError && (
            <motion.div
              initial={authFeedbackInitial}
              animate={authFeedbackAnimate}
              exit={authFeedbackExit}
              transition={authPresenceTransition}
              className="overflow-hidden"
            >
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5" role="alert">
                <AnimateIcon animate>
                  <CircleX size={16} className="mt-px flex-shrink-0 text-destructive" />
                </AnimateIcon>
                <p className="text-xs font-medium leading-relaxed text-destructive">{displayError}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <Button type="submit" className="h-10 w-full">
          Continue
        </Button>
        <a href={continuedLoginHref} className="block text-center text-sm text-primary hover:underline">
          Back to sign in
        </a>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-4', className)} aria-busy={submitting}>
      <AuthHeader
        title={title}
        description={tokenInfo ? `For ${tokenInfo.user.email}` : 'Enter a new password to continue'}
      />

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={newPasswordId} className="text-sm font-medium">New password</Label>
          <PasswordInput
            id={newPasswordId}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            showStrength
            required
            className="h-10 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={confirmPasswordId} className="text-sm font-medium">Confirm password</Label>
          <PasswordInput
            id={confirmPasswordId}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            required
            className="h-10 text-sm"
          />
        </div>
      </div>

      <AnimatePresence>
        {displayError && (
          <motion.div
            initial={authFeedbackInitial}
            animate={authFeedbackAnimate}
            exit={authFeedbackExit}
            transition={authPresenceTransition}
            className="overflow-hidden"
          >
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5" role="alert">
              <AnimateIcon animate>
                <CircleX size={16} className="mt-px flex-shrink-0 text-destructive" />
              </AnimateIcon>
              <p className="text-xs font-medium leading-relaxed text-destructive">{displayError}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Button type="submit" className="h-10 w-full" disabled={!action || submitting}>
        {submitting ? (
          <>
            <AnimateIcon animate loop>
              <Loader size={16} />
            </AnimateIcon>
            <span className="sr-only">Updating password</span>
          </>
        ) : (
          title
        )}
      </Button>
    </form>
  );
}
