/** SDK-owned presence lifecycle: one activity tracker, one freshness timer, scoped readonly feed. */
import type { Row } from '../../sync/types';
import type { AuthPresenceCapabilities, AuthPresenceObservation, UpdateAuthPresenceIntentInput } from '../../auth/auth-presence-types';
import { GuardianPresenceActivity, type PresenceActivityEnvironment } from './guardian-presence-activity';
import { isAuthPresenceCapabilities, isGuardianPresenceOwnSnapshot, type GuardianPresenceOwnSnapshot } from './guardian-presence-parser';
import { readGuardianPresenceRows } from './guardian-presence-model';
import { createAuthClientError } from './auth-errors';
import { AuthSessionRecoveryRequest } from './auth-session-recovery-request';

export interface GuardianPresenceBoundary {
  key: string;
  ready: boolean;
  connected: boolean;
  scopeKind: 'application' | 'tenant';
  scopeId: string;
}
export interface GuardianPresenceClientOptions {
  enabled: boolean;
  readBoundary(): GuardianPresenceBoundary;
  subscribeBoundary(callback: () => void): () => void;
  subscribeReportErrors?(callback: () => void): () => void;
  authenticatedFetch(path: string, init?: RequestInit): Promise<Response>;
  readRows(): { rows: Record<string, Row>; owner: Row | undefined };
  sendTransient(value: { sequence: number; activity: boolean; visible: boolean }): boolean;
  reportFailure(cause: unknown): void;
  activityEnvironment?: PresenceActivityEnvironment | null;
  monotonicNow?: () => number;
  /** Internal deadline override for deterministic transport qualification. */
  requestTimeoutMs?: number;
}
export interface GuardianPresenceClientSnapshot {
  status: 'disabled' | 'loading' | 'pending' | 'ready' | 'error';
  capabilities: AuthPresenceCapabilities | null;
  observations: Readonly<Record<string, AuthPresenceObservation>>;
  self: GuardianPresenceOwnSnapshot | null;
  saving: boolean;
  error: string | null;
}
export const EMPTY_GUARDIAN_PRESENCE: GuardianPresenceClientSnapshot = Object.freeze({ status: 'disabled', capabilities: null,
  observations: Object.freeze({}), self: null, saving: false, error: null });
const EMPTY = EMPTY_GUARDIAN_PRESENCE;

export class GuardianPresenceClient {
  private state = EMPTY;
  private key: string | null = null;
  private epoch = 0;
  private active = false;
  private wasConnected = false;
  private loading: object | null = null;
  private mutation: object | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeErrors: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly requests = new Set<AbortController>();
  private readonly listeners = new Set<() => void>();
  private readonly activity: GuardianPresenceActivity;
  private selfRequestSequence = 0;
  private serverClock: { server: number; received: number } | null = null;
  private readonly monotonicNow: () => number;
  constructor(private readonly options: GuardianPresenceClientOptions) {
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.activity = new GuardianPresenceActivity(options.sendTransient, options.activityEnvironment);
  }
  readonly subscribe = (callback: () => void): (() => void) => {
    this.listeners.add(callback); return () => { this.listeners.delete(callback); };
  };
  readonly getSnapshot = (): GuardianPresenceClientSnapshot => {
    const boundary = this.options.readBoundary();
    return this.active && boundary.ready && boundary.key === this.key ? this.state : EMPTY;
  };
  /** Called exactly once by the owning SDK; components never start independent trackers. */
  activate(): void {
    if (this.active || !this.options.enabled) return;
    this.active = true; this.unsubscribe = this.options.subscribeBoundary(() => this.reconcile());
    this.unsubscribeErrors = this.options.subscribeReportErrors?.(() => this.rejectReport()) ?? null;
    this.reconcile();
  }
  dispose(): void {
    this.active = false; this.unsubscribe?.(); this.unsubscribe = null;
    this.unsubscribeErrors?.(); this.unsubscribeErrors = null; this.retire(); this.listeners.clear();
  }
  async refresh(): Promise<void> { await this.loadConfig(); }
  async getSelf(signal?: AbortSignal): Promise<GuardianPresenceOwnSnapshot> {
    return this.selfRequest(undefined, signal);
  }
  async updateIntent(input: UpdateAuthPresenceIntentInput, signal?: AbortSignal): Promise<GuardianPresenceOwnSnapshot> {
    return this.selfRequest(input, signal);
  }
  private reconcile(): void {
    const boundary = this.options.readBoundary();
    if (!this.active || !boundary.ready) { this.retire(); return; }
    if (boundary.key !== this.key) { this.retire(); this.key = boundary.key; this.publish({ ...EMPTY, status: 'loading' }); }
    const reconnect = boundary.connected && !this.wasConnected;
    this.wasConnected = boundary.connected;
    if (!boundary.connected) this.activity.stop();
    if ((reconnect || this.state.status === 'loading') && !this.loading) void this.loadConfig();
    this.project();
  }
  private retire(): void {
    ++this.epoch; this.key = null; this.wasConnected = false; this.loading = null; this.mutation = null;
    this.activity.stop(); this.serverClock = null; ++this.selfRequestSequence;
    for (const request of this.requests) request.abort(); this.requests.clear();
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
    this.retryTimer = null; this.expiryTimer = null; this.state = EMPTY;
    this.notify();
  }
  private async loadConfig(): Promise<void> {
    const boundary = this.options.readBoundary();
    if (!this.active || !boundary.ready || this.loading) return;
    if (boundary.key !== this.key) this.key = boundary.key;
    const key = boundary.key, epoch = this.epoch, token = {}, request = new AbortController();
    const startedAt = this.monotonicNow();
    this.loading = token; this.requests.add(request);
    this.publish({ ...this.state, status: 'loading', observations: {}, error: null }); this.activity.stop();
    try {
      const { response, body } = await this.readResponse('/auth/presence/config', request);
      if (!this.current(key, epoch, request)) return;
      if (response.status === 404) { this.publish(EMPTY); return; }
      if (!response.ok) throw createAuthClientError(response, body, 'Presence is unavailable.');
      if (!isAuthPresenceCapabilities(body)) throw new Error('Invalid presence capability response.');
      // Conservative elapsed-time estimate includes admission/network/body delay;
      // a slow response must not extend an owner's advertised lease.
      this.serverClock = { server: body.serverTime, received: startedAt };
      const status = !body.enabled || body.state === 'disabled' ? 'disabled' : body.state;
      this.publish({ ...this.state, status, capabilities: body, observations: {}, self: null, error: null });
      if (status === 'pending') {
        if (this.retryTimer !== null) clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => { this.retryTimer = null; if (this.current(key, epoch)) void this.loadConfig(); }, 1_500);
      }
      this.project();
    } catch (cause) {
      if (!this.current(key, epoch, request)) return;
      this.options.reportFailure(cause);
      this.publish({ ...EMPTY, status: 'error', error: 'Presence could not be loaded. Please retry.' });
    } finally {
      this.requests.delete(request);
      if (this.loading === token) { this.loading = null; if (this.current(key, epoch)) this.project(); }
    }
  }
  private async selfRequest(input?: UpdateAuthPresenceIntentInput, signal?: AbortSignal): Promise<GuardianPresenceOwnSnapshot> {
    const boundary = this.options.readBoundary();
    if (!this.active || !boundary.ready || boundary.key !== this.key) throw new DOMException('Presence scope changed.', 'AbortError');
    if (input && !this.state.capabilities?.canSetIntent) throw new Error('Availability changes are not permitted for this session.');
    if (input && this.mutation) throw new Error('An availability change is already pending.');
    const request = new AbortController(), key = boundary.key, epoch = this.epoch, token = {};
    const sequence = ++this.selfRequestSequence;
    const abort = () => request.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    this.requests.add(request);
    if (input) { this.mutation = token; this.publish({ ...this.state, saving: true, error: null }); }
    try {
      if (!this.current(key, epoch, request)) throw new DOMException('Presence scope changed.', 'AbortError');
      const { response, body } = await this.readResponse('/auth/presence/me', request, {
        ...(input ? { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}) });
      if (!this.current(key, epoch, request)) throw new DOMException('Presence scope changed.', 'AbortError');
      if (!response.ok) throw createAuthClientError(response, body, 'Availability could not be loaded or saved.');
      if (!isGuardianPresenceOwnSnapshot(body)) throw new Error('Invalid availability response.');
      if (sequence === this.selfRequestSequence) this.publish({ ...this.state, self: body, error: null });
      return body;
    } catch (cause) {
      if (sequence === this.selfRequestSequence && this.current(key, epoch, request)) {
        this.options.reportFailure(cause);
        this.publish({ ...this.state, saving: false, error: 'Availability could not be loaded or saved. Please retry.' });
      }
      throw cause;
    } finally {
      signal?.removeEventListener('abort', abort); this.requests.delete(request);
      if (this.mutation === token) {
        this.mutation = null;
        if (this.current(key, epoch)) this.publish({ ...this.state, saving: false });
      }
    }
  }
  private async readResponse(path: string, request: AbortController, init?: RequestInit): Promise<{ response: Response; body: unknown }> {
    // Reuse the existing bounded auth transport primitive, including admission
    // and JSON-body reads; cancelling a scope cannot wait on an uncooperative adapter.
    const bounded = new AuthSessionRecoveryRequest(this.options.requestTimeoutMs);
    const cancel = () => bounded.cancel();
    if (request.signal.aborted) cancel(); else request.signal.addEventListener('abort', cancel, { once: true });
    try {
      return await bounded.run(async signal => {
        const response = await this.options.authenticatedFetch(path, { ...init, signal });
        const body: unknown = await response.json().catch(() => null);
        return { response, body };
      });
    } finally { request.signal.removeEventListener('abort', cancel); }
  }
  private project(): void {
    const boundary = this.options.readBoundary(), capabilities = this.state.capabilities;
    if (!this.active || !boundary.ready || boundary.key !== this.key) return;
    if (capabilities?.enabled && capabilities.state === 'ready' && this.state.status === 'ready'
      && capabilities.canReportActivity && boundary.connected && !this.loading) {
      this.activity.start(capabilities.heartbeatIntervalMs);
    } else this.activity.stop();
    const { rows, owner } = this.options.readRows();
    const estimatedServerNow = this.serverClock ? this.serverClock.server + Math.max(0, this.monotonicNow() - this.serverClock.received) : Infinity;
    const observations = readGuardianPresenceRows(rows, owner, boundary, capabilities,
      boundary.connected && this.state.status === 'ready', estimatedServerNow);
    if (JSON.stringify(observations) !== JSON.stringify(this.state.observations)) this.publish({ ...this.state, observations });
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer); this.expiryTimer = null;
    if (capabilities?.state === 'ready' && owner && typeof owner.fresh_until === 'number' && owner.fresh_until > estimatedServerNow) {
      const delay = Math.min(capabilities.ownerLeaseDurationMs, owner.fresh_until - estimatedServerNow);
      this.expiryTimer = setTimeout(() => { this.expiryTimer = null; this.project(); }, Math.max(1, delay));
    }
  }
  private rejectReport(): void {
    const boundary = this.options.readBoundary();
    if (!this.active || !boundary.ready || boundary.key !== this.key) return;
    const key = boundary.key, epoch = this.epoch;
    this.activity.stop(); this.publish({ ...this.state, status: 'pending' }); this.project();
    if (this.retryTimer === null) this.retryTimer = setTimeout(() => {
      this.retryTimer = null; if (this.current(key, epoch)) void this.loadConfig();
    }, 1_500);
  }
  private current(key: string, epoch: number, request?: AbortController): boolean {
    const boundary = this.options.readBoundary();
    return this.active && boundary.ready && boundary.key === key && epoch === this.epoch && !request?.signal.aborted;
  }
  private publish(state: GuardianPresenceClientSnapshot): void { this.state = Object.freeze(state); this.notify(); }
  private notify(): void {
    for (const callback of this.listeners) { try { callback(); } catch (cause) { this.options.reportFailure(cause); } }
  }
}
