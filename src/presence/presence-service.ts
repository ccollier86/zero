/** Single-owner Guardian presence lifecycle, lease aggregation and ordered managed projection delivery. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { EphemeralStateManager } from '../sync/ephemeral-manager';
import type { ServiceDataScope } from '../auth/service-data-scope';
import { serviceDataScopeKey } from '../auth/service-data-scope';
import type { AuthPresenceCapabilities, AuthPresenceIntent, AuthPresenceObservation, ResolvedAuthPresenceConfig, UpdateAuthPresenceIntentInput } from '../auth/auth-presence-types';
import { createZeroRuntimeServiceKey } from '../runtime/zero-app-runtime';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { AuthPlatformCodeEmitter } from '../auth/auth-observability';
import { presenceError } from './presence-error';
import { PresenceDirectory } from './presence-directory';
import { PresenceSystemStore, type PresenceOwnerClaim } from './presence-system-store';
import { PresenceCanonicalStore } from './presence-canonical-store';
import { PresenceLeaseStore, type PresenceActivityReport, type PresenceLeasePrincipal } from './presence-lease-store';
import { effectivePresenceStatus, presenceStatusCatalog } from './presence-status';
import { presenceRowId, type PresencePublication, type PresenceProjectionReceipt, type PresenceProjectionRow } from './presence-publication';
import { reconcilePresenceSystemSchema } from './presence-schema';

/** Infrastructure target owns existing pinned/Fabric handles; no request can choose its database. */
export interface PresenceProjectionPublisher {
  publish(publication: PresencePublication, assertCurrent: () => void): Promise<PresenceProjectionReceipt>;
  isReady(scope: ServiceDataScope, ownerEpoch: number): boolean;
}
export interface PresenceSelfSnapshot {
  readonly capabilities: AuthPresenceCapabilities;
  readonly intent: ReturnType<PresenceSystemStore['intent']>;
  readonly observation: AuthPresenceObservation | null;
}
export const ZERO_GUARDIAN_PRESENCE = createZeroRuntimeServiceKey<PresenceService>('Guardian presence service');

/** Server-owned activity/status service; own scope is admitted before every read/mutation/report. */
export class PresenceService {
  readonly directory: PresenceDirectory;
  private readonly system: PresenceSystemStore;
  private readonly canonical: PresenceCanonicalStore;
  private readonly scopes = new Map<string, ServiceDataScope>();
  private claim: PresenceOwnerClaim | null = null;
  private leases: PresenceLeaseStore | null = null;
  private manager: EphemeralStateManager | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private removeChanges: (() => void) | null = null;
  private drainTask: Promise<void> | null = null;
  private stopped = false;
  private started = false;
  private nextCheckpoint = 0;
  private reporting = false;
  private authorityRevision: number | null = null;
  private readonly statusCache = new Map<string, { epoch: number; status: string; connected: boolean }>();
  private readonly intentCache = new Map<string, AuthPresenceIntent>();
  private readonly directoryCache = new Set<string>();

  constructor(private readonly db: ReactiveDB, readonly config: ResolvedAuthPresenceConfig,
    tenancyMode: 'single' | 'multi', private readonly publisher: PresenceProjectionPublisher,
    private readonly installAllowed: boolean, private readonly now: () => number = Date.now,
    private readonly ownerId: string = crypto.randomUUID(), private readonly emitCode: AuthPlatformCodeEmitter = emitPlatformCode) {
    this.system = new PresenceSystemStore(db, now); this.canonical = new PresenceCanonicalStore(db, this.system, now);
    this.directory = new PresenceDirectory(db, tenancyMode);
  }

  /** Managed createApp awaits this admission; missing migrations/other owner remain explicitly pending. */
  async initialize(): Promise<void> {
    if (this.started || this.stopped) return; this.started = true;
    if (!this.config.enabled) return;
    if (reconcilePresenceSystemSchema(this.db, this.installAllowed)) this.system.register();
    this.removeChanges = this.db.onChange(change => {
      if (['users', '_auth_tenants', '_auth_tenant_memberships', '_auth_registration_provisioning', '_auth_admin_user_provisioning'].includes(change.table)) {
        queueMicrotask(() => { if (!this.stopped) this.safeTick(true); });
      }
    });
    this.safeTick(true); await this.drain();
    if (!this.stopped) this.timer = setInterval(() => this.safeTick(), Math.min(1000, this.config.ownerCheckpointIntervalMs));
  }

  /** The existing Sync plugin supplies its sole ephemeral manager when it starts. */
  attachEphemeralManager(manager: EphemeralStateManager): () => void {
    if (this.stopped) return () => {};
    if (this.manager && this.manager !== manager) throw presenceError('AUTH_PRESENCE_OWNER_LOST');
    this.manager = manager; this.attachLeases();
    return () => {
      if (this.manager !== manager) return;
      const affected = this.leases?.principals() ?? [];
      this.leases?.close(); this.leases = null; this.manager = null;
      // Sync may stop independently of the managed app. Its last connection
      // must become offline now, rather than waiting for an owner checkpoint.
      try {
        for (const principal of affected) this.recompute(principal.scope, principal.userId);
        if (affected.length) void this.drain();
      } catch (error) { this.retireLocal(error, 'sync-detach'); }
    };
  }

  /** Readiness includes actual target acknowledgment, never just enabled config or source DDL. */
  capabilities(scope?: ServiceDataScope): AuthPresenceCapabilities {
    const ready = !this.stopped && Boolean(this.claim && this.claim.freshUntil > this.now()) && this.system.ready()
      && (scope ? this.publisher.isReady(scope, this.claim!.ownerEpoch)
        : this.scopes.size > 0 && [...this.scopes.values()].every(value => this.publisher.isReady(value, this.claim!.ownerEpoch)));
    return { enabled: this.config.enabled, state: !this.config.enabled ? 'disabled' : ready ? 'ready' : 'pending',
      topology: 'single-owner', statuses: presenceStatusCatalog(this.config).map(status => ({ ...status, selectable: ready && status.selectable })), heartbeatIntervalMs: this.config.heartbeatIntervalMs,
      idleAfterMs: this.config.idleAfterMs, awayAfterMs: this.config.awayAfterMs,
      serverTime: this.now(), ownerLeaseDurationMs: this.config.ownerLeaseDurationMs, canReportActivity: ready, canSetIntent: ready };
  }

  /** Exact admitted socket identity and server clock are the only heartbeat authority. */
  report(principal: PresenceLeasePrincipal, report: PresenceActivityReport, assertCurrent: () => void): void {
    // The actual Sync auth owner has already revalidated the live session. A
    // cached admitted cohort and unexpired unstealable owner lease keep the
    // unchanged heartbeat path memory-only; SQL guards run on transitions.
    if (!this.config.enabled) throw presenceError('AUTH_PRESENCE_DISABLED');
    if (this.stopped || !this.claim || this.claim.freshUntil <= this.now()
      || !this.publisher.isReady(principal.scope, this.claim.ownerEpoch)) throw presenceError('AUTH_PRESENCE_NOT_READY');
    assertCurrent();
    if (!this.directoryCache.has(presenceRowId(principal.scope.scopeKind, principal.scope.scopeId, principal.userId))) throw presenceError('AUTH_PRESENCE_NOT_READY');
    if (!this.leases) throw presenceError('AUTH_PRESENCE_NOT_READY');
    this.reporting = true;
    let changed = false;
    try { this.leases.report(principal, report); assertCurrent(); changed = this.recompute(principal.scope, principal.userId, true, assertCurrent); }
    catch (error) { this.reporting = false; this.leases.release(principal.connectionId); throw error; }
    finally { this.reporting = false; }
    if (changed) void this.drain();
  }
  release(connectionId: string): void { if (!this.stopped) this.leases?.release(connectionId); }

  /** Read only one current same-scope directory, with owner freshness explicit in every observation. */
  list(scope: ServiceDataScope, viewerId: string, assertCurrent: () => void,
    page: { readonly limit: number; readonly after?: string } = { limit: 500 }): readonly AuthPresenceObservation[] {
    if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 501
      || page.after !== undefined && !/^gp_[0-9a-f]{64}$/.test(page.after)) throw presenceError('AUTH_PRESENCE_INVALID_INPUT');
    this.assertReady(scope); assertCurrent(); this.assertMember(scope, viewerId);
    const observations = this.canonical.page(scope, page.limit, page.after).filter(row => this.directory.contains(scope, row.user_id)).map(row => this.observe(row));
    assertCurrent(); return observations;
  }
  self(scope: ServiceDataScope, userId: string, assertCurrent: () => void): PresenceSelfSnapshot {
    this.assertReady(scope); assertCurrent(); this.assertMember(scope, userId);
    const row = this.canonical.user(scope, userId);
    const snapshot = { capabilities: this.capabilities(scope), intent: this.system.intent(scope, userId), observation: row ? this.observe(row) : null };
    assertCurrent(); return snapshot;
  }
  updateIntent(scope: ServiceDataScope, userId: string, input: UpdateAuthPresenceIntentInput, assertCurrent: () => void): PresenceSelfSnapshot {
    this.assertReady(scope); this.assertMember(scope, userId);
    const intent = this.system.updateIntent(scope, userId, input, this.config, this.claim!, () => { assertCurrent(); this.assertMember(scope, userId); });
    this.intentCache.set(presenceRowId(scope.scopeKind, scope.scopeId, userId), intent);
    this.recompute(scope, userId); void this.drain(); return this.self(scope, userId, assertCurrent);
  }

  /** Deterministic clock seam used by tests; production timer invokes this same lifecycle. */
  tick(directoryChanged = false): void {
    if (this.stopped || !this.config.enabled || !this.system.ready()) return;
    const authorityRevision = this.canonical.authorityRevision();
    const authorityChanged = this.authorityRevision !== null && this.authorityRevision !== authorityRevision;
    this.authorityRevision = authorityRevision;
    if (!this.claim) {
      const claim = this.system.claim(this.ownerId, this.config.ownerLeaseDurationMs); if (!claim) return;
      this.claim = claim; this.nextCheckpoint = this.now() + this.config.ownerCheckpointIntervalMs;
      this.canonical.discardRetiredEpochs(claim); this.attachLeases(); this.refreshDirectory(true);
    } else {
      this.system.assertOwner(this.claim);
      if (this.now() >= this.nextCheckpoint) {
        this.claim = this.system.checkpoint(this.claim, this.config.ownerLeaseDurationMs);
        this.nextCheckpoint = this.now() + this.config.ownerCheckpointIntervalMs;
        for (const scope of this.scopes.values()) if (this.publisher.isReady(scope, this.claim.ownerEpoch)) this.canonical.marker(this.claim, scope, 'checkpoint');
        directoryChanged = true; // Periodic authoritative reconciliation also covers external SYSTEM changes.
      }
      const resetScopes = authorityChanged ? this.canonical.discardObsoleteAuthority(this.claim) : new Set<string>();
      if (directoryChanged || authorityChanged) this.refreshDirectory(resetScopes);
    }
    for (const principal of this.leases?.principals() ?? []) this.recompute(principal.scope, principal.userId);
    void this.drain();
  }

  /** Stop reports first, await in-flight IPC, then publish retirement before managed databases dispose. */
  async close(): Promise<void> {
    if (this.stopped) return; this.stopped = true;
    if (this.timer) clearInterval(this.timer); this.timer = null; this.removeChanges?.(); this.removeChanges = null;
    this.leases?.close(); this.leases = null; this.manager = null;
    await this.drainTask;
    const claim = this.claim;
    if (claim) {
      try {
        for (const scope of this.scopes.values()) this.canonical.marker(claim, scope, 'retire');
        await this.drain(true); this.system.retire(claim);
      } catch (error) { this.emitFailure(error, 'shutdown'); }
    }
    this.claim = null;
  }

  /** Ordered durable delivery; a failed target head prevents its later ready marker from bypassing it. */
  drain(retiring = false): Promise<void> {
    if (this.drainTask) return this.drainTask;
    if (!this.claim || this.stopped && !retiring) return Promise.resolve();
    const claim = this.claim;
    const operation = (async () => {
      for (let batch = 0; batch < 100; batch++) {
        const pending = this.canonical.pending(); if (!pending.length) break;
        for (const event of pending) {
          try {
            const assertCurrent = () => { if (this.stopped && !retiring || this.claim?.ownerEpoch !== claim.ownerEpoch
              || this.claim.ownerId !== claim.ownerId) throw presenceError('AUTH_PRESENCE_OWNER_LOST'); this.system.assertOwner(claim); };
            const assertSnapshotCurrent = () => { assertCurrent();
              if (this.canonical.authorityRevision() !== event.publication.sourceAuthorityRevision) throw presenceError('AUTH_PRESENCE_NOT_READY'); };
            assertSnapshotCurrent(); await this.publisher.publish(event.publication, assertSnapshotCurrent); assertSnapshotCurrent();
            this.canonical.accepted(event.eventId);
          } catch (error) {
            this.canonical.retry(event.eventId);
            this.emitCode(OBS_CODES.AUTH_PRESENCE_PROJECTION_RETRY, { metadata: { stage: 'publication' } });
          }
        }
      }
    })();
    this.drainTask = operation.finally(() => { if (this.drainTask === settled) this.drainTask = null; });
    const settled = this.drainTask; return settled;
  }

  /** Manager-owned before-use barrier reconciles live directory changes and drains actual projection receipts. */
  async ensureScope(scope: ServiceDataScope): Promise<void> {
    if (this.stopped || !this.claim) throw presenceError('AUTH_PRESENCE_NOT_READY');
    // A failed source transaction can have touched local caches before its SQL
    // rollback. Retire those caches exactly as the timer does; never retain a
    // previously-ready receipt after a failed before-use reconciliation.
    this.safeTick(true); await this.drain();
    if (this.canonical.hasPending(scope)) throw presenceError('AUTH_PRESENCE_NOT_READY');
    this.assertReady(scope);
  }

  private refreshDirectory(reset: boolean | ReadonlySet<string>): void {
    this.db.transaction(() => this.refreshDirectoryAtWriterHead(reset));
  }
  private refreshDirectoryAtWriterHead(reset: boolean | ReadonlySet<string>): void {
    const members = this.directory.members(), admitted = new Set<string>(), newScopes = new Map<string, ServiceDataScope>();
    for (const member of members) {
      admitted.add(presenceRowId(member.scope.scopeKind, member.scope.scopeId, member.userId));
      newScopes.set(serviceDataScopeKey(member.scope), member.scope);
    }
    const snapshotScopes = new Set<string>();
    for (const [key, scope] of newScopes) if (reset === true || typeof reset !== 'boolean' && reset.has(key) || !this.scopes.has(key)) {
      snapshotScopes.add(key); this.canonical.marker(this.claim!, scope, 'reset');
    }
    for (const member of members) this.recompute(member.scope, member.userId, !snapshotScopes.has(serviceDataScopeKey(member.scope)));
    for (const row of this.canonical.rows()) if (!admitted.has(row.id)) this.canonical.remove(this.claim!, row);
    this.directoryCache.clear(); for (const id of admitted) this.directoryCache.add(id);
    for (const id of this.statusCache.keys()) if (!admitted.has(id)) { this.statusCache.delete(id); this.intentCache.delete(id); }
    for (const [key, scope] of newScopes) {
      if (snapshotScopes.has(key)) { this.canonical.snapshotRows(this.claim!, scope); this.canonical.marker(this.claim!, scope, 'ready'); }
      this.scopes.set(key, scope);
    }
    // Removed/disabled tenant scopes receive their last tombstone/retirement instead of remaining fresh.
    for (const [key, scope] of this.scopes) if (!newScopes.has(key)) {
      this.canonical.marker(this.claim!, scope, 'retire'); this.scopes.delete(key);
    }
  }
  private recompute(scope: ServiceDataScope, userId: string, publish = true, assertCurrent: () => void = () => {}): boolean {
    if (!this.claim || this.stopped) return false;
    const id = presenceRowId(scope.scopeKind, scope.scopeId, userId);
    const leases = this.leases?.forUser(scope, userId) ?? [];
    let intent = this.intentCache.get(id);
    if (!intent) { intent = this.system.intent(scope, userId); this.intentCache.set(id, intent); }
    const status = effectivePresenceStatus(leases, intent, this.config, this.now()), connected = leases.length > 0;
    const old = this.statusCache.get(id);
    if (old?.epoch === this.claim.ownerEpoch && old.status === status && old.connected === connected) return false;
    if (!this.directory.contains(scope, userId)) return false;
    this.canonical.change(this.claim, scope, userId, status, connected, publish, assertCurrent);
    this.statusCache.set(id, { epoch: this.claim.ownerEpoch, status, connected });
    return true;
  }
  private attachLeases(): void {
    if (this.leases || !this.manager || !this.claim || this.stopped) return;
    this.leases = new PresenceLeaseStore(this.manager, this.config, this.claim.ownerEpoch,
      (scope, userId) => { if (!this.stopped && !this.reporting && this.recompute(scope, userId)) void this.drain(); }, this.now);
  }
  private observe(row: PresenceProjectionRow): AuthPresenceObservation {
    const freshUntil = this.claim?.freshUntil ?? 0;
    const stale = this.stopped || freshUntil <= this.now() || row.owner_epoch !== this.claim?.ownerEpoch;
    return { userId: row.user_id, status: stale ? 'offline' : row.status_key, connected: !stale && row.connected === 1,
      revision: row.revision, ownerEpoch: row.owner_epoch, updatedAt: row.updated_at, freshUntil, stale };
  }
  private assertMember(scope: ServiceDataScope, userId: string): void {
    if (!this.directory.contains(scope, userId)) throw presenceError('AUTH_PRESENCE_NOT_READY');
  }
  private assertReady(scope: ServiceDataScope): void {
    if (!this.config.enabled) throw presenceError('AUTH_PRESENCE_DISABLED');
    if (this.capabilities(scope).state !== 'ready' || !this.claim) throw presenceError('AUTH_PRESENCE_NOT_READY');
    this.system.assertOwner(this.claim);
  }
  private safeTick(directoryChanged = false): void {
    try { this.tick(directoryChanged); } catch (error) { this.retireLocal(error, 'tick'); }
  }
  private retireLocal(error: unknown, stage: string): void {
    this.leases?.close(); this.leases = null; this.claim = null; this.scopes.clear();
    this.statusCache.clear(); this.intentCache.clear(); this.directoryCache.clear(); this.emitFailure(error, stage);
  }
  private emitFailure(error: unknown, stage: string): void {
    this.emitCode(OBS_CODES.AUTH_PRESENCE_RUNTIME_FAILED, { metadata: { stage } });
  }
}
