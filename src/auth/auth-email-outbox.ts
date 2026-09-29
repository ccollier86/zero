import type { ReactiveDB } from '../sync/reactive-db';
import { emitAuthEmailQueued } from './auth-email-outbox-observability';
import { AuthEmailOutboxDelivery } from './auth-email-outbox-delivery';
import type { AuthEmailOutboxDeliveryDeps } from './auth-email-outbox-delivery-types';
import { AuthEmailOutboxProcessor } from './auth-email-outbox-processor';
import { AuthEmailOutboxStore, type AuthEmailEnqueueResult } from './auth-email-outbox-store';
import { AuthEmailOutboxWorker } from './auth-email-outbox-worker';
import type {
  AuthEmailAccountLinkKind,
  AuthEmailOutboxKind,
  AuthEmailOutboxOptions,
} from './auth-email-outbox-types';
import { resolveAuthEmailOutboxOptions } from './auth-email-outbox-options';
import { canonicalizeEmail } from './auth-email-identity';
import {
  AuthTenantInvitationEnvelope,
  tenantInvitationEnvelopeAad,
} from './auth-tenant-invitation-envelope';
import type { DomainMailboxJobBinding } from './verified-domain-service';
import { emitPlatformCode } from '../observability/sink';
import {
  createAuthStateInvariantError,
  type AuthPlatformCodeEmitter,
} from './auth-observability';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import { AuthError } from './types';

export class AuthEmailOutbox {
  private readonly store: AuthEmailOutboxStore;
  private readonly worker: AuthEmailOutboxWorker;
  private readonly options: AuthEmailOutboxOptions;
  private readonly invitationEnvelope: AuthTenantInvitationEnvelope | null;
  private readonly assertCurrentProfile: () => void;
  private readonly emitCode: AuthPlatformCodeEmitter;

  constructor(private readonly db: ReactiveDB, deliveryDeps: AuthEmailOutboxDeliveryDeps,
    options: Partial<AuthEmailOutboxOptions> = {}, private readonly clock = Date.now) {
    this.options = resolveAuthEmailOutboxOptions(options);
    this.emitCode = deliveryDeps.emitCode ?? emitPlatformCode;
    this.assertCurrentProfile = () => deliveryDeps.store.assertCurrentProfile();
    this.store = new AuthEmailOutboxStore(
      db,
      `aew_${crypto.randomUUID()}`,
      this.assertCurrentProfile,
      this.emitCode,
    );
    const columns = db.prepare('PRAGMA table_info(_auth_email_outbox)').all() as unknown as Array<{ name: string }>;
    const invitationCapable = columns.some(
      (column) => column.name === 'secret_envelope',
    );
    const invitationEmail = deliveryDeps.config.tenancy?.onboarding
      ?.invitations.delivery.email;
    const wrappingKey = invitationEmail?.encryptionKey;
    this.invitationEnvelope = invitationCapable && wrappingKey
      ? new AuthTenantInvitationEnvelope(
          db,
          wrappingKey,
          invitationEmail.previousEncryptionKeys,
        )
      : null;
    const delivery = new AuthEmailOutboxDelivery({
      ...deliveryDeps,
      invitationEnvelope: this.invitationEnvelope,
    });
    const processor = new AuthEmailOutboxProcessor(
      this.store,
      delivery,
      this.options,
      clock,
      this.emitCode,
    );
    this.worker = new AuthEmailOutboxWorker(
      this.store,
      processor,
      this.options,
      clock,
      this.emitCode,
    );
  }

  /**
   * Queue an exact invitation secret inside the caller's issuance transaction.
   * Only an authenticated envelope reaches durable storage.
   */
  enqueueInvitation(input: {
    invitationId: string;
    recipient: string;
    rawToken: string;
  }): { result: 'enqueued' | 'capacity'; jobId: string } {
    this.assertCurrentProfile();
    if (!this.invitationEnvelope) {
      throw createAuthStateInvariantError(this.emitCode, {
        component: 'auth-email-outbox',
        invariant: 'tenant-invitation-delivery-unavailable',
        message: '[auth] Tenant invitation delivery is unavailable.',
      });
    }
    const recipient = canonicalizeEmail(input.recipient);
    const jobId = `aem_${crypto.randomUUID()}`;
    const envelope = this.invitationEnvelope.encrypt(
      input.rawToken,
      tenantInvitationEnvelopeAad(jobId, input.invitationId, recipient),
    );
    const result = this.enqueueTransactionally('tenant_invitation', () => {
      return this.store.enqueueInvitation({
        invitationId: input.invitationId,
        recipient,
        recipientHash: hashRecipient(recipient),
        secretEnvelope: envelope,
        jobId,
      }, this.clock(), this.options.maxActiveJobs, this.options.maxStoredJobs);
    });
    return { result, jobId };
  }

  enqueue(input: { kind: AuthEmailAccountLinkKind; recipient: string;
    nativeContinuation?: string }): AuthEmailEnqueueResult {
    this.assertCurrentProfile();
    const normalized = { ...input, recipient: canonicalizeEmail(input.recipient) };
    return this.enqueueTransactionally(input.kind, () => {
      return this.store.enqueue(normalized, this.clock(),
        this.options.requestWindowMs, this.options.maxActiveJobs,
        this.options.maxStoredJobs);
    });
  }

  enqueueDomainMailboxProof(
    input: DomainMailboxJobBinding,
    admit: () => boolean = () => true,
  ): AuthEmailEnqueueResult {
    this.assertCurrentProfile();
    const recipient = canonicalizeEmail(input.email);
    return this.enqueueTransactionally('domain_mailbox_proof', () => {
      if (!invokeSynchronousAuthCallback(admit, {
        component: 'auth-email-outbox',
        invariant: 'domain-mailbox-enqueue-admission-async',
        message: '[auth] Domain mailbox enqueue admission must be synchronous.',
        emitCode: this.emitCode,
      })) {
        throw new AuthError(
          'Authentication state changed; sign in again',
          'AUTH_STATE_CHANGED',
          409,
        );
      }
      return this.store.enqueueDomainMailbox({
        jobId: `aem_${crypto.randomUUID()}`,
        recipient,
        recipientHash: hashRecipient(recipient),
        userId: input.userId,
        emailGeneration: input.emailGeneration,
        authGeneration: input.authGeneration,
        identityKind: input.identityKind,
        identityContinuationId: input.identityContinuationId,
      }, this.clock(), this.options.requestWindowMs, this.options.maxActiveJobs,
      this.options.maxStoredJobs);
    });
  }

  /**
   * Keep durable enqueue success, its operational event, and worker activity
   * on one commit boundary. Rejections have no durable success to await, so
   * their suppression telemetry is emitted immediately and never wakes work.
   */
  private enqueueTransactionally<Result extends AuthEmailEnqueueResult>(
    kind: AuthEmailOutboxKind,
    persist: () => Result,
  ): Result {
    const result = this.db.transaction(() => {
      const persisted = persist();
      if (persisted === 'enqueued') {
        this.db.afterCommit(() => {
          emitAuthEmailQueued(kind, persisted, this.emitCode);
        });
        this.db.afterCommit(() => this.worker.wake());
      }
      return persisted;
    });
    if (result !== 'enqueued') {
      emitAuthEmailQueued(kind, result, this.emitCode);
    }
    return result;
  }

  start(automatic = true): void {
    this.assertCurrentProfile();
    this.worker.start(automatic);
  }
  stop(): Promise<void> { return this.worker.stop(); }
  processDue(): Promise<number> {
    this.assertCurrentProfile();
    return this.worker.processDue();
  }
  count(status: 'pending' | 'processing' | 'delivered' | 'suppressed' | 'dead'): number {
    this.assertCurrentProfile();
    return this.store.count(status);
  }
}

function hashRecipient(recipient: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(recipient);
  return hasher.digest('hex');
}
