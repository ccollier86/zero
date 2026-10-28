/** Bounded SYSTEM identity discovery. Searches display names, never email/contact fields or cross-organization users. */
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { UserStore } from '../auth/user-store';
import type { TenancyService } from '../auth/tenancy';
import type { ReactiveDB } from '../sync/reactive-db';
import type { MessagingDirectory } from './service';
import type { MessagingDirectoryEntry, MessagingPage } from './contracts';
import { messagingFail, messagingId, messagingInteger, messagingRecord, messagingText } from './validation';
import { AuthError } from '../auth/types';
import { MESSAGING_DIRECTORY_ELIGIBLE } from './directory-eligibility';

interface DirectoryDependencies { readonly db: ReactiveDB; readonly users: UserStore; readonly tenancy: TenancyService | null; publicAvatar(userId: string): string | null; supportRecipient?(scope: ServiceDataScope, userId: string): boolean; supportEntryRecipient?(scope: ServiceDataScope, userId: string, entryId: string): boolean; assistantRecipient?(scope: ServiceDataScope, userId: string, assistantId: string): boolean; groupRecipient?(scope: ServiceDataScope, userId: string, groupId: string): boolean }
/** The server owns Guardian relationships and published avatar descriptors; caller-selected identity metadata is ignored. */
export class ManagedMessagingDirectory implements MessagingDirectory {
  constructor(private readonly deps: DirectoryDependencies) {}
  /** Exact canonical member IDs avoid scanning every account to label a conversation. */
  resolve(scope: ServiceDataScope, userIds: readonly string[]): readonly MessagingDirectoryEntry[] {
    this.assertScope(scope);
    if (userIds.length > 100) messagingFail('MESSAGING_INPUT_INVALID', 422);
    const ids = [...new Set(userIds.map(messagingId))]; if (!ids.length) return [];
    const values = [...ids], tenant = scope.tenantId === null ? '' : " AND EXISTS(SELECT 1 FROM _auth_tenant_memberships m JOIN _auth_tenants t ON t.tenant_id=m.tenant_id WHERE m.user_id=u.user_id AND m.tenant_id=? AND m.status='active' AND t.status='active')";
    if (scope.tenantId !== null) values.push(scope.tenantId);
    const rows = this.deps.db.prepare(`SELECT u.user_id,u.username,u.first_name,u.last_name FROM users u WHERE ${MESSAGING_DIRECTORY_ELIGIBLE} AND u.user_id IN (${ids.map(() => '?').join(',')})${tenant}`)
      .all(...values) as { user_id: string; username: string; first_name: string | null; last_name: string | null }[];
    return rows.map(row => ({ id: row.user_id, name: ([row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.username).slice(0, 241), avatarUrl: this.deps.publicAvatar(row.user_id) }));
  }
  assertScope(scope: ServiceDataScope): void {
    if (scope.tenantId !== null && this.deps.tenancy?.getTenant(scope.tenantId)?.status !== 'active') messagingFail('MESSAGING_NOT_FOUND', 404);
  }
  assertRecipient(scope: ServiceDataScope, userId: string): void {
    this.assertScope(scope);
    if (!this.deps.db.prepare(`SELECT 1 FROM users u WHERE u.user_id=? AND ${MESSAGING_DIRECTORY_ELIGIBLE}`).get(messagingId(userId))) messagingFail('MESSAGING_NOT_FOUND', 404);
    if (scope.tenantId !== null) {
      const tenant = this.deps.tenancy?.getTenant(scope.tenantId), member = this.deps.tenancy?.getMembership(scope.tenantId, userId);
      if (tenant?.status !== 'active' || member?.status !== 'active') messagingFail('MESSAGING_NOT_FOUND', 404);
    }
  }
  notificationRecipient(scope: ServiceDataScope, userId: string, staff: boolean): boolean {
    try { this.assertRecipient(scope, userId); return !staff || this.deps.supportRecipient?.(scope, userId) === true; }
    catch (error) { if (error instanceof AuthError && [403, 404].includes(error.status)) return false; throw error; }
  }
  assistantRecipient(scope: ServiceDataScope, userId: string, assistantId: string): boolean {
    try { this.assertRecipient(scope, userId); return this.deps.assistantRecipient?.(scope, userId, assistantId) === true; }
    catch (error) { if (error instanceof AuthError && [403, 404].includes(error.status)) return false; throw error; }
  }
  supportRecipient(scope: ServiceDataScope, userId: string, entryId: string): boolean {
    return this.notificationRecipient(scope, userId, true) && this.deps.supportEntryRecipient?.(scope, userId, entryId) === true;
  }
  groupRecipient(scope: ServiceDataScope, userId: string, groupId: string): boolean {
    try { this.assertRecipient(scope, userId); return this.deps.groupRecipient?.(scope, userId, groupId) === true; }
    catch (error) { if (error instanceof AuthError && [403, 404].includes(error.status)) return false; throw error; }
  }
  groupCandidates(scope: ServiceDataScope, after: string, limit: number): { ids: readonly string[]; hasMore: boolean } {
    this.assertScope(scope);
    const maximum = messagingInteger(limit, 1, 100), values: (string | number)[] = [after];
    const tenant = scope.tenantId === null ? '' : " AND EXISTS(SELECT 1 FROM _auth_tenant_memberships m JOIN _auth_tenants t ON t.tenant_id=m.tenant_id WHERE m.user_id=u.user_id AND m.tenant_id=? AND m.status='active' AND t.status='active')";
    if (scope.tenantId !== null) values.push(scope.tenantId);
    const rows = this.deps.db.prepare(`SELECT u.user_id FROM users u WHERE ${MESSAGING_DIRECTORY_ELIGIBLE} AND u.user_id>?` + tenant + ' ORDER BY u.user_id LIMIT ?').all(...values, maximum + 1) as { user_id: string }[];
    return { ids: rows.slice(0, maximum).map(row => row.user_id), hasMore: rows.length > maximum };
  }
  list(scope: ServiceDataScope, actorId: string, query: { after?: string; limit?: number; search?: string }): MessagingPage<MessagingDirectoryEntry> {
    const q = messagingRecord(query, ['after', 'limit', 'search']), limit = messagingInteger(q.limit ?? 25, 1, 50);
    const where = [MESSAGING_DIRECTORY_ELIGIBLE, 'u.user_id<>?', 'u.user_id>?'], values: (string | number)[] = [actorId, q.after === undefined ? '' : messagingId(q.after)];
    if (scope.tenantId !== null) {
      where.push("EXISTS(SELECT 1 FROM _auth_tenant_memberships m JOIN _auth_tenants t ON t.tenant_id=m.tenant_id WHERE m.user_id=u.user_id AND m.tenant_id=? AND m.status='active' AND t.status='active')"); values.push(scope.tenantId);
    }
    if (q.search !== undefined) {
      const search = messagingText(q.search, 100, true).trim().replace(/[\\%_]/g, value => '\\' + value);
      where.push("(u.username LIKE ? ESCAPE '\\' OR coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'') LIKE ? ESCAPE '\\')"); values.push('%' + search + '%', '%' + search + '%');
    }
    const rows = this.deps.db.prepare(`SELECT u.user_id,u.username,u.first_name,u.last_name FROM users u WHERE ${where.join(' AND ')} ORDER BY u.user_id LIMIT ?`).all(...values, limit + 1) as { user_id: string; username: string; first_name: string | null; last_name: string | null }[];
    // Current profile names allow 120 characters each. Bound legacy longer
    // display values on the wire without changing their canonical identity/profile.
    const items = rows.slice(0, limit).map(row => ({ id: row.user_id, name: ([row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.username).slice(0, 241), avatarUrl: this.deps.publicAvatar(row.user_id) }));
    return { items, hasMore: rows.length > limit, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }
}
