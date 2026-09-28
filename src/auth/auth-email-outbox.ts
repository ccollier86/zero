import type { ReactiveDB } from '../sync/reactive-db';
import { emitAuthEmailQueued } from './auth-email-outbox-observability';
import { AuthEmailOutboxDelivery } from './auth-email-outbox-delivery';
import type { AuthEmailOutboxDeliveryDeps } from './auth-email-outbox-delivery-types';
import { AuthEmailOutboxProcessor } from './auth-email-outbox-processor';
import { AuthEmailOutboxStore, type AuthEmailEnqueueResult } from './auth-email-outbox-store';
import { AuthEmailOutboxWorker } from './auth-email-outbox-worker';
import type {
  AuthEmailAccountLinkKind,
  AuthEmailOutboxOptions,
} from './auth-email-outbox-types';
import { resolveAuthEmailOutboxOptions } from './auth-email-outbox-options';
import { canonicalizeEmail } from './auth-email-identity';
import {
  AuthTenantInvitationEnvelope,
  tenantInvitationEnvelopeAad,
} from './auth-tenant-invitation-envelope';
import type { DomainMailboxJobBinding } from './verified-domain-service';

export class AuthEmailOutbox {
  private readonly store: AuthEmailOutboxStore;
  private readonly worker: AuthEmailOutboxWorker;
  private readonly options: AuthEmailOutboxOptions;
  private readonly invitationEnvelope: AuthTenantInvitationEnvelope | null;
  private readonly assertCurrentProfile: () => void;

  constructor(db: ReactiveDB, deliveryDeps: AuthEmailOutboxDeliveryDeps,
    options: Partial<AuthEmailOutboxOptions> = {}, private readonly clock = Date.now) {
    this.options = resolveAuthEmailOutboxOptions(options);
    this.assertCurrentProfile = () => deliveryDeps.store.assertCurrentProfile();
    this.store = new AuthEmailOutboxStore(
      db,
      `aew_${crypto.randomUUID()}`,
      this.assertCurrentProfile,
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
    const processor = new AuthEmailOutboxProcessor(this.store, delivery, this.options, clock);
    this.worker = new AuthEmailOutboxWorker(this.store, processor, this.options, clock);
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
      throw new Error('[auth] Tenant invitation delivery is unavailable.');
    }
    const recipient = canonicalizeEmail(input.recipient);
    const jobId = `aem_${crypto.randomUUID()}`;
    const envelope = this.invitationEnvelope.encrypt(
      input.rawToken,
      tenantInvitationEnvelopeAad(jobId, input.invitationId, recipient),
    );
    const result = this.store.enqueueInvitation({
      invitationId: input.invitationId,
      recipient,
      recipientHash: hashRecipient(recipient),
      secretEnvelope: envelope,
      jobId,
    }, this.clock(), this.options.maxActiveJobs, this.options.maxStoredJobs);
    emitAuthEmailQueued('tenant_invitation', result);
    if (result === 'enqueued') this.worker.wake();
    return { result, jobId };
  }

  enqueue(input: { kind: AuthEmailAccountLinkKind; recipient: string;
    nativeContinuation?: string }): AuthEmailEnqueueResult {
    this.assertCurrentProfile();
    const normalized = { ...input, recipient: canonicalizeEmail(input.recipient) };
    const result = this.store.enqueue(normalized, this.clock(),
      this.options.requestWindowMs, this.options.maxActiveJobs,
      this.options.maxStoredJobs);
    emitAuthEmailQueued(input.kind, result);
    if (result === 'enqueued') this.worker.wake();
    return result;
  }

  enqueueDomainMailboxProof(input: DomainMailboxJobBinding): AuthEmailEnqueueResult {
    this.assertCurrentProfile();
    const recipient = canonicalizeEmail(input.email);
    const result = this.store.enqueueDomainMailbox({
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
    emitAuthEmailQueued('domain_mailbox_proof', result);
    if (result === 'enqueued') this.worker.wake();
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
