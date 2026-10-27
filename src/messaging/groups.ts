/** Coalesced Guardian -> private Fabric membership maintenance. No polling loop, transcript or provider I/O. */
import { AuthError } from '../auth/types';
import { serviceDataScopeKey, type ServiceDataScope } from '../auth/service-data-scope';
import type { ReactiveDB } from '../sync/reactive-db';
import type { LoggingRuntime } from '../logging/logging-runtime';
import { runWithLoggingAttribution, withoutLoggingAttribution } from '../logging/logging-attribution';
import type { ResolvedMessagingConfig } from './config';
import type { MessagingDirectory } from './service';
import type { MessagingRuntime } from './runtime';
import { messagingHash } from './validation';
import { readAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { DatabaseError } from '../databases/database-error';

export class ManagedMessagingGroups {
  private stopped = false;
  private readonly complete = new Map<string, number>();
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly applied = new Map<string, string>();
  private remove: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastBackgroundRevision: number | null = null;
  private backgroundRunning = false;
  private backgroundDirty = false;
  constructor(private readonly deps: { system: ReactiveDB; runtime: MessagingRuntime; directory: MessagingDirectory; config: ResolvedMessagingConfig; logging?: LoggingRuntime; failed(): void }) {
    if (!Object.keys(deps.config.groups).length) return;
    if (!deps.directory.groupCandidates || !deps.directory.groupRecipient) throw new Error('[messaging] Configured groups require Guardian directory policy.');
    // Guardian's composite-key/property/role writes deliberately bypass raw
    // row broadcasts. Its durable revision clock, not onChange payloads, is
    // the cache/admission authority. Any committed tracked hint may wake it.
    this.remove = deps.system.onCommit(() => this.arm());
    this.arm();
  }
  async ensure(scope: ServiceDataScope): Promise<void> {
    if (!Object.keys(this.deps.config.groups).length) return;
    const key = serviceDataScopeKey(scope);
    for (let attempt = 0; attempt < 3; attempt++) {
      this.assertOpen(); const generation = this.revision(); if (this.complete.get(key) === generation) return;
      let task = this.tasks.get(key);
      if (!task) {
        task = this.reconcile(scope, generation).then(() => { this.complete.set(key, generation); });
        this.tasks.set(key, task);
        void task.finally(() => { if (this.tasks.get(key) === task) this.tasks.delete(key); }).catch(() => {});
      }
      try { await task; }
      catch (error) {
        const changed = error instanceof AuthError && error.code === 'MESSAGING_GROUP_POLICY_CHANGED'
          || error instanceof DatabaseError && error.outcome === 'unknown' && this.revision() !== generation;
        // This trusted reconciliation is convergent and has no external
        // effects. A fresh snapshot may safely settle an uncertain prior write.
        if (!changed || attempt === 2) throw error;
      }
    }
    if (this.complete.get(key) !== this.revision()) throw new AuthError('Group membership changed during synchronization.', 'MESSAGING_GROUP_POLICY_CHANGED', 409);
  }
  async close(): Promise<void> {
    this.stopped = true; clearTimeout(this.timer); this.remove?.(); this.remove = null;
    await Promise.allSettled([...this.tasks.values()]); this.complete.clear(); this.applied.clear();
  }
  private async reconcile(scope: ServiceDataScope, generation: number): Promise<void> {
    const check = () => { this.assertOpen(); this.deps.directory.assertScope(scope); if (this.revision() !== generation) throw new AuthError('Group membership changed during synchronization.', 'MESSAGING_GROUP_POLICY_CHANGED', 409); };
    check();
    const groups = Object.values(this.deps.config.groups), members = new Map(groups.map(group => [group.id, [] as string[]]));
    let after = '', scanned = 0;
    for (;;) {
      check(); const page = this.deps.directory.groupCandidates!(scope, after, 50);
      scanned += page.ids.length;
      if (scanned > 10000) throw new AuthError('The configured group directory exceeds its bounded reconciliation budget.', 'MESSAGING_CAPACITY', 429);
      for (const id of page.ids) for (const group of groups) if (this.deps.directory.groupRecipient!(scope, id, group.id)) {
        const values = members.get(group.id)!; values.push(id);
        if (values.length > this.deps.config.maxParticipants) throw new AuthError('A configured group exceeds the configured participant limit.', 'MESSAGING_CAPACITY', 429);
      }
      if (!page.hasMore) break;
      if (!page.ids.length) throw new Error('[messaging] Group directory did not advance.');
      after = page.ids.at(-1)!;
      await new Promise<void>(resolve => setImmediate(resolve)); // Yield between bounded pages, outside SQL/auth leases.
    }
    const scopeId = serviceDataScopeKey(scope);
    const run = async () => {
      for (const group of groups) {
        check(); const id = 'group_' + messagingHash([scopeId, group.id]).slice(0, 40), users = members.get(group.id)!;
        const key = scopeId + ':' + group.id, fingerprint = messagingHash([group.name, group.policyHash, users]);
        // Login/session revisions also advance Guardian's shared clock. If
        // membership/config did not change, do not create a private commit,
        // durable receipt, audit transaction or live invalidation for it.
        if (this.applied.get(key) === fingerprint) continue;
        await this.deps.runtime.write(scope, 'messaging.group.reconcile', { scopeId, id, groupId: group.id, name: group.name,
          policyHash: group.policyHash, history: group.history, members: users, maxParticipants: this.deps.config.maxParticipants },
        // A -> B -> A is a new reconciliation, not replay of the first A's
        // transport receipt. The command itself is convergent and content-free.
        'group-sync:' + crypto.randomUUID(), check);
        check(); this.applied.set(key, fingerprint);
      }
    };
    const logging = this.deps.logging;
    if (logging) await runWithLoggingAttribution(logging, { sourceId: 'messaging-groups', origin: 'system',
      scope: scope.tenantId === null ? { kind: 'application', tenantId: null } : { kind: 'tenant', tenantId: scope.tenantId },
      actor: { kind: 'system', id: 'zero.messaging.groups', sessionId: null, initiatorId: null }, requestId: null, correlationId: null, policyVersion: logging.config.policyVersion }, check, run);
    else await run();
    check();
  }
  private arm(delay = 50): void {
    if (this.stopped || this.timer) return;
    if (this.backgroundRunning) { this.backgroundDirty = true; return; }
    this.timer = withoutLoggingAttribution(() => setTimeout(() => {
      this.timer = undefined;
      void this.background();
    }, delay)); this.timer.unref?.();
  }
  private async background(): Promise<void> {
    if (this.stopped) return;
    this.backgroundRunning = true; this.backgroundDirty = false;
    let failed = false;
    try {
      const revision = this.revision();
      // Workflow/notification changes are wake hints, not membership changes.
      // One cheap clock read avoids rescanning every retained organization.
      if (this.lastBackgroundRevision === revision) return;
      for (const scope of this.deps.runtime.retainedScopes()) { if (this.stopped) break; await this.ensure(scope); }
      this.lastBackgroundRevision = revision;
    }
    catch { if (!this.stopped) { failed = true; try { this.deps.failed(); } catch { /* Safe diagnostics cannot change membership. */ } } }
    finally { this.backgroundRunning = false; if (failed || this.backgroundDirty) this.arm(failed ? 5000 : 50); }
  }
  private assertOpen(): void { if (this.stopped) throw new AuthError('Managed messaging groups are unavailable.', 'MESSAGING_NOT_READY', 503); }
  private revision(): number {
    const revision = readAuthAuthorityRevision(this.deps.system);
    if (revision === null) throw new AuthError('Guardian group authority is unavailable.', 'MESSAGING_NOT_READY', 503);
    return revision;
  }
}
