import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import {
  emitPasswordResetSuppressed,
  type PasswordResetSuppressionReason,
} from './auth-action-token-request';
import type { AuthEmailEnqueueResult } from './auth-email-outbox-store';
import type { AuthEmailOutboxJob, AuthEmailOutboxKind } from './auth-email-outbox-types';

export function emitAuthEmailQueued(kind: AuthEmailOutboxKind, result: AuthEmailEnqueueResult) {
  const requested = kind === 'password_reset'
    ? OBS_CODES.AUTH_PASSWORD_RESET_REQUESTED
    : kind === 'email_verification'
      ? OBS_CODES.AUTH_EMAIL_VERIFICATION_REQUESTED
      : null;
  if (requested) emitPlatformCode(requested, { metadata: { source: 'outbox' } });
  emitPlatformCode(OBS_CODES.AUTH_EMAIL_OUTBOX_ENQUEUED, {
    metadata: { kind, result },
  });
  if (result === 'enqueued') return;
  const reason = result === 'duplicate' ? 'request_window' : 'queue_capacity';
  if (kind === 'password_reset' && result === 'duplicate') {
    emitPasswordResetSuppressed('cooldown');
  }
  emitPlatformCode(OBS_CODES.AUTH_EMAIL_OUTBOX_SUPPRESSED, {
    metadata: { kind, reason },
  });
}

export function emitAuthEmailDelivered(job: AuthEmailOutboxJob, userId?: string) {
  if (job.kind === 'tenant_invitation') return;
  const event = job.kind === 'password_reset'
    ? OBS_CODES.AUTH_PASSWORD_RESET_SENT
    : job.kind === 'domain_mailbox_proof'
      ? OBS_CODES.AUTH_DOMAIN_MAILBOX_SENT
      : OBS_CODES.AUTH_EMAIL_VERIFICATION_SENT;
  emitPlatformCode(event, {
    userId,
    metadata: {
      source: job.kind === 'password_reset'
        ? 'forgot-password'
        : job.kind === 'domain_mailbox_proof' ? 'domain-onboarding' : 'resend',
    },
  });
}

export function emitAuthEmailSuppressed(
  job: AuthEmailOutboxJob, reason: string, userId?: string
) {
  if (job.kind === 'password_reset') {
    emitPasswordResetSuppressed(reason as PasswordResetSuppressionReason, userId);
  }
  emitPlatformCode(OBS_CODES.AUTH_EMAIL_OUTBOX_SUPPRESSED, {
    userId,
    metadata: { kind: job.kind, reason },
  });
}

export function emitAuthEmailFailed(job: AuthEmailOutboxJob, input: {
  code: string; cleanupSucceeded: boolean; retry: boolean; userId?: string;
}) {
  const deliveryEvent = job.kind === 'tenant_invitation'
    ? null
    : job.kind === 'password_reset'
    ? OBS_CODES.AUTH_PASSWORD_RESET_DELIVERY_FAILED
    : job.kind === 'domain_mailbox_proof'
      ? OBS_CODES.AUTH_DOMAIN_MAILBOX_DELIVERY_FAILED
      : OBS_CODES.AUTH_EMAIL_VERIFICATION_DELIVERY_FAILED;
  if (deliveryEvent) emitPlatformCode(deliveryEvent, {
    userId: input.userId,
    metadata: {
      source: job.kind === 'password_reset' ? 'forgot-password' : 'resend',
      cleanupSucceeded: input.cleanupSucceeded,
    },
  });
  emitPlatformCode(input.retry ? OBS_CODES.AUTH_EMAIL_OUTBOX_RETRY : OBS_CODES.AUTH_EMAIL_OUTBOX_DEAD, {
    userId: input.userId,
    metadata: { kind: job.kind, code: input.code, attempt: job.attempts },
  });
}
