/**
 * auth-action-token-delivery.ts
 *
 * Validates auth-email delivery results and cleans up one-time action tokens
 * whose email delivery failed. This prevents a rejected recipient from
 * activating an account gate or holding the request cooldown open.
 */

import type { EmailSendResult } from '../email/types';
import type { AuthActionTokenService } from './action-token-service';
import { AuthError } from './types';
import { EmailError } from '../email/email-error';

/** Fail closed when the provider resolves without accepting the intended recipient. */
export function assertAuthEmailRecipientAccepted(
  result: EmailSendResult,
  recipient: string
): void {
  const target = normalizeRecipient(recipient);
  const accepted = result.accepted.some((value) => normalizeRecipient(value) === target);
  const rejected = result.rejected?.some((value) => normalizeRecipient(value) === target) ?? false;
  if (accepted && !rejected) return;

  throw new AuthError(
    'Email provider rejected the intended recipient',
    'EMAIL_DELIVERY_REJECTED',
    502
  );
}

/** Delete an action token that never reached its recipient and report success. */
export function discardUndeliveredActionToken(
  service: AuthActionTokenService,
  rawToken: string,
  failure?: unknown,
): boolean {
  // A provider may already have accepted this exact link. Keep its ordinary
  // expiry/single-use checks; a missing audit receipt is not proof of nondelivery.
  if (failure instanceof EmailError && failure.code === 'EMAIL_SEND_OUTCOME_UNKNOWN') return false;
  try {
    return service.revokeUndelivered(rawToken);
  } catch {
    // Delivery already failed; cleanup is best-effort and must preserve it.
    return false;
  }
}

function normalizeRecipient(value: string): string {
  return value.trim().toLowerCase();
}
