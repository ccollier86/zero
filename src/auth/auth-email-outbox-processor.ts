import { emitAuthEmailDelivered, emitAuthEmailFailed, emitAuthEmailSuppressed } from './auth-email-outbox-observability';
import { authEmailRetryAt } from './auth-email-outbox-backoff';
import { AuthEmailDeliveryFailure } from './auth-email-outbox-delivery-types';
import type { AuthEmailOutboxDelivery } from './auth-email-outbox-delivery';
import type { AuthEmailOutboxStore } from './auth-email-outbox-store';
import type { AuthEmailOutboxJob, AuthEmailOutboxOptions } from './auth-email-outbox-types';

export class AuthEmailOutboxProcessor {
  private readonly active = new Set<AbortController>();
  constructor(
    private readonly store: AuthEmailOutboxStore,
    private readonly delivery: AuthEmailOutboxDelivery,
    private readonly options: AuthEmailOutboxOptions,
    private readonly clock: () => number
  ) {}

  async process(job: AuthEmailOutboxJob): Promise<void> {
    const controller = new AbortController();
    this.active.add(controller);
    const timeout = setTimeout(() => controller.abort('timeout'), this.options.deliveryTimeoutMs);
    const heartbeat = setInterval(() => {
      const now = this.clock();
      if (!this.store.extendLease(job, now + this.options.leaseMs, now)) {
        controller.abort('lease_lost');
      }
    }, Math.max(100, Math.floor(this.options.leaseMs / 3)));
    timeout.unref?.(); heartbeat.unref?.();
    try {
      const outcome = await this.delivery.deliver(job, controller.signal);
      if (!this.store.complete(job, outcome.status, this.clock())) return;
      if (outcome.status === 'delivered') emitAuthEmailDelivered(job, outcome.userId);
      else emitAuthEmailSuppressed(job, outcome.reason ?? 'policy', outcome.userId);
    } catch (error) {
      const failure = error instanceof AuthEmailDeliveryFailure
        ? error
        : new AuthEmailDeliveryFailure('EMAIL_OUTBOX_FAILED', true, undefined, false);
      const now = this.clock();
      if (failure.code === 'EMAIL_DELIVERY_ABORTED') {
        this.store.release(job, now);
        return;
      }
      const retry = failure.retryable && job.attempts < this.options.maxAttempts;
      const retryAt = retry ? authEmailRetryAt({
        now,
        attempt: job.attempts,
        jobId: job.jobId,
        baseMs: this.options.baseBackoffMs,
        maxMs: this.options.maxBackoffMs,
      }) : null;
      if (!this.store.fail(job, safeCode(failure.code), retryAt, now)) return;
      emitAuthEmailFailed(job, {
        code: safeCode(failure.code),
        cleanupSucceeded: failure.cleanupSucceeded,
        retry,
        userId: failure.userId,
      });
    } finally {
      this.active.delete(controller);
      clearTimeout(timeout); clearInterval(heartbeat);
    }
  }

  abortAll(): void {
    for (const controller of this.active) controller.abort('shutdown');
  }
}

function safeCode(value: string): string {
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : 'EMAIL_OUTBOX_FAILED';
}
