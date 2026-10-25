/** Bounded signed checkpoint custody; no SQLite transaction or Guardian lease spans custodian I/O. */
import type { LoggingCustodyConfig, SignedLoggingCheckpoint } from './logging-custody-contracts';
import type { LoggingCheckpoint, LoggingVerification } from './logging-evidence-contracts';
import type { LoggingStream } from './logging-contracts';
import { LoggingError } from './logging-error';
import { loggingId, loggingRecord } from './logging-validation';
import { checkpointDigest, checkpointPayload, snapshotCheckpointKeys, verifySignedCheckpoint } from './logging-checkpoint-signer';

export function resolveLoggingCustody(value: unknown): LoggingCustodyConfig {
  try {
    const r = loggingRecord(value, ['ledgerId', 'store', 'signer', 'adoptExisting', 'maxAdoptionProofs', 'maxVerificationProofs']);
    const ledgerId = loggingId(r.ledgerId)!;
    const store = loggingRecord(r.store, ['identity', 'read', 'append']), signer = loggingRecord(r.signer, ['keyId', 'publicKeys', 'sign']);
    const identity = loggingId(store.identity)!, keyId = loggingId(signer.keyId)!, publicKeys = snapshotCheckpointKeys(signer.publicKeys);
    if (typeof store.read !== 'function' || typeof store.append !== 'function' || typeof signer.sign !== 'function' || !Object.hasOwn(publicKeys, keyId)
      || r.adoptExisting !== undefined && typeof r.adoptExisting !== 'boolean') throw new Error();
    const maxAdoptionProofs = r.maxAdoptionProofs ?? 100000, maxVerificationProofs = r.maxVerificationProofs ?? 1000000;
    if (!Number.isSafeInteger(maxAdoptionProofs) || Number(maxAdoptionProofs) < 100 || Number(maxAdoptionProofs) > 10000000
      || !Number.isSafeInteger(maxVerificationProofs) || Number(maxVerificationProofs) < 100 || Number(maxVerificationProofs) > 10000000) throw new Error();
    return Object.freeze({ ledgerId, adoptExisting: r.adoptExisting === true, maxAdoptionProofs: Number(maxAdoptionProofs), maxVerificationProofs: Number(maxVerificationProofs),
      store: Object.freeze({ identity, read: store.read.bind(r.store), append: store.append.bind(r.store) }),
      signer: Object.freeze({ keyId, publicKeys, sign: signer.sign.bind(r.signer) }) });
  } catch { throw new LoggingError('LOGGING_CONFIG_INVALID', 'Independent checkpoint custody configuration is invalid.'); }
}

type Verify = (after: number, checkpoint?: LoggingCheckpoint) => Promise<LoggingVerification>;
export class LoggingCheckpointCustody {
  private readonly pending = new Map<LoggingStream, Promise<void>>();
  private closed = false;
  private failed = false;
  private waiting = 0;
  constructor(private readonly config: LoggingCustodyConfig, private readonly invalidate: () => void,
    private readonly boundary: 'local-server' | 'configured-store' = 'configured-store') {}

  async initialize(stream: LoggingStream, verify: Verify): Promise<void> {
    let scanned = await verify(0);
    const head = scanned.checkpoint;
    const latest = await this.latest(stream);
    if (!latest && head.ordinal > 0) {
      if (!this.config.adoptExisting) throw new LoggingError('LOGGING_NOT_READY', 'Existing unsigned logging evidence requires explicit verified adoption.');
      if (head.ordinal > this.config.maxAdoptionProofs!) throw new LoggingError('LOGGING_BACKPRESSURE', 'Logging adoption exceeds its configured proof budget.');
    }
    if (head.ordinal > (this.config.maxVerificationProofs ?? 1000000)) throw new LoggingError('LOGGING_BACKPRESSURE', 'Logging startup verification exceeds its configured proof budget.');
    // Verify old content as well as the unsealed tail. Checking only the newest
    // checkpoint would miss corruption on an earlier page during startup.
    while (scanned.hasMore) {
      const after = scanned.throughOrdinal;
      scanned = await verify(after);
      if (scanned.throughOrdinal <= after || scanned.checkpoint.ordinal !== head.ordinal || scanned.checkpoint.hash !== head.hash) {
        throw new LoggingError('LOGGING_INTEGRITY_FAILED', 'Logging history changed during startup verification.');
      }
    }
    await this.reconcile(stream, verify, latest);
  }

  /** Every acknowledged strict sink batch has a retained signed checkpoint outside the event database. */
  seal(stream: LoggingStream, verify: Verify): Promise<void> {
    if (this.closed) return Promise.reject(new LoggingError('LOGGING_CLOSED', 'Checkpoint custody is closed.'));
    if (this.waiting >= 64) return Promise.reject(new LoggingError('LOGGING_BACKPRESSURE', 'Checkpoint acknowledgment capacity is exhausted.'));
    this.waiting++;
    const prior = this.pending.get(stream) ?? Promise.resolve();
    const task = prior.catch(() => {}).then(async () => {
      if (this.closed) throw new LoggingError('LOGGING_CLOSED', 'Checkpoint custody is closed.');
      try { await this.reconcile(stream, verify, await this.latest(stream)); this.failed = false; }
      catch (error) { this.failed = true; this.invalidate(); throw error; }
    }).finally(() => { this.waiting--; if (this.pending.get(stream) === task) this.pending.delete(stream); });
    this.pending.set(stream, task); return task;
  }

  diagnostics() { return Object.freeze({ state: this.closed ? 'closed' : this.failed ? 'unavailable' : 'ready', pending: this.waiting, ledgerId: this.config.ledgerId, keyId: this.config.signer.keyId,
    custody: this.boundary }); }
  async close(): Promise<void> { this.closed = true; await Promise.allSettled([...this.pending.values()]); }

  private async latest(stream: LoggingStream): Promise<SignedLoggingCheckpoint | null> {
    const value = await this.bounded(signal => this.config.store.read(this.config.ledgerId, stream, signal));
    return value === null ? null : verifySignedCheckpoint(value, this.config.ledgerId, stream, this.config.signer.publicKeys);
  }

  private async reconcile(stream: LoggingStream, verify: Verify, latest: SignedLoggingCheckpoint | null): Promise<void> {
    let after = latest?.ordinal ?? 0;
    const checkpoint: LoggingCheckpoint | undefined = latest ? { version: 1, stream: latest.stream, ordinal: latest.ordinal, hash: latest.hash } : undefined;
    let result = await verify(after, checkpoint);
    const head = result.checkpoint;
    // The sink may contain an unacknowledged tail after a crash. Verify each
    // bounded page before publishing it; do not silently accept an older restore.
    for (let pages = 0; result.hasMore; pages++) {
      if (pages >= 1000 || result.throughOrdinal <= after) throw new LoggingError('LOGGING_BACKPRESSURE', 'Unsealed logging tail exceeds its recovery budget.');
      after = result.throughOrdinal; result = await verify(after, checkpoint);
    }
    if (latest && latest.ordinal === head.ordinal && latest.hash === head.hash && latest.keyId === this.config.signer.keyId) return;
    const payload = { ...head, ledgerId: this.config.ledgerId, issuedAt: Date.now(), keyId: this.config.signer.keyId, previousDigest: latest ? checkpointDigest(latest) : null };
    const signature = await this.bounded(signal => this.config.signer.sign(checkpointPayload(payload), signal));
    const signed = verifySignedCheckpoint({ ...payload, signature }, this.config.ledgerId, stream, this.config.signer.publicKeys);
    const retained = verifySignedCheckpoint(await this.bounded(signal => this.config.store.append(signed, latest ? checkpointDigest(latest) : null, signal)), this.config.ledgerId, stream, this.config.signer.publicKeys);
    if (checkpointDigest(retained) !== checkpointDigest(signed)) throw new LoggingError('LOGGING_INTEGRITY_FAILED', 'Independent checkpoint receipt does not match.');
  }

  private async bounded<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([Promise.resolve().then(() => work(controller.signal)), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new LoggingError('LOGGING_AUDIT_UNAVAILABLE', 'Independent checkpoint custody timed out.', 'unknown')); }, 5000);
      })]);
    } catch (error) {
      if (error instanceof LoggingError) throw error;
      throw new LoggingError('LOGGING_AUDIT_UNAVAILABLE', 'Checkpoint custody is unavailable.', 'unknown');
    } finally { clearTimeout(timer); controller.abort(); }
  }
}
