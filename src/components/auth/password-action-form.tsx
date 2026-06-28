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
import { useAuth } from '../../frontend/client/hooks';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AuthHeader } from '@/components/auth/auth-header';
import { PasswordInput } from '@/components/auth/password-input';
import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { CircleCheck } from '@/components/animate-ui/icons/circle-check';
import { CircleX } from '@/components/animate-ui/icons/circle-x';
import { Loader } from '@/components/animate-ui/icons/loader';
import { getAuthDisplayMessage, reportAuthUiError } from './auth-error';
import {
  isPasswordActionModeMismatch,
  resolvePasswordAction,
} from './password-action-policy';

export interface PasswordActionFormProps {
  token: string;
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
  const [tokenInfo, setTokenInfo] = React.useState<AuthActionTokenInfo | null>(null);
  const [loadingToken, setLoadingToken] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [complete, setComplete] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    setLoadingToken(true);
    setError(null);
    inspectActionToken(token)
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
  }, [inspectActionToken, token]);

  const action = resolvePasswordAction(mode, tokenInfo);
  const actionMismatch = isPasswordActionModeMismatch(mode, tokenInfo);
  const titleAction = action ?? (mode === 'setup' ? 'setup' : 'reset');
  const title = titleAction === 'setup' ? 'Set password' : 'Reset password';
  const displayError = error ?? (actionMismatch ? 'This link does not match this password action.' : null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!action || submitting) return;

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
      if (action === 'setup') await setupPassword(token, password);
      else await resetPassword(token, password);
      setComplete(true);
      onSuccess?.();
    } catch (err) {
      reportAuthUiError(action === 'setup' ? 'setupPassword' : 'resetPassword', err);
      setError(getAuthDisplayMessage(err, 'Failed to update password'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingToken) {
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <AnimateIcon animate loop>
          <Loader size={20} />
        </AnimateIcon>
      </div>
    );
  }

  if (complete) {
    return (
      <div className={cn('space-y-4', className)}>
        <AuthHeader title="Password updated" description="You can continue with the signed-in session or return to sign in." />
        <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2 text-sm text-green-600">
          <AnimateIcon animate>
            <CircleCheck size={16} />
          </AnimateIcon>
          Password updated successfully.
        </div>
        <a href={loginHref} className="block text-center text-sm text-primary hover:underline">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-3', className)}>
      <AuthHeader
        title={title}
        description={tokenInfo ? `For ${tokenInfo.user.email}` : 'Enter a new password to continue'}
      />

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="password-action-new" className="text-sm font-medium">New password</Label>
          <PasswordInput
            id="password-action-new"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            showStrength
            required
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password-action-confirm" className="text-sm font-medium">Confirm password</Label>
          <PasswordInput
            id="password-action-confirm"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            required
            className="h-8 text-sm"
          />
        </div>
      </div>

      <AnimatePresence>
        {displayError && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
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

      <Button type="submit" size="sm" className="h-8 w-full" disabled={!action || submitting}>
        {submitting ? (
          <AnimateIcon animate loop>
            <Loader size={16} />
          </AnimateIcon>
        ) : (
          title
        )}
      </Button>
    </form>
  );
}
