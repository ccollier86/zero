'use client';

/**
 * mfa-continuation.tsx
 *
 * Chooses the correct MFA continuation UI for auth responses. This file owns
 * response-to-component routing only; each form owns its own interaction.
 */

import type {
  AuthCompletionResult,
  AuthMfaChallengeRequiredResult,
  AuthMfaSetupRequiredResult,
} from '../../frontend/client/auth-client';
import { MFAChallengeForm } from './mfa-challenge-form';
import { MFAEnrollmentForm } from './mfa-enrollment-form';

export interface MFAContinuationProps {
  result: AuthMfaSetupRequiredResult | AuthMfaChallengeRequiredResult;
  onSuccess?: () => void;
  onComplete?: (result: AuthCompletionResult) => void;
  onBack?: () => void;
  className?: string;
}
/** Render MFA setup or challenge for an incomplete auth response. */
export function MFAContinuation({
  result,
  onSuccess,
  onComplete,
  onBack,
  className,
}: MFAContinuationProps) {
  if ('mfaSetupRequired' in result) {
    return (
      <MFAEnrollmentForm
        setupToken={result.mfaSetupToken}
        methods={result.mfa.methods}
        allowUserChoice={result.mfa.allowUserChoice}
        onSuccess={onSuccess}
        onComplete={onComplete}
        onBack={onBack}
        className={className}
      />
    );
  }

  return (
    <MFAChallengeForm
      challengeToken={result.mfaChallenge.challengeToken}
      method={result.mfaChallenge.method}
      challenge={result.mfaChallenge.challenge}
      onSuccess={onSuccess}
      onComplete={onComplete}
      onBack={onBack}
      className={className}
    />
  );
}
