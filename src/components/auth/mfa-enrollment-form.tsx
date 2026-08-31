'use client';

/**
 * mfa-enrollment-form.tsx
 *
 * Renders email OTP or authenticator MFA enrollment. This file owns setup UI
 * state only; the backend owns challenge creation, TOTP secrets, and session
 * completion.
 */

import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';

import type {
  AuthMfaMethodType,
  AuthMfaSetupStartResult,
} from '../../frontend/client/auth-client';
import { useAuth } from '../../frontend/client/auth-hooks';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { QRCode } from '@/components/qr-code';
import { AuthHeader } from '@/components/auth/auth-header';
import { OTPVerification } from '@/components/auth/otp-verification';
import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { CircleX } from '@/components/animate-ui/icons/circle-x';
import { Copy } from '@/components/animate-ui/icons/copy';
import { Key } from '@/components/animate-ui/icons/key';
import { Loader } from '@/components/animate-ui/icons/loader';
import { Send } from '@/components/animate-ui/icons/send';
import {
  authFeedbackAnimate,
  authFeedbackExit,
  authFeedbackInitial,
  authPresenceTransition,
} from './auth-motion';

export interface MFAEnrollmentFormProps {
  setupToken?: string;
  methods?: AuthMfaMethodType[];
  allowUserChoice?: boolean;
  preferredMethod?: AuthMfaMethodType;
  onSuccess?: () => void;
  onBack?: () => void;
  className?: string;
}

const DEFAULT_METHODS: AuthMfaMethodType[] = ['totp', 'email'];

/** Start and verify MFA enrollment for auth or profile settings flows. */
export function MFAEnrollmentForm({
  setupToken,
  methods = DEFAULT_METHODS,
  allowUserChoice = true,
  preferredMethod,
  onSuccess,
  onBack,
  className,
}: MFAEnrollmentFormProps) {
  const { startMfaSetup, verifyMfaSetup } = useAuth();
  const availableMethods = React.useMemo(
    () => methods.length > 0 ? methods : DEFAULT_METHODS,
    [methods],
  );
  const initialMethod = preferredMethod && availableMethods.includes(preferredMethod)
    ? preferredMethod
    : availableMethods[0];
  const [method, setMethod] = React.useState<AuthMfaMethodType>(initialMethod);
  const [setup, setSetup] = React.useState<AuthMfaSetupStartResult | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const shouldChooseMethod = allowUserChoice && availableMethods.length > 1 && !setup;

  React.useEffect(() => {
    if (!availableMethods.includes(method)) setMethod(availableMethods[0]);
  }, [availableMethods, method]);

  async function beginSetup(nextMethod = method) {
    setStarting(true);
    setError(null);
    try {
      const result = await startMfaSetup({ setupToken, method: nextMethod });
      setSetup(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start two-factor setup');
    } finally {
      setStarting(false);
    }
  }

  async function verifySetup(code: string) {
    if (!setup) return;
    await verifyMfaSetup({ verificationToken: setup.verificationToken, code });
    onSuccess?.();
  }

  async function copySecret() {
    const secret = setup?.totp?.secret;
    if (!secret || typeof navigator === 'undefined') return;
    await navigator.clipboard?.writeText(secret);
  }

  if (shouldChooseMethod) {
    return (
      <div className={cn('space-y-4', className)}>
        <AuthHeader
          title="Set up two-factor"
          description="Choose how you want to verify sign-ins for this account."
        />

        <div className="grid gap-3">
          {availableMethods.map((option) => (
            <button
              key={option}
              type="button"
              className={cn(
                'rounded-lg border border-border/80 bg-card p-4 text-left transition-colors hover:border-primary/45 hover:bg-accent/60',
                method === option && 'border-primary/60 bg-primary/5',
              )}
              onClick={() => setMethod(option)}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                {option === 'totp' ? 'Authenticator app' : 'Email code'}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {option === 'totp'
                  ? 'Use a one-time code from an authenticator app.'
                  : 'Receive one-time codes at your account email.'}
              </span>
            </button>
          ))}
        </div>

        <AuthFeedback message={error} />

        <Button type="button" className="h-10 w-full" disabled={starting} onClick={() => beginSetup()}>
          {starting ? (
            <AnimateIcon animate loop>
              <Loader size={16} />
            </AnimateIcon>
          ) : method === 'totp' ? (
            <Key size={16} />
          ) : (
            <Send size={16} />
          )}
          Continue
        </Button>

        {onBack && (
          <button type="button" onClick={onBack} className="block w-full text-center text-xs text-primary hover:underline">
            Back
          </button>
        )}
      </div>
    );
  }

  if (!setup) {
    return (
      <div className={cn('space-y-4', className)}>
        <AuthHeader
          title="Set up two-factor"
          description={
            method === 'totp'
              ? 'Connect an authenticator app before continuing.'
              : 'Send a one-time code to your account email.'
          }
        />

        <AuthFeedback message={error} />

        <Button type="button" className="h-10 w-full" disabled={starting} onClick={() => beginSetup()}>
          {starting ? (
            <AnimateIcon animate loop>
              <Loader size={16} />
            </AnimateIcon>
          ) : method === 'totp' ? (
            <Key size={16} />
          ) : (
            <Send size={16} />
          )}
          {method === 'totp' ? 'Start authenticator setup' : 'Send email code'}
        </Button>

        {onBack && (
          <button type="button" onClick={onBack} className="block w-full text-center text-xs text-primary hover:underline">
            Back
          </button>
        )}
      </div>
    );
  }

  if (setup.method.type === 'email') {
    return (
      <OTPVerification
        title="Verify email code"
        description="Enter the code sent to your account email."
        destination="your email"
        onVerify={verifySetup}
        onResend={() => beginSetup('email')}
        onBack={onBack}
        className={className}
      />
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      <AuthHeader
        title="Connect authenticator"
        description="Scan the QR code, then enter the six-digit code from your app."
      />

      <div className="flex justify-center">
        <QRCode
          value={setup.totp?.otpauthUrl ?? ''}
          robustness="M"
          title="Authenticator app setup QR code"
          className="h-48 w-48"
        />
      </div>

      {setup.totp?.secret && (
        <Card className="bg-muted/25">
          <CardContent className="space-y-2 p-3">
            <Label htmlFor="mfa-secret" className="text-xs text-muted-foreground">
              Manual setup key
            </Label>
            <div className="flex gap-2">
              <Input
                id="mfa-secret"
                readOnly
                value={setup.totp.secret}
                className="h-9 min-w-0 font-mono text-xs"
              />
              <Button type="button" variant="outline" size="icon-sm" onClick={copySecret} aria-label="Copy setup key">
                <Copy size={15} />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <OTPVerification
        title="Verify authenticator"
        description="Enter the current code from your authenticator app."
        destination="your authenticator app"
        onVerify={verifySetup}
        onBack={onBack}
      />
    </div>
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
