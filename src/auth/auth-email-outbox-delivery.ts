import { discardUndeliveredActionToken } from './auth-action-token-delivery';
import { createActionTokenOrHideCooldown } from './auth-action-token-request';
import type { AuthActionTokenService } from './action-token-service';
import { AuthError, type UserRecord } from './types';
import type { AuthEmailOutboxJob } from './auth-email-outbox-types';
import { AuthEmailDeliveryFailure, type AuthEmailDeliveryOutcome,
  type AuthEmailOutboxDeliveryDeps } from './auth-email-outbox-delivery-types';
import { waitForAuthEmailDelivery } from './auth-email-outbox-abort';
import { classifyAuthEmailFailure } from './auth-email-outbox-failure-classification';
import {
  TenantInvitationEnvelopeError,
  tenantInvitationEnvelopeAad,
} from './auth-tenant-invitation-envelope';

export class AuthEmailOutboxDelivery {
  constructor(private readonly deps: AuthEmailOutboxDeliveryDeps) {}

  async deliver(job: AuthEmailOutboxJob, signal: AbortSignal): Promise<AuthEmailDeliveryOutcome> {
    if (job.kind === 'profile_contact_verification') {
      return this.deliverContactProof(job, signal);
    }
    if (job.kind === 'tenant_invitation') {
      return this.deliverTenantInvitation(job, signal);
    }
    if (job.kind === 'domain_mailbox_proof') {
      return this.deliverDomainMailboxProof(job, signal);
    }
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

  private async deliverContactProof(job: AuthEmailOutboxJob, signal: AbortSignal): Promise<AuthEmailDeliveryOutcome> {
    const contacts = this.deps.getUserContactService?.();
    if (!contacts || contacts.capabilities().state !== 'ready') return suppressed('contact_verification_unavailable');
    const created = contacts.createEmailDelivery(job.jobId, job.recipient);
    if (!created) return suppressed('account_not_eligible');
    try {
      await waitForAuthEmailDelivery(this.deps.email.sendContactVerification({ ...created,
        deliveryId: `${job.jobId}:${job.attempts}`, signal }), signal);
      contacts.assertEmailDeliveryCurrent(job.jobId);
      return { status: 'delivered', userId: created.user.userId };
    } catch (error) {
      // A lost provider receipt must not invalidate an already delivered sibling link.
      // Challenge generation and expiry bound every retained token.
      throw failure(error, created.user.userId, false);
    }
  }

  private async deliverDomainMailboxProof(
    job: AuthEmailOutboxJob,
    signal: AbortSignal,
  ): Promise<AuthEmailDeliveryOutcome> {
    const service = this.deps.getVerifiedDomainOnboarding?.();
    if (!service || !job.domainUserId || !job.domainEmailGeneration
      || job.domainAuthGeneration === null || !job.domainIdentityKind) {
      return suppressed('domain_onboarding_unavailable');
    }
    const created = service.createMailboxDelivery({
      jobId: job.jobId,
      userId: job.domainUserId,
      email: job.recipient,
      emailGeneration: job.domainEmailGeneration,
      authGeneration: job.domainAuthGeneration,
      identityKind: job.domainIdentityKind,
      identityContinuationId: job.domainIdentityContinuationId,
    });
    if (!created) return suppressed('account_not_eligible', undefined);
    try {
      await waitForAuthEmailDelivery(this.deps.email.sendDomainMailboxProof({
        ...created,
        // Each attempt owns a different token. An attempt-specific provider
        // key prevents accidental dedupe from accepting only an older link.
        deliveryId: `${job.jobId}:${job.attempts}`,
        signal,
      }), signal);
      return { status: 'delivered', userId: created.user.userId };
    } catch (error) {
      // The provider may have accepted the message before its response was
      // lost. Retain this bounded sibling token until consumption/expiry.
      throw failure(error, created.user.userId, false);
    }
  }

  private async deliverTenantInvitation(
    job: AuthEmailOutboxJob,
    signal: AbortSignal,
  ): Promise<AuthEmailDeliveryOutcome> {
    const invitationId = job.invitationId;
    const envelope = job.secretEnvelope;
    const envelopeService = this.deps.invitationEnvelope;
    const onboarding = this.deps.getTenantOnboarding?.();
    if (!invitationId || !envelope || !envelopeService || !onboarding) {
      throw new AuthEmailDeliveryFailure(
        'TENANT_INVITATION_DELIVERY_STATE_INVALID',
        false,
        undefined,
        false,
      );
    }
    let rawToken: string;
    try {
      rawToken = envelopeService.decrypt(
        envelope,
        tenantInvitationEnvelopeAad(job.jobId, invitationId, job.recipient),
      );
    } catch (error) {
      const code = error instanceof TenantInvitationEnvelopeError
        ? error.code
        : 'TENANT_INVITATION_ENVELOPE_AUTHENTICATION_FAILED';
      throw new AuthEmailDeliveryFailure(code, false, undefined, false);
    }
    const delivery = onboarding.resolveInvitationDelivery({
      invitationId,
      recipient: job.recipient,
      rawToken,
    });
    if (!delivery) return suppressed('invitation_unavailable');
    try {
      await waitForAuthEmailDelivery(this.deps.email.sendTenantInvitation({
        delivery,
        rawToken,
        // One key for every retry prevents duplicate provider acceptance.
        deliveryId: job.jobId,
        signal,
      }), signal);
      return { status: 'delivered' };
    } catch (error) {
      const classified = classifyAuthEmailFailure(error);
      throw new AuthEmailDeliveryFailure(
        classified.code,
        classified.retryable,
        undefined,
        false,
      );
    }
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
        type: job.kind === 'password_reset'
          ? 'password_reset'
          : 'email_verification',
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
