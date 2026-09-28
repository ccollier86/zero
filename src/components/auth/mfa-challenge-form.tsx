'use client';

/**
 * mfa-challenge-form.tsx
 *
 * Renders MFA challenge verification during login. This file owns challenge UI
 * only; challenge issuance and token exchange remain in auth services.
 */

import * as React from 'react';

import type {
  AuthCompletionResult,
  AuthMfaChallenge,
  AuthMfaMethod,
} from '../../frontend/client/auth-client';
import { useAuth } from '../../frontend/client/auth-hooks';
import { cn } from '#zero/lib/utils';
import { OTPVerification } from '#zero/components/auth/otp-verification';

export interface MFAChallengeFormProps {
  challengeToken: string;
  method: AuthMfaMethod;
  challenge?: AuthMfaChallenge;
  onSuccess?: () => void;
  onComplete?: (result: AuthCompletionResult) => void;
  onBack?: () => void;
  className?: string;
}
/** Verify a login MFA challenge and continue after the AuthClient stores tokens. */
export function MFAChallengeForm(props: MFAChallengeFormProps) {
  return (
    <MFAChallengeFormScope
      key={mfaChallengeFlowKey(
        props.challengeToken,
        props.challenge?.challengeId,
      )}
      {...props}
    />
  );
}

function MFAChallengeFormScope({
  challengeToken,
  method,
  onSuccess,
  onComplete,
  onBack,
  className,
}: MFAChallengeFormProps) {
  const { verifyMfaChallenge } = useAuth();
  const destination = method.type === 'email' ? 'your email' : 'your authenticator app';

  async function handleVerify(code: string) {
    const result = await verifyMfaChallenge({ challengeToken, code });
    if (!result) return;
    onComplete?.(result);
    if ('accessToken' in result) onSuccess?.();
  }

  return (
    <OTPVerification
      title="Two-factor verification"
      description={`Enter the code from ${destination}.`}
      destination={destination}
      onVerify={handleVerify}
      onBack={onBack}
      className={cn(className)}
    />
  );
}

/** @internal Reset boundary for one-time MFA challenges. */
export function mfaChallengeFlowKey(
  challengeToken: string,
  challengeId?: string,
): string {
  // Challenge completion may establish the user session before callbacks run.
  return JSON.stringify([challengeToken, challengeId ?? null]);
}
