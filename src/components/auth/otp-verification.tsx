'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';

import { cn } from '#zero/lib/utils';
import { AuthHeader } from '#zero/components/auth/auth-header';
import { OTPInput } from '#zero/components/auth/otp-input';
import { AnimateIcon } from '#zero/components/animate-ui/icons/icon';
import { CircleX } from '#zero/components/animate-ui/icons/circle-x';
import { Loader } from '#zero/components/animate-ui/icons/loader';
import { getAuthDisplayMessage, reportAuthUiError } from './auth-error';
import {
  authFeedbackAnimate,
  authFeedbackExit,
  authFeedbackInitial,
  authPresenceTransition,
} from './auth-motion';

// ─── Types ───────────────────────────────────────────────────────────────────

interface OTPVerificationProps {
  destination: string;
  title?: string;
  description?: string;
  length?: number;
  onVerify: (code: string) => Promise<void>;
  onResend?: () => Promise<void>;
  resendCooldown?: number;
  onBack?: () => void;
  className?: string;
}

// ─── OTPVerification ─────────────────────────────────────────────────────────

function OTPVerification({
  destination,
  title = 'Verification',
  description,
  length = 6,
  onVerify,
  onResend,
  resendCooldown = 60,
  onBack,
  className,
}: OTPVerificationProps) {
  const [code, setCode] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hasError, setHasError] = React.useState(false);
  const [countdown, setCountdown] = React.useState(0);
  const pending = React.useRef(false);
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Countdown timer
  React.useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((c) => c - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  async function handleVerify(value: string) {
    if (pending.current || !mounted.current) return;
    pending.current = true;
    setError(null);
    setHasError(false);
    setLoading(true);
    try {
      await onVerify(value);
    } catch (err) {
      reportAuthUiError('verifyOtp', err);
      if (!mounted.current) return;
      setError(getAuthDisplayMessage(err, 'Invalid code'));
      setHasError(true);
      setCode('');
    } finally {
      pending.current = false;
      if (mounted.current) setLoading(false);
    }
  }

  async function handleResend() {
    if (pending.current || !mounted.current || countdown > 0 || !onResend) return;
    pending.current = true;
    setResending(true);
    try {
      await onResend();
      if (!mounted.current) return;
      setCountdown(resendCooldown);
      setError(null);
      setHasError(false);
    } catch (err) {
      reportAuthUiError('resendOtp', err);
      if (mounted.current) setError(getAuthDisplayMessage(err, 'Failed to resend'));
    } finally {
      pending.current = false;
      if (mounted.current) setResending(false);
    }
  }

  return (
    <div className={cn('space-y-4', className)}>
      <AuthHeader
        title={title}
        description={description ?? `Enter the code sent to ${destination}`}
      />

      <div className="flex flex-col items-center gap-3">
        <OTPInput
          length={length}
          value={code}
          onChange={(v) => {
            setCode(v);
            setHasError(false);
          }}
          onComplete={handleVerify}
          error={hasError}
          disabled={loading || resending}
        />

        {loading && (
          <div role="status" aria-live="polite">
            <AnimateIcon animate loop>
              <Loader size={16} className="text-muted-foreground" />
            </AnimateIcon>
            <span className="sr-only">Verifying code</span>
          </div>
        )}

        <AnimatePresence>
          {error && (
            <motion.div
              initial={authFeedbackInitial}
              animate={authFeedbackAnimate}
              exit={authFeedbackExit}
              transition={authPresenceTransition}
              className="w-full overflow-hidden"
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
      </div>

      {onResend && (
        <div className="text-center">
          {countdown > 0 ? (
            <p className="text-xs text-muted-foreground">
              Resend code in <span className="font-medium tabular-nums">{countdown}s</span>
            </p>
          ) : (
            <button
              type="button"
              onClick={handleResend}
              disabled={loading || resending}
              aria-busy={resending}
              className="text-xs text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resending ? 'Resending code' : 'Resend code'}
            </button>
          )}
        </div>
      )}

      {onBack && (
        <p className="text-center">
          <button type="button" onClick={onBack} className="text-xs text-primary hover:underline">
            Back
          </button>
        </p>
      )}
    </div>
  );
}

export { OTPVerification, type OTPVerificationProps };
