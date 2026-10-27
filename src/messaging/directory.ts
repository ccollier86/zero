/** Bounded SYSTEM identity discovery. Searches display names, never email/contact fields or cross-organization users. */
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { UserStore } from '../auth/user-store';
import type { TenancyService } from '../auth/tenancy';
import type { ReactiveDB } from '../sync/reactive-db';
import type { MessagingDirectory } from './service';
import type { MessagingDirectoryEntry, MessagingPage } from './contracts';
import { messagingFail, messagingId, messagingInteger, messagingRecord, messagingText } from './validation';

interface DirectoryDependencies { readonly db: ReactiveDB; readonly users: UserStore; readonly tenancy: TenancyService | null; publicAvatar(userId: string): string | null }
/** The server owns Guardian relationships and published avatar descriptors; caller-selected identity metadata is ignored. */
export class ManagedMessagingDirectory implements MessagingDirectory {
  constructor(private readonly deps: DirectoryDependencies) {}
  assertRecipient(scope: ServiceDataScope, userId: string): void {
    const user = this.deps.users.getUserById(messagingId(userId));
    if (!user || user.status !== 'active') messagingFail('MESSAGING_NOT_FOUND', 404);
    if (scope.tenantId !== null) {
      const tenant = this.deps.tenancy?.getTenant(scope.tenantId), member = this.deps.tenancy?.getMembership(scope.tenantId, userId);
      if (tenant?.status !== 'active' || member?.status !== 'active') messagingFail('MESSAGING_NOT_FOUND', 404);
    }
  }
  list(scope: ServiceDataScope, actorId: string, query: { after?: string; limit?: number; search?: string }): MessagingPage<MessagingDirectoryEntry> {
    const q = messagingRecord(query, ['after', 'limit', 'search']), limit = messagingInteger(q.limit ?? 25, 1, 50);
    const where = ["u.status='active'", 'u.user_id<>?', 'u.user_id>?'], values: (string | number)[] = [actorId, q.after === undefined ? '' : messagingId(q.after)];
    if (scope.tenantId !== null) {
      where.push("EXISTS(SELECT 1 FROM _auth_tenant_memberships m JOIN _auth_tenants t ON t.tenant_id=m.tenant_id WHERE m.user_id=u.user_id AND m.tenant_id=? AND m.status='active' AND t.status='active')"); values.push(scope.tenantId);
    }
    if (q.search !== undefined) {
      const search = messagingText(q.search, 100, true).trim().replace(/[\\%_]/g, value => '\\' + value);
      where.push("(u.username LIKE ? ESCAPE '\\' OR coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'') LIKE ? ESCAPE '\\')"); values.push('%' + search + '%', '%' + search + '%');
    }
    const rows = this.deps.db.prepare(`SELECT u.user_id,u.username,u.first_name,u.last_name FROM users u WHERE ${where.join(' AND ')} ORDER BY u.user_id LIMIT ?`).all(...values, limit + 1) as { user_id: string; username: string; first_name: string | null; last_name: string | null }[];
    const items = rows.slice(0, limit).map(row => ({ id: row.user_id, name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.username, avatarUrl: this.deps.publicAvatar(row.user_id) }));
    return { items, hasMore: rows.length > limit, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }
}
