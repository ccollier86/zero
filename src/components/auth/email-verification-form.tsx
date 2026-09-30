'use client';

/**
 * email-verification-form.tsx
 *
 * Renders the reusable email-verification flow for auth action tokens. This
 * file owns token inspection and UI interaction only; token validation and
 * account state mutation remain server-side.
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
import { AnimateIcon } from '#zero/components/animate-ui/icons/icon';
import { CircleCheck } from '#zero/components/animate-ui/icons/circle-check';
import { CircleX } from '#zero/components/animate-ui/icons/circle-x';
import { Loader } from '#zero/components/animate-ui/icons/loader';
import { Send } from '#zero/components/animate-ui/icons/send';
import { getAuthDisplayMessage, reportAuthUiError } from './auth-error';
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
import {
  useNativeAuthContinuation,
  useNativeAuthRoute,
} from './use-native-auth-route';

export interface EmailVerificationFormProps {
  token?: string;
  email?: string;
  loginHref?: string;
  onSuccess?: () => void;
  className?: string;
}

/** Render a token-backed email verification form with resend support. */
export function EmailVerificationForm({
  token,
  email,
  loginHref = '#login',
  onSuccess,
  className,
}: EmailVerificationFormProps) {
  const {
    inspectActionToken,
    verifyEmail,
    resendVerificationEmail,
    authenticationContinuation,
    clearAuthenticationContinuation,
  } = useAuth();
  const tokenInputId = React.useId();
  const resendEmailId = React.useId();
  const [tokenInfo, setTokenInfo] = React.useState<AuthActionTokenInfo | null>(null);
  const [tokenInput, setTokenInput] = React.useState('');
  const [manualToken, setManualToken] = React.useState('');
  const [resendEmail, setResendEmail] = React.useState(email ?? '');
  const [loadingToken, setLoadingToken] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const [resent, setResent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [complete, setComplete] = React.useState(false);
  const [authContinuation, setAuthContinuation] = React.useState<
    AuthFlowContinuationResult | null
  >(null);
  const activeAuthContinuation = authContinuation
    ?? (isAuthFlowContinuationResult(authenticationContinuation)
      ? authenticationContinuation
      : null);
  const activeToken = (token?.trim() || manualToken.trim()).trim();
  const continuedLoginHref = useNativeAuthRoute(loginHref);
  const nativeContinuation = useNativeAuthContinuation();

  React.useEffect(() => {
    let active = true;
    if (activeAuthContinuation) {
      setLoadingToken(false);
      return () => { active = false; };
    }
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
        if (!info) {
          setError('Invalid or expired verification link');
          setTokenInfo(null);
          return;
        }
        if (info.type !== 'email_verification') {
          setError('This link is not an email verification link.');
          setTokenInfo(null);
          return;
        }
        setTokenInfo(info);
        setResendEmail((current) => current || info.user.email);
      })
      .catch((err) => {
        if (!active) return;
        reportAuthUiError('inspectEmailVerificationToken', err);
        setError(getAuthDisplayMessage(err, 'Invalid or expired verification link'));
        setTokenInfo(null);
      })
      .finally(() => {
        if (active) setLoadingToken(false);
      });

    return () => {
      active = false;
    };
  }, [activeAuthContinuation, activeToken, inspectActionToken]);

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault();
    if (!activeToken || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await verifyEmail(activeToken);
      if (isAuthFlowContinuationResult(result)) {
        setAuthContinuation(result);
        return;
      }
      setComplete(true);
      onSuccess?.();
    } catch (err) {
      reportAuthUiError('verifyEmail', err);
      setError(getAuthDisplayMessage(err, 'Failed to verify email'));
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

  async function handleResend(event: React.FormEvent) {
    event.preventDefault();
    if (!resendEmail.trim() || resending) return;

    setResending(true);
    setResent(false);
    setError(null);
    try {
      await resendVerificationEmail(resendEmail.trim(), nativeContinuation ?? undefined);
      setResent(true);
    } catch (err) {
      reportAuthUiError('resendVerificationEmail', err);
      setError(getAuthDisplayMessage(err, 'Failed to request verification email'));
    } finally {
      setResending(false);
    }
  }

  const displayError = error;
  const shouldShowTokenEntry = !activeToken || (!tokenInfo && Boolean(displayError));

  if (activeAuthContinuation) {
    return (
      <AuthFlowContinuation
        result={activeAuthContinuation}
        onSuccess={onSuccess}
        onBack={() => {
          clearAuthenticationContinuation();
          setAuthContinuation(null);
        }}
        className={className}
      />
    );
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
        Checking verification link…
      </div>
    );
  }

  if (complete) {
    return (
      <div className={cn('space-y-4', className)}>
        <AuthHeader title="Email verified" description="Your account is ready to use." />
        <div className="flex items-center gap-2 rounded-md border border-success/35 bg-success/10 px-3 py-2 text-sm text-foreground dark:border-success/45 dark:bg-success/15">
          <AnimateIcon animate>
            <CircleCheck size={16} className="text-success" />
          </AnimateIcon>
          Email verified successfully.
        </div>
        <a href={continuedLoginHref} className="block text-center text-sm text-primary hover:underline">
          Back to sign in
        </a>
      </div>
    );
  }

  if (shouldShowTokenEntry) {
    return (
      <div className={cn('space-y-5', className)}>
        <form onSubmit={handleTokenSubmit} className="space-y-4">
          <AuthHeader
            title="Verify email"
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
              className={cn('h-10 text-sm', displayError && 'ring-[1px] ring-destructive/30')}
            />
          </div>

          <AuthFeedback message={displayError} />

          <Button type="submit" className="h-10 w-full">
            Continue
          </Button>
        </form>

        <VerificationResendForm
          email={resendEmail}
          onEmailChange={setResendEmail}
          onSubmit={handleResend}
          isLoading={resending}
          sent={resent}
          inputId={resendEmailId}
        />

        <a href={continuedLoginHref} className="block text-center text-sm text-primary hover:underline">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleVerify} className={cn('space-y-4', className)} aria-busy={submitting}>
      <AuthHeader
        title="Verify email"
        description={tokenInfo ? `Confirm ${tokenInfo.user.email} to continue.` : 'Confirm your email to continue.'}
      />

      <AuthFeedback message={displayError} />

      <Button type="submit" className="h-10 w-full" disabled={!tokenInfo || submitting}>
        {submitting ? (
          <>
            <AnimateIcon animate loop>
              <Loader size={16} />
            </AnimateIcon>
            <span className="sr-only">Verifying email</span>
          </>
        ) : (
          'Verify email'
        )}
      </Button>

      <VerificationResendForm
        email={resendEmail}
        onEmailChange={setResendEmail}
        onSubmit={handleResend}
        isLoading={resending}
        sent={resent}
        inputId={resendEmailId}
      />
    </form>
  );
}

function AuthFeedback({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message && (
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
            <p className="text-xs font-medium leading-relaxed text-destructive">{message}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function VerificationResendForm({
  email,
  onEmailChange,
  onSubmit,
  isLoading,
  sent,
  inputId,
}: {
  email: string;
  onEmailChange: (email: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  isLoading: boolean;
  sent: boolean;
  inputId: string;
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-md border border-border/70 bg-muted/30 p-3">
      <div className="space-y-2">
        <Label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
          Need another link?
        </Label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            type="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            className="h-9 min-w-0 text-sm"
          />
          <Button type="submit" size="sm" variant="outline" className="h-9 shrink-0" disabled={isLoading || !email.trim()}>
            {isLoading ? (
              <AnimateIcon animate loop>
                <Loader size={15} />
              </AnimateIcon>
            ) : (
              <AnimateIcon animateOnHover>
                <Send size={15} />
              </AnimateIcon>
            )}
            Send
          </Button>
        </div>
        {sent && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AnimateIcon animate>
              <CircleCheck size={14} className="text-success" />
            </AnimateIcon>
            If that account needs verification, a new link was sent.
          </p>
        )}
      </div>
    </form>
  );
}
