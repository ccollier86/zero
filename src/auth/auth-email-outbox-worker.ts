import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { AuthEmailOutboxStore } from './auth-email-outbox-store';
import type { AuthEmailOutboxOptions } from './auth-email-outbox-types';
import { AuthError } from './types';

export class AuthEmailOutboxWorker {
  private stopped = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<number> | null = null;
  private nextCleanupAt = 0;
  constructor(private readonly store: Pick<AuthEmailOutboxStore,
    'assertCurrentProfile' | 'claim' | 'recoverExpired' | 'cleanup'>,
    private readonly processor: {
      process(job: NonNullable<ReturnType<AuthEmailOutboxStore['claim']>>): Promise<void>;
      abortAll?(): void;
    },
    private readonly options: AuthEmailOutboxOptions,
    private readonly clock: () => number) {}

  start(automatic = true): void {
    try {
      this.store.assertCurrentProfile();
    } catch (error) {
      this.quiesceOnProfileChange(error);
      throw error;
    }
    if (!this.stopped) return;
    this.stopped = false;
    const now = this.clock();
    const recovered = this.store.recoverExpired(now);
    this.store.cleanup(now - this.options.terminalRetentionMs);
    this.nextCleanupAt = now + cleanupCadence(this.options.terminalRetentionMs);
    if (recovered > 0) emitPlatformCode(OBS_CODES.AUTH_EMAIL_OUTBOX_RECOVERED, {
      metadata: { count: recovered },
    });
    if (automatic) this.schedule(0);
  }

  wake(): void {
    if (this.stopped) return;
    try {
      this.store.assertCurrentProfile();
    } catch (error) {
      this.quiesceOnProfileChange(error);
      throw error;
    }
    this.schedule(0);
  }

  async processDue(): Promise<number> {
    try {
      this.store.assertCurrentProfile();
      if (this.running) return this.running;
      const run = this.drain();
      this.running = run;
      try {
        return await run;
      } finally {
        if (this.running === run) this.running = null;
      }
    } catch (error) {
      this.quiesceOnProfileChange(error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.processor.abortAll?.();
    if (this.running) {
      await this.running.catch(() => {
        emitPlatformCode(OBS_CODES.AUTH_EMAIL_OUTBOX_WORKER_FAILED, {
          metadata: { stage: 'shutdown_join' },
        });
      });
    }
  }

  private async drain(): Promise<number> {
    this.store.assertCurrentProfile();
    let processed = 0;
    const now = this.clock();
    if (now >= this.nextCleanupAt) {
      this.store.cleanup(now - this.options.terminalRetentionMs);
      this.nextCleanupAt = now + cleanupCadence(this.options.terminalRetentionMs);
    }
    while (!this.stopped) {
      this.store.assertCurrentProfile();
      const jobs = Array.from({ length: this.options.concurrency }, () =>
        this.store.claim(this.clock(), this.options.leaseMs)).filter(Boolean);
      if (jobs.length === 0) break;
      await Promise.all(jobs.map((job) => this.processor.process(job!)));
      this.store.assertCurrentProfile();
      processed += jobs.length;
    }
    return processed;
  }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.processDue().catch(() => {
        emitPlatformCode(OBS_CODES.AUTH_EMAIL_OUTBOX_WORKER_FAILED, {
          metadata: { stage: 'process_due' },
        });
      }).finally(() => {
        if (!this.stopped) this.schedule(this.options.pollMs);
      });
    }, delay);
    this.timer.unref?.();
  }

  private quiesceOnProfileChange(error: unknown): void {
    if (!(error instanceof AuthError) || error.code !== 'AUTH_PROFILE_CHANGED') return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.processor.abortAll?.();
  }
}

function cleanupCadence(retentionMs: number): number {
  return Math.min(3_600_000, Math.max(60_000, Math.floor(retentionMs / 4)));
}
