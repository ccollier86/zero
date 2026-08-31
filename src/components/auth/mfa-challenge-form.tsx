'use client';

/**
 * mfa-challenge-form.tsx
 *
 * Renders MFA challenge verification during login. This file owns challenge UI
 * only; challenge issuance and token exchange remain in auth services.
 */

import * as React from 'react';

import type {
  AuthMfaChallenge,
  AuthMfaMethod,
} from '../../frontend/client/auth-client';
import { useAuth } from '../../frontend/client/auth-hooks';
import { cn } from '@/lib/utils';
import { OTPVerification } from '@/components/auth/otp-verification';

export interface MFAChallengeFormProps {
  challengeToken: string;
  method: AuthMfaMethod;
  challenge?: AuthMfaChallenge;
  onSuccess?: () => void;
  onBack?: () => void;
  className?: string;
}
/** Verify a login MFA challenge and continue after the AuthClient stores tokens. */
export function MFAChallengeForm({
  challengeToken,
  method,
  onSuccess,
  onBack,
  className,
}: MFAChallengeFormProps) {
  const { verifyMfaChallenge } = useAuth();
  const destination = method.type === 'email' ? 'your email' : 'your authenticator app';

  async function handleVerify(code: string) {
    await verifyMfaChallenge({ challengeToken, code });
    onSuccess?.();
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
