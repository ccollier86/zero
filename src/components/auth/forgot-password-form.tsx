'use client';

/**
 * forgot-password-form.tsx
 *
 * Renders the reusable password-reset request form. This file owns email input
 * state and auth-config-aware visibility only; reset token creation and email
 * delivery remain backend responsibilities.
 */

import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthHeader } from '@/components/auth/auth-header';
import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { CircleX } from '@/components/animate-ui/icons/circle-x';
import { CircleCheck } from '@/components/animate-ui/icons/circle-check';
import { Loader } from '@/components/animate-ui/icons/loader';
import { Send } from '@/components/animate-ui/icons/send';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { getAuthDisplayMessage, reportAuthUiError } from './auth-error';
import {
  isAuthConfigPending,
  isAuthConfigUnavailable,
  isPasswordResetUnavailable,
} from './auth-config-ui-policy';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Props that control password-reset request behavior and navigation links. */
interface ForgotPasswordFormProps {
  onSubmit?: (email: string) => Promise<void>;
  onBack?: () => void;
  loginHref?: string;
  respectEmailPolicy?: boolean;
  unavailable?: React.ReactNode;
  className?: string;
}

// ─── Success state ───────────────────────────────────────────────────────────

function SuccessState({ email }: { email: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center gap-3 py-2"
    >
      <div className="flex items-center justify-center rounded-full bg-green-500/10 p-3">
        <AnimateIcon animate>
          <CircleCheck size={32} className="text-green-500" />
        </AnimateIcon>
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-medium">Check your inbox</p>
        <p className="text-xs text-muted-foreground">
          We sent a reset link to <span className="font-medium text-foreground">{email}</span>
        </p>
      </div>
    </motion.div>
  );
}

// ─── ForgotPasswordForm ──────────────────────────────────────────────────────

/** Render a password-reset request form backed by the shared auth client. */
function ForgotPasswordForm({
  onSubmit,
  onBack,
  loginHref = '#login',
  respectEmailPolicy = true,
  unavailable,
  className,
}: ForgotPasswordFormProps) {
  const { forgotPassword } = useAuth();
  const authConfig = useAuthConfig();
  const [email, setEmail] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);
  const configPending = isAuthConfigPending(respectEmailPolicy, authConfig);
  const configUnavailable = isAuthConfigUnavailable(respectEmailPolicy, authConfig);
  const resetUnavailable = isPasswordResetUnavailable(respectEmailPolicy, authConfig);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (onSubmit) await onSubmit(email);
      else await forgotPassword(email);
      setSent(true);
    } catch (err) {
      reportAuthUiError('forgotPassword', err);
      setError(getAuthDisplayMessage(err, 'Failed to send reset email'));
    } finally {
      setLoading(false);
    }
  }

  if (configPending) {
    return <ResetPolicyLoading />;
  }

  if (configUnavailable) {
    return <>{unavailable ?? <ResetConfigUnavailable onBack={onBack} loginHref={loginHref} />}</>;
  }

  if (resetUnavailable) {
    return <>{unavailable ?? <ResetUnavailable onBack={onBack} loginHref={loginHref} />}</>;
  }

  return (
    <div className={cn('space-y-3', className)}>
      <AuthHeader
        title={sent ? 'Email sent' : 'Reset password'}
        description={sent ? undefined : 'Enter your email to receive a reset link'}
      />

      <AnimatePresence mode="wait">
        {sent ? (
          <SuccessState key="success" email={email} />
        ) : (
          <motion.form
            key="form"
            onSubmit={handleSubmit}
            className="space-y-3"
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="reset-email" className="text-sm font-medium">Email</Label>
              <Input
                id="reset-email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={cn('h-8 text-sm', error && 'border-destructive/50 focus-visible:ring-destructive/30')}
              />
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0, y: -4 }}
                  animate={{ opacity: 1, height: 'auto', y: 0, x: [0, -6, 6, -4, 4, 0] }}
                  exit={{ opacity: 0, height: 0, y: -4 }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div
                    className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5"
                    role="alert"
                  >
                    <AnimateIcon animate>
                      <CircleX size={16} className="mt-px flex-shrink-0 text-destructive" />
                    </AnimateIcon>
                    <p className="text-xs font-medium leading-relaxed text-destructive">
                      {error}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <Button type="submit" size="sm" className="w-full h-8" disabled={loading || configPending}>
              {loading ? (
                <AnimateIcon animate loop>
                  <Loader size={16} />
                </AnimateIcon>
              ) : (
                <>
                  <AnimateIcon animateOnHover>
                    <Send size={14} className="mr-1" />
                  </AnimateIcon>
                  Send reset link
                </>
              )}
            </Button>
          </motion.form>
        )}
      </AnimatePresence>

      <p className="text-center text-xs text-muted-foreground">
        {onBack ? (
          <button type="button" onClick={onBack} className="text-primary hover:underline">
            Back to login
          </button>
        ) : (
          <a href={loginHref} className="text-primary hover:underline">
            Back to login
          </a>
        )}
      </p>
    </div>
  );
}

function ResetPolicyLoading() {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground" aria-live="polite">
      <AnimateIcon animate loop>
        <Loader size={16} />
      </AnimateIcon>
      Loading reset settings
    </div>
  );
}

function ResetConfigUnavailable({
  onBack,
  loginHref,
}: {
  onBack?: () => void;
  loginHref: string;
}) {
  return (
    <div className="space-y-3">
      <AuthHeader title="Reset unavailable" description="Password reset settings could not be loaded." />
      <p className="text-center text-xs text-muted-foreground">
        {onBack ? (
          <button type="button" onClick={onBack} className="text-primary hover:underline">
            Back to login
          </button>
        ) : (
          <a href={loginHref} className="text-primary hover:underline">
            Back to login
          </a>
        )}
      </p>
    </div>
  );
}

function ResetUnavailable({
  onBack,
  loginHref,
}: {
  onBack?: () => void;
  loginHref: string;
}) {
  return (
    <div className="space-y-3">
      <AuthHeader title="Reset unavailable" description="Password reset email is not enabled for this app." />
      <p className="text-center text-xs text-muted-foreground">
        {onBack ? (
          <button type="button" onClick={onBack} className="text-primary hover:underline">
            Back to login
          </button>
        ) : (
          <a href={loginHref} className="text-primary hover:underline">
            Back to login
          </a>
        )}
      </p>
    </div>
  );
}

export { ForgotPasswordForm, type ForgotPasswordFormProps };
