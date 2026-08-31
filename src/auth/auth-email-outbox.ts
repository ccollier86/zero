import type { ReactiveDB } from '../sync/reactive-db';
import { emitAuthEmailQueued } from './auth-email-outbox-observability';
import { AuthEmailOutboxDelivery } from './auth-email-outbox-delivery';
import type { AuthEmailOutboxDeliveryDeps } from './auth-email-outbox-delivery-types';
import { AuthEmailOutboxProcessor } from './auth-email-outbox-processor';
import { AuthEmailOutboxStore, type AuthEmailEnqueueResult } from './auth-email-outbox-store';
import { AuthEmailOutboxWorker } from './auth-email-outbox-worker';
import type { AuthEmailOutboxKind, AuthEmailOutboxOptions } from './auth-email-outbox-types';
import { resolveAuthEmailOutboxOptions } from './auth-email-outbox-options';
import { canonicalizeEmail } from './auth-email-identity';

export class AuthEmailOutbox {
  private readonly store: AuthEmailOutboxStore;
  private readonly worker: AuthEmailOutboxWorker;
  private readonly options: AuthEmailOutboxOptions;

  constructor(db: ReactiveDB, deliveryDeps: AuthEmailOutboxDeliveryDeps,
    options: Partial<AuthEmailOutboxOptions> = {}, private readonly clock = Date.now) {
    this.options = resolveAuthEmailOutboxOptions(options);
    this.store = new AuthEmailOutboxStore(db, `aew_${crypto.randomUUID()}`);
    const delivery = new AuthEmailOutboxDelivery(deliveryDeps);
    const processor = new AuthEmailOutboxProcessor(this.store, delivery, this.options, clock);
    this.worker = new AuthEmailOutboxWorker(this.store, processor, this.options, clock);
  }

  enqueue(input: { kind: AuthEmailOutboxKind; recipient: string;
    nativeContinuation?: string }): AuthEmailEnqueueResult {
    const normalized = { ...input, recipient: canonicalizeEmail(input.recipient) };
    const result = this.store.enqueue(normalized, this.clock(),
      this.options.requestWindowMs, this.options.maxActiveJobs,
      this.options.maxStoredJobs);
    emitAuthEmailQueued(input.kind, result);
    if (result === 'enqueued') this.worker.wake();
    return result;
  }

  start(automatic = true): void { this.worker.start(automatic); }
  stop(): Promise<void> { return this.worker.stop(); }
  processDue(): Promise<number> { return this.worker.processDue(); }
  count(status: 'pending' | 'processing' | 'delivered' | 'suppressed' | 'dead'): number {
    return this.store.count(status);
  }
}
