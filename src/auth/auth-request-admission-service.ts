/** Durable, atomic admission boundary for public authentication work. */

import { createHmac, randomBytes } from 'node:crypto';
import type { Statement } from 'bun:sqlite';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { ReactiveDB } from '../sync/reactive-db';
import { AuthError } from './types';
import type {
  AuthRequestAdmissionFlow,
  AuthRequestSourceContext,
  ResolvedAuthRequestAdmissionConfig,
} from './auth-request-admission-types';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';

interface CountRow { count: number }
interface ConfigRow { value: string }

const HASH_KEY_CONFIG = 'auth.request_admission.hash_key';
const ADMISSION_ROLLBACK = new Error('auth-request-admission-rollback');

export class AuthRequestAdmissionService {
  private readonly insert: Statement;
  private readonly cleanup: Statement;
  private readonly countGlobal: Statement;
  private readonly countSource: Statement;
  private readonly countSubject: Statement;
  private readonly hashKey: Buffer;
  private readonly maximumWindowMs: number;

  constructor(
    private readonly db: ReactiveDB,
    readonly config: ResolvedAuthRequestAdmissionConfig,
    private readonly now: () => number = Date.now,
    private readonly emitCode: AuthPlatformCodeEmitter = emitPlatformCode,
  ) {
    this.hashKey = loadOrCreateHashKey(db);
    this.maximumWindowMs = Math.max(
      ...Object.values(config.flows).map((flow) => flow.windowMs),
    );
    this.insert = db.prepare(`INSERT INTO _auth_request_admissions (
      admission_id, flow, source_hash, subject_hash, created_at
    ) VALUES (?, ?, ?, ?, ?)`);
    this.cleanup = db.prepare(`DELETE FROM _auth_request_admissions
      WHERE admission_id IN (
        SELECT admission_id FROM _auth_request_admissions
        WHERE created_at <= ? ORDER BY created_at ASC LIMIT ?
      )`);
    this.countGlobal = db.prepare(`SELECT COUNT(*) AS count
      FROM _auth_request_admissions WHERE flow = ? AND created_at > ?`);
    this.countSource = db.prepare(`SELECT COUNT(*) AS count
      FROM _auth_request_admissions
      WHERE flow = ? AND source_hash = ? AND created_at > ?`);
    this.countSubject = db.prepare(`SELECT COUNT(*) AS count
      FROM _auth_request_admissions
      WHERE flow = ? AND subject_hash = ? AND created_at > ?`);
  }

  /**
   * Admit and persist one request. The row is inserted before counts are read,
   * forcing SQLite's write serialization; exceeding a limit rolls it back.
   */
  admit(input: {
    flow: AuthRequestAdmissionFlow;
    source?: string | null;
    subject?: string | null;
  }): void {
    if (!this.config.enabled) return;
    const sourceHash = this.hashValue(input.source);
    const subjectHash = this.hashValue(input.subject);
    const now = this.now();
    const limits = this.config.flows[input.flow];
    const since = now - limits.windowMs;
    try {
      this.db.transaction(() => {
        this.cleanup.run(now - this.maximumWindowMs, this.config.cleanupBatchSize);
        this.insert.run(
          `admit_${crypto.randomUUID()}`,
          input.flow,
          sourceHash,
          subjectHash,
          now,
        );
        const exceeded = count(this.countGlobal.get(input.flow, since)) > limits.maxGlobal
          || Boolean(sourceHash
            && count(this.countSource.get(input.flow, sourceHash, since))
              > limits.maxPerSource)
          || Boolean(subjectHash
            && count(this.countSubject.get(input.flow, subjectHash, since))
              > limits.maxPerSubject);
        if (exceeded) throw ADMISSION_ROLLBACK;
      });
    } catch (error) {
      if (error !== ADMISSION_ROLLBACK) throw error;
      this.emitCode(OBS_CODES.AUTH_REQUEST_ADMISSION_REJECTED, {
        metadata: { flow: input.flow },
      });
      throw new AuthError(
        'Too many authentication requests. Try again shortly.',
        'AUTH_RATE_LIMITED',
        429,
      );
    }
  }

  /** Resolve one deployment-owned source key without permitting Promise escape. */
  resolveSource(context: AuthRequestSourceContext): string | null | undefined {
    try {
      return invokeSynchronousAuthCallback(
        () => this.config.sourceKey(context),
        {
          component: 'auth-request-admission-service',
          invariant: 'source-key-resolver-async',
          message: '[auth] Request admission source resolver must be synchronous.',
          emitCode: this.emitCode,
        },
      );
    } catch {
      throw new AuthError(
        'Authentication request admission is temporarily unavailable',
        'AUTH_ADMISSION_UNAVAILABLE',
        503,
      );
    }
  }

  private hashValue(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const normalized = value.trim();
    if (!normalized || normalized.length > 512) return null;
    return createHmac('sha256', this.hashKey).update(normalized).digest('hex');
  }
}

function loadOrCreateHashKey(db: ReactiveDB): Buffer {
  const select = db.prepare('SELECT value FROM _auth_config WHERE key = ?');
  const insert = db.prepare(
    'INSERT OR IGNORE INTO _auth_config (key, value) VALUES (?, ?)',
  );
  const generated = randomBytes(32).toString('base64url');
  insert.run(HASH_KEY_CONFIG, generated);
  const row = select.get(HASH_KEY_CONFIG) as ConfigRow | null;
  if (!row) throw new Error('[auth] Failed to initialize request admission hash key.');
  const key = Buffer.from(row.value, 'base64url');
  if (key.length !== 32) {
    throw new Error('[auth] Request admission hash key is invalid.');
  }
  return key;
}

function count(row: unknown): number {
  return Number((row as CountRow | null)?.count ?? 0);
}
