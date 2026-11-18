/** Trusted SYSTEM-backed native participant directory. Never construct from browser/request database paths. */
import type { ServiceDataScope } from '../auth/service-data-scope';
import { authTokenEligibleUserSql } from '../auth/auth-user-eligibility';
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import type { ReactiveDB } from '../sync/reactive-db';
import type { CalendarParticipantReference, CalendarParticipantView, CalendarParticipantDirectoryQuery, CalendarParticipantDirectoryPage } from './contracts';
import type { ResolvedCalendarConfig } from './config';
import { CalendarError } from './error';
import { calendarInteger, calendarKey, calendarRecord, calendarValue } from './validation';
import { createCalendarParticipantPolicy, type CalendarParticipantPolicyDependencies } from './participants-policy';
import { calendarParticipantSearch } from './participants-validation';

/** Scope comes only from admitted Guardian authority. Every target guard is synchronous and fresh. */
export interface CalendarParticipantDirectory {
  list(scope: ServiceDataScope, query: CalendarParticipantDirectoryQuery): CalendarParticipantDirectoryPage;
  resolve(scope: ServiceDataScope, refs: readonly CalendarParticipantReference[]): readonly CalendarParticipantView[];
  assertBindable(scope: ServiceDataScope, refs: readonly CalendarParticipantReference[]): void;
  subscribe(scope: ServiceDataScope, listener: () => void): () => void;
}

interface DirectoryDependencies extends Omit<CalendarParticipantPolicyDependencies, 'userEligibility'> {
  readonly db: ReactiveDB;
  readonly config: ResolvedCalendarConfig;
}
type DirectoryRow = { user_id: string; first_name: string | null; last_name: string | null };
interface Cursor { readonly scope: string; readonly search: string; readonly limit: number; readonly after: string; readonly expiresAt: number }
const ELIGIBLE = `${authTokenEligibleUserSql('u')}
  AND NOT EXISTS(SELECT 1 FROM _auth_registration_provisioning p WHERE p.user_id=u.user_id)
  AND NOT EXISTS(SELECT 1 FROM _auth_admin_user_provisioning p WHERE p.user_id=u.user_id)`;
const MEMBERSHIP = "EXISTS(SELECT 1 FROM _auth_tenant_memberships m JOIN _auth_tenants t ON t.tenant_id=m.tenant_id WHERE m.user_id=u.user_id AND m.tenant_id=? AND m.status='active' AND t.status='active')";
const MAX_SCAN = 1000;

export class ManagedCalendarParticipantDirectory implements CalendarParticipantDirectory {
  private readonly eligible: (scope: ServiceDataScope, userId: string) => boolean;
  private stopped = false;
  private readonly subscriptions = new Map<symbol, () => void>();
  /** Bounded scan state, never profile/presentation data. Cursors are process-local and expire in five minutes. */
  private readonly cursors = new Map<string, Cursor>();
  private unsubscribeCommit: (() => void) | null = null;
  private commitChanges: number | null = null;
  private changesStatement: ReturnType<ReactiveDB['prepare']> | null = null;

  constructor(private readonly deps: DirectoryDependencies) {
    if (!deps.config.participants) throw new CalendarError('CALENDAR_NOT_READY');
    this.eligible = createCalendarParticipantPolicy({ ...deps, userEligibility: deps.config.participants.userEligibility });
  }

  list(scope: ServiceDataScope, input: CalendarParticipantDirectoryQuery): CalendarParticipantDirectoryPage {
    this.assertScope(scope);
    const query = calendarRecord(input, ['after', 'limit', 'search']);
    const maximum = Math.min(100, this.deps.config.maxPageSize);
    const limit = calendarInteger(query.limit ?? Math.min(25, maximum), 1, maximum);
    const search = query.search === undefined ? '' : calendarParticipantSearch(query.search);
    let after = query.after === undefined ? '' : this.resume(scope, calendarKey(query.after), search, limit);
    const where = [ELIGIBLE, 'u.user_id>?'], values: (string | number)[] = [after];
    if (scope.tenantId !== null) { where.push(MEMBERSHIP); values.push(scope.tenantId); }
    if (query.search !== undefined) {
      const escaped = search.replace(/[\\%_]/g, value => '\\' + value);
      // Login names, email addresses, phones and private profile fields are not
      // search facets. An unnamed account has only the constant safe fallback.
      where.push("(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) LIKE ? ESCAPE '\\'");
      values.push('%' + escaped + '%');
    }
    const statement = this.deps.db.prepare(`SELECT u.user_id,u.first_name,u.last_name FROM users u WHERE ${where.join(' AND ')} ORDER BY u.user_id COLLATE BINARY LIMIT ?`);
    const items: CalendarParticipantView[] = [];
    let scanned = 0, truncated = false;
    try {
      while (scanned < MAX_SCAN) {
        values[0] = after;
        const batchSize = Math.min(100, MAX_SCAN - scanned);
        const rows = statement.all(...values, batchSize + 1) as DirectoryRow[];
        const batch = rows.slice(0, batchSize);
        for (let index = 0; index < batch.length; index++) {
          const row = batch[index]!; after = row.user_id; scanned++;
          // Exact resolution repeats the canonical predicate rather than
          // using a presentation snapshot as target authority.
          const current = this.current(scope, row.user_id);
          if (current) items.push(presentation(current));
          if (items.length === limit) {
            truncated = index + 1 < batch.length || rows.length > batchSize;
            this.assertScope(scope);
            return { items, truncated, nextAfter: truncated ? this.cursor(scope, search, limit, after) : null };
          }
        }
        if (rows.length <= batchSize) { truncated = false; break; }
        truncated = true;
      }
      this.assertScope(scope);
      // Bounded scanning may produce an empty page with a continuation. It
      // reveals neither unfiltered counts nor hidden-subject presentation.
      return { items, truncated, nextAfter: truncated ? this.cursor(scope, search, limit, after) : null };
    } finally { statement.finalize(); }
  }

  resolve(scope: ServiceDataScope, input: readonly CalendarParticipantReference[]): readonly CalendarParticipantView[] {
    this.assertScope(scope);
    const refs = this.references(input);
    const result = refs.map(ref => {
      const row = this.current(scope, ref.userId);
      return row ? presentation(row) : { ref, availability: 'unavailable' as const };
    });
    this.assertScope(scope); return result;
  }

  assertBindable(scope: ServiceDataScope, input: readonly CalendarParticipantReference[]): void {
    this.assertScope(scope);
    for (const ref of this.references(input, this.deps.config.maxParticipants)) {
      if (!this.current(scope, ref.userId)) throw new CalendarError('CALENDAR_NOT_FOUND');
    }
    this.assertScope(scope);
  }

  subscribe(scope: ServiceDataScope, listener: () => void): () => void {
    this.assertScope(scope);
    if (typeof listener !== 'function') throw new CalendarError('CALENDAR_INPUT_INVALID');
    if (this.subscriptions.size >= 256) throw new CalendarError('CALENDAR_CAPACITY');
    const token = Symbol(); this.subscriptions.set(token, listener);
    if (!this.unsubscribeCommit) {
      try {
        this.changesStatement = this.deps.db.prepare('SELECT total_changes() AS n');
        this.commitChanges = this.totalChanges();
        this.unsubscribeCommit = this.deps.db.onCommit(() => {
          // onCommit deliberately includes read-only root transactions. Native
          // Guardian confirmation performs those reads inside a transaction;
          // announcing every completion would invalidate the read that caused
          // its own confirmation forever. This connection-local O(1) watermark
          // is only a wake filter, never eligibility or presentation authority.
          const changes = this.totalChanges();
          if (changes === this.commitChanges) return;
          this.commitChanges = changes; this.wake();
        });
      } catch (error) { this.subscriptions.delete(token); this.stopHints(); throw error; }
      // This is a local wake hint, not a cross-process feed. The service's
      // existing bounded quiet-watch revalidation resolves current SYSTEM
      // presentation even when no local hint or calendar commit occurs.
    }
    return () => { this.subscriptions.delete(token); if (!this.subscriptions.size) this.stopHints(); };
  }

  close(): void { if (this.stopped) return; this.stopped = true; this.subscriptions.clear(); this.cursors.clear(); this.stopHints(); }

  private resume(scope: ServiceDataScope, token: string, search: string, limit: number): string {
    const cursor = this.cursors.get(token);
    if (!cursor || cursor.expiresAt <= Date.now() || cursor.scope !== scope.scopeKind + ':' + scope.scopeId
      || cursor.search !== search || cursor.limit !== limit) throw new CalendarError('CALENDAR_INPUT_INVALID');
    return cursor.after;
  }
  private cursor(scope: ServiceDataScope, search: string, limit: number, after: string): string {
    const now = Date.now(), scopeKey = scope.scopeKind + ':' + scope.scopeId;
    for (const [key, cursor] of this.cursors) if (cursor.expiresAt <= now) this.cursors.delete(key);
    for (const [token, cursor] of this.cursors) {
      if (cursor.scope === scopeKey && cursor.search === search && cursor.limit === limit && cursor.after === after) return token;
    }
    while (this.cursors.size >= 256) this.cursors.delete(this.cursors.keys().next().value!);
    const token = 'pc_' + crypto.randomUUID();
    this.cursors.set(token, { scope: scopeKey, search, limit, after, expiresAt: now + 300_000 });
    return token;
  }

  private wake(): void {
    if (this.stopped) return;
    for (const listener of [...this.subscriptions.values()]) {
      try { listener(); } catch { /* A wake hint cannot change the committed SYSTEM outcome. */ }
    }
  }
  private totalChanges(): number {
    const row = this.changesStatement?.get() as { n: number } | undefined;
    if (!row || !Number.isSafeInteger(row.n) || row.n < 0) throw new CalendarError('CALENDAR_NOT_READY');
    return row.n;
  }
  private stopHints(): void {
    this.unsubscribeCommit?.(); this.unsubscribeCommit = null;
    this.changesStatement?.finalize(); this.changesStatement = null; this.commitChanges = null;
  }

  private assertScope(scope: ServiceDataScope): void {
    if (this.stopped) throw new CalendarError('CALENDAR_NOT_READY');
    invokeSynchronousAuthCallback(this.deps.assertCurrent, { component: 'calendar-participants', invariant: 'profile-guard-async',
      message: 'Calendar participant profile guard must be synchronous.' });
    if (this.deps.kernel.tenancy.mode === 'single') {
      if (scope.scopeKind !== 'application' || scope.scopeId !== 'application' || scope.tenantId !== null) throw new CalendarError('CALENDAR_NOT_FOUND');
    } else if (scope.scopeKind !== 'tenant' || scope.tenantId === null || scope.scopeId !== scope.tenantId
      || this.deps.tenancy?.getTenant(scope.tenantId)?.status !== 'active') throw new CalendarError('CALENDAR_NOT_FOUND');
  }
  private current(scope: ServiceDataScope, userId: string): DirectoryRow | null {
    const statement = this.deps.db.prepare(`SELECT u.user_id,u.first_name,u.last_name FROM users u WHERE u.user_id=? AND ${ELIGIBLE}${scope.tenantId === null ? '' : ' AND ' + MEMBERSHIP}`);
    let row: DirectoryRow | null;
    try { row = statement.get(...(scope.tenantId === null ? [userId] : [userId, scope.tenantId])) as DirectoryRow | null; }
    finally { statement.finalize(); }
    return row && this.eligible(scope, userId) ? row : null;
  }
  private references(input: readonly CalendarParticipantReference[], maximum = 100): readonly CalendarParticipantReference[] {
    const value = calendarValue(input);
    if (!Array.isArray(value) || value.length > Math.min(100, maximum)) throw new CalendarError('CALENDAR_INPUT_INVALID');
    const seen = new Set<string>();
    return value.map(item => {
      const ref = calendarRecord(item, ['kind', 'userId']);
      if (ref.kind !== 'guardian-user') throw new CalendarError('CALENDAR_INPUT_INVALID');
      const userId = calendarKey(ref.userId);
      if (seen.has(userId)) throw new CalendarError('CALENDAR_INPUT_INVALID');
      seen.add(userId); return Object.freeze({ kind: 'guardian-user' as const, userId });
    });
  }
}

function presentation(row: DirectoryRow): CalendarParticipantView {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim().slice(0, 241) || 'Account';
  return { ref: { kind: 'guardian-user', userId: row.user_id }, availability: 'available', name };
}
