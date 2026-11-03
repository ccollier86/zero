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

import { cn } from '#zero/lib/utils';
import { Button } from '#zero/components/ui/button';
import { Input } from '#zero/components/ui/input';
import { Label } from '#zero/components/ui/label';
import { AuthHeader } from '#zero/components/auth/auth-header';
import { AnimateIcon } from '#zero/components/animate-ui/icons/icon';
import { Loader } from '#zero/components/animate-ui/icons/loader';
import { Send } from '#zero/components/animate-ui/icons/send';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { ForgotPasswordError, ForgotPasswordSuccessState } from './forgot-password-feedback';
import { passwordResetRequestCooldown, usePasswordResetRequest } from './use-password-reset-request';
import {
  isAuthConfigPending,
  isAuthConfigUnavailable,
  isPasswordResetUnavailable,
} from './auth-config-ui-policy';
import {
  authPanelAnimate,
  authPanelExit,
  authPanelInitial,
  authPresenceTransition,
} from './auth-motion';
import { useNativeAuthContinuation, useNativeAuthRoute } from './use-native-auth-route';
import { AuthConfigLoadState } from './auth-config-load-state';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Props that control password-reset request behavior and navigation links. */
interface ForgotPasswordFormProps {
  onSubmit?: (email: string, nativeContinuation?: string) => Promise<void>;
  onBack?: () => void;
  loginHref?: string;
  respectEmailPolicy?: boolean;
  unavailable?: React.ReactNode;
  className?: string;
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
  const emailId = `${React.useId()}-email`;
  const configPending = isAuthConfigPending(respectEmailPolicy, authConfig);
  const configUnavailable = isAuthConfigUnavailable(respectEmailPolicy, authConfig);
  const resetUnavailable = isPasswordResetUnavailable(respectEmailPolicy, authConfig);
  const nativeContinuation = useNativeAuthContinuation();
  const continuedLoginHref = useNativeAuthRoute(loginHref);
  const { loading, sent, error, remainingSeconds, request } = usePasswordResetRequest({
    submit: onSubmit ?? forgotPassword, nativeContinuation,
    enabled: !configPending && !configUnavailable && !resetUnavailable,
    cooldownMs: passwordResetRequestCooldown(authConfig.config?.accountEmails?.passwordResetRequestCooldownMs),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await request(email);
  }

  if (configPending) {
    return <ResetPolicyLoading />;
  }

  if (configUnavailable) {
    return <>{unavailable ?? <ResetConfigUnavailable
      authConfig={authConfig}
      onBack={onBack}
      loginHref={continuedLoginHref}
    />}</>;
  }

  if (resetUnavailable) {
    return <>{unavailable ?? <ResetUnavailable onBack={onBack} loginHref={continuedLoginHref} />}</>;
  }

  return (
    <div className={cn('space-y-4', className)}>
      <AuthHeader
        title={sent ? 'Request received' : 'Reset password'}
        description={sent ? undefined : 'Enter your email to receive a reset link'}
      />

      <AnimatePresence initial={false} mode="wait">
        {sent ? (
          <ForgotPasswordSuccessState key="success" remainingSeconds={remainingSeconds} loading={loading} onRequestAgain={() => { void request(email); }} />
        ) : (
          <motion.form
            key="form"
            onSubmit={handleSubmit}
            className="space-y-4"
            initial={authPanelInitial}
            animate={authPanelAnimate}
            exit={authPanelExit}
            transition={authPresenceTransition}
            aria-busy={loading}
            method="post"
          >
            <div className="space-y-1.5">
              <Label htmlFor={emailId} className="text-sm font-medium">Email</Label>
              <Input
                id={emailId}
                type="email"
                name="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
                disabled={loading}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={cn('h-10 text-sm', error && 'ring-[1px] ring-destructive/30')}
              />
            </div>

            <Button type="submit" className="h-10 w-full" disabled={loading || configPending}>
              {loading ? (
                <>
                  <AnimateIcon animate loop>
                    <Loader size={16} />
                  </AnimateIcon>
                  <span className="sr-only">Sending reset link</span>
                </>
              ) : (
                <>
                  <Send size={14} className="mr-1" />
                  Send reset link
                </>
              )}
            </Button>
          </motion.form>
        )}
      </AnimatePresence>

      <AnimatePresence>{error && <ForgotPasswordError error={error} />}</AnimatePresence>

      <p className="text-center text-xs text-muted-foreground">
        {onBack ? (
          <button type="button" onClick={onBack} className="text-primary hover:underline">
            Back to login
          </button>
        ) : (
          <a href={continuedLoginHref} className="text-primary hover:underline">
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
  authConfig,
  onBack,
  loginHref,
}: {
  authConfig: ReturnType<typeof useAuthConfig>;
  onBack?: () => void;
  loginHref: string;
}) {
  return (
    <div className="space-y-3">
      <AuthHeader title="Reset unavailable" />
      <AuthConfigLoadState
        state={authConfig}
        loadingMessage="Loading password reset settings…"
        unavailableMessage="Password reset settings could not be loaded."
      />
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

export {
  ForgotPasswordForm,
  ForgotPasswordSuccessState,
  type ForgotPasswordFormProps,
};
