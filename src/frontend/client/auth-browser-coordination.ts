/**
 * Browser-wide coordination for Zero's rotating web-session credential.
 *
 * The refresh token remains a private localStorage value. Cross-tab messages
 * contain only a monotonic revision, an opaque authorization-scope id, and the
 * kind of transition. Every key and channel is scoped to the normalized Zero
 * base URL so two Zero apps on one origin cannot consume each other's session.
 */

const LEGACY_REFRESH_TOKEN_KEY = '__platform_refresh_token';
const LEGACY_ADOPTION_KEY = '__zero_auth_legacy_adoption_v1';
const RECORD_VERSION = 1;
const SIGNAL_VERSION = 1;
const DEFAULT_LOCK_TIMEOUT_MS = 4_000;
const DEFAULT_LEASE_MS = 15_000;
const FALLBACK_POLL_MS = 16;

export type BrowserAuthSignalKind = 'session' | 'refresh' | 'scope' | 'logout';

export interface BrowserAuthCredentialRecord {
  version: 1;
  revision: number;
  refreshToken: string | null;
  scopeId: string | null;
  updatedAt: number;
}

export interface BrowserAuthSignal {
  version: 1;
  namespace: string;
  sourceId: string;
  revision: number;
  scopeId: string | null;
  kind: BrowserAuthSignalKind;
}

interface BrowserAuthChannel {
  postMessage(value: unknown): void;
  close(): void;
  addEventListener?: (
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
  removeEventListener?: (
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
  onmessage?: ((event: MessageEvent<unknown>) => void) | null;
}

interface BrowserLockManager {
  request<T>(
    name: string,
    options: { mode: 'exclusive' },
    callback: () => Promise<T>,
  ): Promise<T>;
}

export interface BrowserAuthCoordinationEnvironment {
  storage?: Storage | null;
  locks?: BrowserLockManager | null;
  createChannel?: ((name: string) => BrowserAuthChannel | null) | null;
  addStorageListener?: (
    listener: (key: string | null, newValue: string | null) => void,
  ) => (() => void);
  now?: () => number;
  randomId?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
  lockTimeoutMs?: number;
  leaseMs?: number;
}

export interface BrowserAuthStorageKeys {
  namespace: string;
  credential: string;
  signal: string;
  lockName: string;
  lockPrefix: string;
  channel: string;
}

export class BrowserAuthCoordinationError extends Error {
  readonly code = 'AUTH_COORDINATION_TIMEOUT';
  readonly recoverable = true;

  constructor(message = 'Timed out coordinating the browser authentication session') {
    super(message);
    this.name = 'BrowserAuthCoordinationError';
  }
}

/** Normalize equivalent server URLs before deriving storage and lock names. */
export function normalizeAuthBaseUrl(baseUrl: string): string {
  try {
    const fallback = typeof location !== 'undefined' ? location.href : undefined;
    const parsed = fallback ? new URL(baseUrl, fallback) : new URL(baseUrl);
    parsed.hash = '';
    parsed.search = '';
    parsed.username = '';
    parsed.password = '';
    parsed.pathname = parsed.pathname === '/'
      ? ''
      : parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return baseUrl.trim().replace(/\/+$/, '');
  }
}

/** Deterministic, app-local browser coordination names. */
export function getBrowserAuthStorageKeys(baseUrl: string): BrowserAuthStorageKeys {
  const normalized = normalizeAuthBaseUrl(baseUrl);
  const namespace = encodeURIComponent(normalized);
  return {
    namespace,
    credential: `__zero_auth_credential_v1:${namespace}`,
    signal: `__zero_auth_signal_v1:${namespace}`,
    lockName: `zero-auth-session:${namespace}`,
    lockPrefix: `__zero_auth_lock_v1:${namespace}:`,
    channel: `zero-auth-session:${namespace}`,
  };
}

interface FallbackLockRecord {
  owner: string;
  phase: 'choosing' | 'waiting';
  ticket: number;
  expiresAt: number;
}

type SignalListener = (signal: BrowserAuthSignal) => void;

const inProcessQueues = new Map<string, Promise<void>>();

export class BrowserAuthCoordinator {
  readonly keys: BrowserAuthStorageKeys;
  readonly sourceId: string;

  private readonly storage: Storage | null;
  private readonly locks: BrowserLockManager | null;
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly lockTimeoutMs: number;
  private readonly leaseMs: number;
  private readonly listeners = new Set<SignalListener>();
  private readonly observedSignals = new Map<string, number>();
  private readonly channel: BrowserAuthChannel | null;
  private readonly removeStorageListener: (() => void) | null;
  private readonly channelListener: (event: MessageEvent<unknown>) => void;
  private memoryRecord: BrowserAuthCredentialRecord | null = null;
  private disposed = false;

  constructor(baseUrl: string, environment: BrowserAuthCoordinationEnvironment = {}) {
    this.keys = getBrowserAuthStorageKeys(baseUrl);
    this.storage = environment.storage === undefined
      ? safeLocalStorage()
      : environment.storage;
    this.locks = environment.locks === undefined
      ? safeLockManager()
      : environment.locks;
    this.now = environment.now ?? Date.now;
    this.randomId = environment.randomId ?? randomId;
    this.sleep = environment.sleep ?? delay;
    this.lockTimeoutMs = positiveDuration(
      environment.lockTimeoutMs,
      DEFAULT_LOCK_TIMEOUT_MS,
    );
    this.leaseMs = positiveDuration(environment.leaseMs, DEFAULT_LEASE_MS);
    this.sourceId = this.randomId();

    this.adoptLegacyCredentialOnce();

    const createChannel = environment.createChannel === undefined
      ? defaultChannelFactory
      : environment.createChannel;
    this.channel = createChannel?.(this.keys.channel) ?? null;
    this.channelListener = (event) => this.receiveSignal(event.data);
    if (this.channel?.addEventListener) {
      this.channel.addEventListener('message', this.channelListener);
    } else if (this.channel) {
      this.channel.onmessage = this.channelListener;
    }

    const addStorageListener = environment.addStorageListener
      ?? defaultStorageListener;
    this.removeStorageListener = addStorageListener((key, value) => {
      if (key !== this.keys.signal || !value) return;
      this.receiveSignal(parseJson(value));
    });
  }

  subscribe(listener: SignalListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  readCredential(): BrowserAuthCredentialRecord | null {
    const raw = safeStorageGet(this.storage, this.keys.credential);
    const persisted = parseCredentialRecord(raw);
    if (persisted && (!this.memoryRecord || persisted.revision >= this.memoryRecord.revision)) {
      this.memoryRecord = persisted;
    }
    return this.memoryRecord;
  }

  /** Create a public-safe opaque id for one authorization scope. */
  createScopeId(): string {
    return this.randomId();
  }

  /**
   * Commit a rotated credential. Callers perform this while runExclusive owns
   * the cross-tab session lock.
   */
  commitSession(
    refreshToken: string,
    scopeId: string,
    kind: Exclude<BrowserAuthSignalKind, 'logout'>,
  ): BrowserAuthCredentialRecord {
    const record = this.nextRecord(refreshToken, scopeId);
    this.memoryRecord = record;
    safeStorageSet(this.storage, this.keys.credential, JSON.stringify(record));
    this.publish({
      version: SIGNAL_VERSION,
      namespace: this.keys.namespace,
      sourceId: this.sourceId,
      revision: record.revision,
      scopeId,
      kind,
    });
    return record;
  }

  /** Persist a revisioned tombstone so stale responses cannot resurrect it. */
  commitLogout(): BrowserAuthCredentialRecord {
    const record = this.nextRecord(null, null);
    this.memoryRecord = record;
    safeStorageSet(this.storage, this.keys.credential, JSON.stringify(record));
    this.publish({
      version: SIGNAL_VERSION,
      namespace: this.keys.namespace,
      sourceId: this.sourceId,
      revision: record.revision,
      scopeId: null,
      kind: 'logout',
    });
    return record;
  }

  /**
   * Serialize rotating refresh-family operations across all tabs. Web Locks is
   * preferred. The fallback is a bounded, expiring localStorage bakery lock;
   * an in-process queue also covers workers/tests and browsers without storage.
   */
  runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    return runInProcessExclusive(this.keys.lockName, async () => {
      if (this.disposed) {
        throw new BrowserAuthCoordinationError('Browser auth coordinator is disposed');
      }
      if (this.locks) {
        return this.locks.request(
          this.keys.lockName,
          { mode: 'exclusive' },
          operation,
        );
      }
      if (!this.storage) return operation();
      return this.runWithFallbackLock(operation);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.removeStorageListener?.();
    if (this.channel?.removeEventListener) {
      this.channel.removeEventListener('message', this.channelListener);
    } else if (this.channel) {
      this.channel.onmessage = null;
    }
    this.channel?.close();
  }

  private nextRecord(
    refreshToken: string | null,
    scopeId: string | null,
  ): BrowserAuthCredentialRecord {
    const current = this.readCredential();
    return {
      version: RECORD_VERSION,
      revision: (current?.revision ?? 0) + 1,
      refreshToken,
      scopeId,
      updatedAt: this.now(),
    };
  }

  private publish(signal: BrowserAuthSignal): void {
    // This is deliberately a second, sanitized key. The refresh token never
    // appears in BroadcastChannel payloads or coordination signals.
    safeStorageSet(this.storage, this.keys.signal, JSON.stringify(signal));
    try {
      this.channel?.postMessage(signal);
    } catch {
      // The storage signal remains the fallback notification path.
    }
  }

  private receiveSignal(value: unknown): void {
    const signal = parseSignal(value);
    if (!signal
      || signal.namespace !== this.keys.namespace
      || signal.sourceId === this.sourceId) return;
    const observedRevision = this.observedSignals.get(signal.sourceId) ?? 0;
    if (signal.revision <= observedRevision) return;
    this.observedSignals.set(signal.sourceId, signal.revision);
    for (const listener of this.listeners) listener(signal);
  }

  private adoptLegacyCredentialOnce(): void {
    if (!this.storage || this.readCredential()) return;
    const legacy = safeStorageGet(this.storage, LEGACY_REFRESH_TOKEN_KEY);
    if (!legacy) return;

    const existingAdoption = parseLegacyAdoption(
      safeStorageGet(this.storage, LEGACY_ADOPTION_KEY),
    );
    if (existingAdoption && existingAdoption.namespace !== this.keys.namespace) return;

    const claim = {
      version: 1,
      namespace: this.keys.namespace,
      owner: this.sourceId,
      claimedAt: this.now(),
    };
    safeStorageSet(this.storage, LEGACY_ADOPTION_KEY, JSON.stringify(claim));
    const confirmed = parseLegacyAdoption(
      safeStorageGet(this.storage, LEGACY_ADOPTION_KEY),
    );
    if (!confirmed
      || confirmed.namespace !== claim.namespace
      || confirmed.owner !== claim.owner) return;

    if (!this.readCredential()) {
      const record = {
        version: RECORD_VERSION,
        revision: 1,
        refreshToken: legacy,
        scopeId: this.createScopeId(),
        updatedAt: this.now(),
      } satisfies BrowserAuthCredentialRecord;
      this.memoryRecord = record;
      safeStorageSet(this.storage, this.keys.credential, JSON.stringify(record));
    }
    // Remove only after the namespaced copy is durably observable.
    if (this.readCredential()?.refreshToken === legacy) {
      safeStorageRemove(this.storage, LEGACY_REFRESH_TOKEN_KEY);
    }
  }

  private async runWithFallbackLock<T>(operation: () => Promise<T>): Promise<T> {
    const owner = `${this.sourceId}:${this.randomId()}`;
    const ownKey = `${this.keys.lockPrefix}${owner}`;
    const deadline = this.now() + this.lockTimeoutMs;
    let acquired = false;

    try {
      this.writeFallbackRecord(ownKey, {
        owner,
        phase: 'choosing',
        ticket: 0,
        expiresAt: this.now() + this.leaseMs,
      });
      const ticket = this.maxFallbackTicket() + 1;
      this.writeFallbackRecord(ownKey, {
        owner,
        phase: 'waiting',
        ticket,
        expiresAt: this.now() + this.leaseMs,
      });

      while (this.now() <= deadline) {
        const contenders = this.readFallbackRecords();
        const own = contenders.find((entry) => entry.key === ownKey)?.record;
        if (!own || own.owner !== owner) {
          throw new BrowserAuthCoordinationError('Browser auth lock ownership was lost');
        }
        const blocked = contenders.some(({ key, record }) => {
          if (key === ownKey) return false;
          if (record.phase === 'choosing') return true;
          return record.ticket < ticket
            || (record.ticket === ticket && record.owner < owner);
        });
        if (!blocked) {
          acquired = true;
          break;
        }
        await this.sleep(FALLBACK_POLL_MS);
      }

      if (!acquired) throw new BrowserAuthCoordinationError();

      const heartbeat = setInterval(() => {
        const current = parseFallbackRecord(safeStorageGet(this.storage, ownKey));
        if (!current || current.owner !== owner) return;
        this.writeFallbackRecord(ownKey, {
          ...current,
          expiresAt: this.now() + this.leaseMs,
        });
      }, Math.max(50, Math.floor(this.leaseMs / 3)));
      try {
        return await operation();
      } finally {
        clearInterval(heartbeat);
      }
    } finally {
      const current = parseFallbackRecord(safeStorageGet(this.storage, ownKey));
      if (current?.owner === owner) safeStorageRemove(this.storage, ownKey);
    }
  }

  private maxFallbackTicket(): number {
    let maximum = 0;
    for (const { record } of this.readFallbackRecords()) {
      if (record.phase === 'waiting') maximum = Math.max(maximum, record.ticket);
    }
    return maximum;
  }

  private readFallbackRecords(): Array<{ key: string; record: FallbackLockRecord }> {
    const records: Array<{ key: string; record: FallbackLockRecord }> = [];
    if (!this.storage) return records;
    const now = this.now();
    try {
      for (let index = 0; index < this.storage.length; index += 1) {
        const key = this.storage.key(index);
        if (!key?.startsWith(this.keys.lockPrefix)) continue;
        const record = parseFallbackRecord(this.storage.getItem(key));
        if (!record || record.expiresAt <= now) {
          safeStorageRemove(this.storage, key);
          continue;
        }
        records.push({ key, record });
      }
    } catch {
      return [];
    }
    return records;
  }

  private writeFallbackRecord(key: string, record: FallbackLockRecord): void {
    safeStorageSet(this.storage, key, JSON.stringify(record));
  }
}

async function runInProcessExclusive<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = inProcessQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  inProcessQueues.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (inProcessQueues.get(key) === tail) inProcessQueues.delete(key);
  }
}

function parseCredentialRecord(raw: string | null): BrowserAuthCredentialRecord | null {
  const value = parseJson(raw);
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<BrowserAuthCredentialRecord>;
  if (record.version !== RECORD_VERSION
    || !Number.isSafeInteger(record.revision)
    || Number(record.revision) < 1
    || (record.refreshToken !== null && typeof record.refreshToken !== 'string')
    || (record.scopeId !== null && typeof record.scopeId !== 'string')
    || typeof record.updatedAt !== 'number') return null;
  if ((record.refreshToken === null) !== (record.scopeId === null)) return null;
  return record as BrowserAuthCredentialRecord;
}

function parseSignal(value: unknown): BrowserAuthSignal | null {
  if (!value || typeof value !== 'object') return null;
  const signal = value as Partial<BrowserAuthSignal>;
  if (signal.version !== SIGNAL_VERSION
    || typeof signal.namespace !== 'string'
    || typeof signal.sourceId !== 'string'
    || !Number.isSafeInteger(signal.revision)
    || Number(signal.revision) < 1
    || (signal.scopeId !== null && typeof signal.scopeId !== 'string')
    || !['session', 'refresh', 'scope', 'logout'].includes(String(signal.kind))) {
    return null;
  }
  if ((signal.kind === 'logout') !== (signal.scopeId === null)) return null;
  return signal as BrowserAuthSignal;
}

function parseFallbackRecord(raw: string | null): FallbackLockRecord | null {
  const value = parseJson(raw);
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<FallbackLockRecord>;
  if (typeof record.owner !== 'string'
    || !['choosing', 'waiting'].includes(String(record.phase))
    || !Number.isSafeInteger(record.ticket)
    || Number(record.ticket) < 0
    || typeof record.expiresAt !== 'number') return null;
  return record as FallbackLockRecord;
}

function parseLegacyAdoption(raw: string | null): {
  namespace: string;
  owner: string;
} | null {
  const value = parseJson(raw);
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1
    && typeof candidate.namespace === 'string'
    && typeof candidate.owner === 'string'
    ? { namespace: candidate.namespace, owner: candidate.owner }
    : null;
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function safeLockManager(): BrowserLockManager | null {
  try {
    if (typeof navigator === 'undefined' || !navigator.locks) return null;
    return navigator.locks as unknown as BrowserLockManager;
  } catch {
    return null;
  }
}

function defaultChannelFactory(name: string): BrowserAuthChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(name);
  } catch {
    return null;
  }
}

function defaultStorageListener(
  listener: (key: string | null, newValue: string | null) => void,
): () => void {
  if (typeof window === 'undefined' || !window.addEventListener) return () => {};
  const handler = (event: StorageEvent) => listener(event.key, event.newValue);
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

function safeStorageGet(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeStorageSet(storage: Storage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // In-memory state remains functional when browser persistence is blocked.
  }
}

function safeStorageRemove(storage: Storage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Best effort cleanup only.
  }
}

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}
