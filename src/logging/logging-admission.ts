/** Process-local, expiring delivery grants. Durable evidence is committed before a grant exists. */
import type { AuthContext } from '../auth/types';
import { authContextAuthorityFingerprint } from '../auth/auth-context-authority';
import { LoggingError } from './logging-error';
import { loggingDigest } from './logging-hash';
import { captureLoggingEvent } from './logging-validation';
import type { LoggingContext, LoggingEvent, LoggingReceipt } from './logging-contracts';
import type { LoggingAdmissionReceipt } from './logging-admission-contracts';

export interface LoggingAdmissionAuthority {
  readonly auth: AuthContext;
  readonly properties?: Readonly<Record<string, string>>;
}

interface Grant { readonly until: number; readonly expiresAt: number; readonly actor: string; readonly scope: string }

/**
 * A grant is not a credential, authorization decision or browser attestation.
 * The caller must resolve live Guardian authority both before and after waits.
 * Nothing is restored from disk after owner restart: a fresh upload is required.
 */
export class LoggingAdmission {
  private readonly grants = new Map<string, Grant>();
  private readonly pending = new Map<string, Promise<LoggingAdmissionReceipt>>();
  private machineGrants = new WeakMap<object, { key: string; until: number }>();
  private generation = 0;
  private closed = false;

  constructor(
    readonly required: boolean,
    readonly policyVersion: string,
    private readonly deliver: (event: LoggingEvent) => Promise<LoggingReceipt>,
    private readonly clock: () => number = () => performance.now(),
    readonly ttlMs = 60000,
    private readonly capacity = 4096,
    private readonly available: () => boolean = () => true,
    private readonly probe?: (nonce: string) => Promise<void>,
  ) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 30000 || ttlMs > 120000 || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100000) {
      throw new LoggingError('LOGGING_CONFIG_INVALID', 'Logging admission bounds are invalid.');
    }
  }

  /** Synchronous final release/commit fence, after ordinary Guardian authorization. */
  assertCurrent(authority: LoggingAdmissionAuthority, owner?: object): void {
    if (!this.required) return;
    if (!this.available()) throw new LoggingError('LOGGING_ADMISSION_REQUIRED', 'Required audit delivery is unavailable.');
    if (authority.auth.credentialKind === 'api-key' || authority.auth.sessionKind === 'native') {
      const grant = owner ? this.machineGrants.get(owner) : null;
      if (!this.closed && grant?.key === this.key(authority) && grant.until > this.clock()) return;
      throw new LoggingError('LOGGING_ADMISSION_REQUIRED', 'Machine audit admission is required for this operation.');
    }
    const grant = this.grants.get(this.key(authority));
    if (this.closed || !grant || grant.until <= this.clock()) {
      throw new LoggingError('LOGGING_ADMISSION_REQUIRED', 'Audit delivery must be confirmed before protected work continues.');
    }
  }

  /** Only an authenticated, validated upload may call this; it never trusts a browser actor/scope. */
  acknowledge(authority: LoggingAdmissionAuthority, context: LoggingContext, policyVersion: string, revalidate: () => Promise<void>): Promise<LoggingAdmissionReceipt> {
    if (this.closed) return Promise.reject(new LoggingError('LOGGING_CLOSED', 'Logging admission is closed.'));
    if (!this.required || policyVersion !== this.policyVersion || context.policyVersion !== this.policyVersion
      || authority.auth.credentialKind === 'api-key' || authority.auth.sessionKind === 'native' || !authority.auth.sessionId) {
      return Promise.reject(new LoggingError('LOGGING_ADMISSION_REQUIRED', 'A current interactive audit policy and session are required.'));
    }
    const key = this.key(authority), existing = this.pending.get(key);
    if (existing) return existing;
    this.sweep();
    if (!this.grants.has(key) && this.grants.size + this.pending.size >= this.capacity) {
      return Promise.reject(new LoggingError('LOGGING_BACKPRESSURE', 'Audit delivery admission capacity is exhausted.'));
    }
    // Capture immutable trusted evidence before awaiting or sharing a request.
    const started = this.clock(), previous = this.grants.get(key), generation = this.generation;
    const event = captureLoggingEvent(context, { id: crypto.randomUUID(), family: 'security',
      action: previous && previous.until <= started ? 'logging.delivery.recovered' : 'logging.delivery.acknowledged',
      occurredAt: Date.now(), outcome: 'succeeded', evidence: 'server-confirmed' });
    const task = (async () => {
      await revalidate();
      if (previous && previous.until <= started) await this.deliver(captureLoggingEvent(context, {
        id: crypto.randomUUID(), family: 'security', action: 'logging.delivery.interrupted',
        occurredAt: previous.expiresAt, outcome: 'unknown', evidence: 'incomplete',
      }));
      if (previous && previous.until > started && this.probe) await this.probe(crypto.randomUUID());
      else await this.deliver(event);
      // A slow/revoked handshake cannot mint a fresh lease after its owner is retired.
      await revalidate();
      if (this.closed || !this.available() || this.generation !== generation || key !== this.key(authority) || this.clock() - started >= this.ttlMs) throw new LoggingError('LOGGING_ADMISSION_REQUIRED', 'Audit delivery confirmation expired before admission.');
      const receipt = Object.freeze({ policyVersion: this.policyVersion, expiresAt: Date.now() + this.ttlMs });
      this.grants.set(key, { until: this.clock() + this.ttlMs, expiresAt: receipt.expiresAt, actor: authority.auth.userId,
        scope: loggingDigest([authority.auth.sessionScopeKind ?? 'application', authority.auth.tenantId ?? null]) });
      return receipt;
    })().catch(error => { this.grants.delete(key); throw error; })
      .finally(() => { if (this.pending.get(key) === task) this.pending.delete(key); });
    this.pending.set(key, task);
    return task;
  }

  /** Server-owned work proves fresh writer liveness; semantic actions own their audit evidence. */
  async admitMachine(authority: LoggingAdmissionAuthority, context: LoggingContext, revalidate: () => Promise<void>, owner: object): Promise<void> {
    if (!this.required) return;
    if (authority.auth.credentialKind !== 'api-key' && authority.auth.sessionKind !== 'native') {
      throw new LoggingError('LOGGING_ADMISSION_REQUIRED', 'Machine audit admission requires a machine or native principal.');
    }
    const key = this.key(authority), started = this.clock(), generation = this.generation;
    if (this.closed) throw new LoggingError('LOGGING_CLOSED', 'Logging admission is closed.');
    // Reusing a request owner cannot preserve an older grant after a failed probe.
    this.machineGrants.delete(owner);
    await revalidate();
    if (this.probe) await this.probe(crypto.randomUUID());
    else await this.deliver(captureLoggingEvent(context, { id: crypto.randomUUID(), family: 'security', action: 'logging.machine.admitted',
      occurredAt: Date.now(), outcome: 'attempted', evidence: 'server-confirmed' }));
    await revalidate();
    if (this.closed || !this.available() || this.generation !== generation || key !== this.key(authority) || this.clock() - started >= this.ttlMs) throw new LoggingError('LOGGING_ADMISSION_REQUIRED', 'Machine audit admission expired.');
    this.machineGrants.set(owner, { key, until: this.clock() + this.ttlMs });
  }

  close(): void { this.closed = true; this.invalidate(); }
  /** A required sink/custody failure retires grants; only a new durably acknowledged upload can recover. */
  invalidate(): void { this.generation++; this.grants.clear(); this.machineGrants = new WeakMap(); }
  diagnostics() { this.sweep(); return Object.freeze({ required: this.required, active: this.grants.size, pending: this.pending.size, ttlMs: this.ttlMs }); }
  private key(value: LoggingAdmissionAuthority): string { return loggingDigest([this.policyVersion, authContextAuthorityFingerprint(value.auth, value.properties)]); }
  private sweep(): void {
    // Retain expired grants briefly to distinguish reconnection from first admission,
    // but never retain an unbounded list of former sessions.
    const old = this.clock() - this.ttlMs;
    for (const [key, value] of this.grants) if (value.until <= old) this.grants.delete(key);
  }
}
