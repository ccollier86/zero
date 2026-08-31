import { discardUndeliveredActionToken } from './auth-action-token-delivery';
import { createActionTokenOrHideCooldown } from './auth-action-token-request';
import type { AuthActionTokenService } from './action-token-service';
import { AuthError, type UserRecord } from './types';
import type { AuthEmailOutboxJob } from './auth-email-outbox-types';
import { AuthEmailDeliveryFailure, type AuthEmailDeliveryOutcome,
  type AuthEmailOutboxDeliveryDeps } from './auth-email-outbox-delivery-types';
import { waitForAuthEmailDelivery } from './auth-email-outbox-abort';
import { classifyAuthEmailFailure } from './auth-email-outbox-failure-classification';

export class AuthEmailOutboxDelivery {
  constructor(private readonly deps: AuthEmailOutboxDeliveryDeps) {}

  async deliver(job: AuthEmailOutboxJob, signal: AbortSignal): Promise<AuthEmailDeliveryOutcome> {
    if (!this.kindEnabled(job)) return suppressed('policy_disabled');
    const user = this.deps.store.getUserByEmail(job.recipient);
    if (!user) return suppressed('account_not_found');
    if (user.status === 'suspended') return suppressed('account_suspended', user);
    if (job.kind === 'email_verification'
      && (!user.emailVerificationRequired || user.emailVerifiedAt)) {
      return suppressed('account_not_eligible', user);
    }
    const continuation = this.validateContinuation(job, user);
    return this.createAndSend(job, user, continuation, signal);
  }

  private kindEnabled(job: AuthEmailOutboxJob): boolean {
    return job.kind === 'password_reset'
      ? this.deps.config.accountEmails.passwordReset
      : this.deps.config.account.requireEmailVerification;
  }

  private async createAndSend(job: AuthEmailOutboxJob, user: UserRecord,
    continuation: string | null, signal: AbortSignal): Promise<AuthEmailDeliveryOutcome> {
    let created: ReturnType<AuthActionTokenService['create']> | null;
    try {
      created = createActionTokenOrHideCooldown(() => this.deps.tokens.create({
        userId: user.userId,
        type: job.kind,
        metadata: this.metadata(job, user, continuation),
        // The durable outbox request window is this flow's admission control.
        // Lease recovery must not be suppressed by a token left by a crash.
        skipCooldown: job.attempts > 1,
      }));
    } catch (error) {
      if (error instanceof AuthError && error.code === 'USER_NOT_FOUND') {
        return suppressed('account_not_found');
      }
      throw failure(error, user.userId, false);
    }
    if (!created) return suppressed('cooldown', user);
    try {
      const delivery = { user, rawToken: created.rawToken, token: created.record,
        deliveryId: `${job.jobId}:${job.attempts}`, signal };
      const sending = job.kind === 'password_reset'
        ? this.deps.email.sendPasswordReset(delivery)
        : this.deps.email.sendEmailVerification(delivery);
      await waitForAuthEmailDelivery(sending, signal);
      return { status: 'delivered', userId: user.userId };
    } catch (error) {
      const cleaned = discardUndeliveredActionToken(this.deps.tokens, created.rawToken);
      throw failure(error, user.userId, cleaned);
    }
  }

  private validateContinuation(job: AuthEmailOutboxJob, user: UserRecord): string | null {
    if (!job.nativeContinuation) return null;
    const native = this.deps.getNative();
    return job.kind === 'password_reset'
      ? native?.validateAvailableContinuation(job.nativeContinuation) ?? null
      : native?.validateContinuationForUser(job.nativeContinuation, user.userId) ?? null;
  }

  private metadata(job: AuthEmailOutboxJob, user: UserRecord, continuation: string | null) {
    return {
      source: job.kind === 'password_reset' ? 'forgot-password' : 'resend-verification',
      outboxJobId: job.jobId,
      ...(job.kind === 'email_verification' ? {
        mfaEnrollment: this.deps.config.mfa.enabled
          && this.deps.registrationIntents.wantsMfaEnrollment(user.userId),
      } : {}),
      ...(continuation ? { nativeContinuation: continuation } : {}),
    };
  }
}

function suppressed(reason: string, user?: UserRecord): AuthEmailDeliveryOutcome {
  return { status: 'suppressed', reason, userId: user?.userId };
}

function failure(error: unknown, userId: string, cleanup: boolean): AuthEmailDeliveryFailure {
  const classified = classifyAuthEmailFailure(error);
  return new AuthEmailDeliveryFailure(
    classified.code, classified.retryable, userId, cleanup
  );
}
