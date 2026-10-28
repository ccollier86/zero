/** Framework-owned minimal Guardian directory. No contact details, credentials, profile contents or image bytes. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { LoggingReadScope } from './logging-contracts';
import type { LoggingPeoplePage, LoggingPeopleQuery, LoggingPerson, LoggingTableChoice } from './logging-directory-contracts';
import { loggingArray, loggingId, loggingRecord, invalid } from './logging-validation';
import { loggingTableTarget } from './logging-table-target';
export interface LoggingDirectoryPort {
  people(scope: LoggingReadScope, query: LoggingPeopleQuery): LoggingPeoplePage;
  lookup(scope: LoggingReadScope, userIds: readonly string[]): readonly LoggingPerson[];
  tables(scope: LoggingReadScope): readonly LoggingTableChoice[];
}
type PersonRow = { user_id: string; username: string; first_name: string | null; last_name: string | null; profile_revision: number };
const person = (row: PersonRow): LoggingPerson => Object.freeze({ id: row.user_id, username: row.username.slice(0, 200),
  name: ([row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.username || 'User').slice(0, 241), revision: row.profile_revision });
export function normalizeLoggingPeopleQuery(input: LoggingPeopleQuery): LoggingPeopleQuery & { readonly limit: number } {
  try {
    const r = loggingRecord(input, ['search', 'after', 'limit']), limit = r.limit === undefined ? 25 : r.limit;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) invalid();
    if (r.search !== undefined && (typeof r.search !== 'string' || r.search.length > 100 || /[\u0000-\u001f\u007f]/u.test(r.search))) invalid();
    return Object.freeze({ limit, ...(r.search === undefined ? {} : { search: (r.search as string).trim() }), ...(r.after === undefined ? {} : { after: loggingId(r.after)! }) });
  } catch { return invalid('LOGGING_QUERY_INVALID'); }
}
/** Logging-read admission is owned by the scoped facade. Current tenant membership still fences profile disclosure. */
export function createLoggingPersonDirectory(db: ReactiveDB, tableNames: readonly string[], tenantTableNames: readonly string[] = []): LoggingDirectoryPort {
  const grouped = new Map<string, string[]>();
  for (const name of [...new Set(tableNames)].filter(name => !name.startsWith('_')).sort()) {
    const type = loggingTableTarget(name);
    const names = grouped.get(type) ?? []; names.push(name); grouped.set(type, names);
  }
  const tables = Object.freeze([...grouped].map(([type, names]) => Object.freeze({ type, names: Object.freeze(names) })));
  const tenantNames = new Set(tenantTableNames);
  const tenantTables = Object.freeze(tables.map(table => Object.freeze({ ...table, names: Object.freeze(table.names.filter(name => tenantNames.has(name))) })).filter(table => table.names.length));
  const predicate = (scope: LoggingReadScope, values: (string | number)[]) => {
    // Suspended accounts remain identities in an investigation. Unfinished
    // provisioning and removed/cross-tenant subjects are not a directory grant.
    const where = ["u.status IN ('active','suspended')",
      'NOT EXISTS(SELECT 1 FROM _auth_registration_provisioning r WHERE r.user_id=u.user_id)',
      'NOT EXISTS(SELECT 1 FROM _auth_admin_user_provisioning p WHERE p.user_id=u.user_id)'];
    if (scope.kind === 'tenant') {
      where.push("EXISTS(SELECT 1 FROM _auth_tenant_memberships m JOIN _auth_tenants t ON t.tenant_id=m.tenant_id WHERE m.user_id=u.user_id AND m.tenant_id=? AND m.status='active' AND t.status='active')"); values.push(scope.tenantId);
    }
    return where;
  };
  const select = () => 'SELECT u.user_id,u.username,u.first_name,u.last_name,'
    + (db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name='profile_revision'").get() ? 'u.profile_revision' : '1') + ' AS profile_revision FROM users u WHERE ';
  return Object.freeze({
    tables: scope => scope.kind === 'tenant' ? tenantTables : tables,
    people(scope, input) {
      const query = normalizeLoggingPeopleQuery(input), values: (string | number)[] = [], where = predicate(scope, values);
      if (query.after) { where.push('u.user_id>?'); values.push(query.after); }
      if (query.search) {
        const search = '%' + query.search.replace(/[\\%_]/g, value => '\\' + value) + '%';
        where.push("(u.username LIKE ? ESCAPE '\\' OR coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'') LIKE ? ESCAPE '\\')"); values.push(search, search);
      }
      const rows = db.prepare(select() + where.join(' AND ') + ' ORDER BY u.user_id LIMIT ?').all(...values, query.limit + 1) as PersonRow[];
      const items = rows.slice(0, query.limit).map(person), hasMore = rows.length > query.limit;
      return { items, hasMore, nextCursor: hasMore ? items.at(-1)!.id : null };
    },
    lookup(scope, userIds) {
      const ids = [...new Set(loggingArray(userIds, 100).map(value => loggingId(value)!))]; if (!ids.length) return [];
      const values: (string | number)[] = [], where = predicate(scope, values);
      where.push('u.user_id IN (' + ids.map(() => '?').join(',') + ')'); values.push(...ids);
      return (db.prepare(select() + where.join(' AND ')).all(...values) as PersonRow[]).map(person);
    },
  } satisfies LoggingDirectoryPort);
}
