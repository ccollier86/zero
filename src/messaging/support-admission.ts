/** Actor-local support admission from canonical destination origin. It never resolves Guardian or trusts a client destination kind. */
import type { ConversationRow, MessagingActor } from './realm-model';

/** Public-entry and authenticated-inbox grants are not interchangeable, including after a name is reused. */
export function canHandleMessagingSupport(actor: MessagingActor, conversation: Pick<ConversationRow, 'kind' | 'support_entry_id' | 'visitor_session_id'>): boolean {
  if (actor.kind !== 'user' || !actor.staff || conversation.kind !== 'support') return false;
  const id = conversation.support_entry_id;
  return id == null || !!(conversation.visitor_session_id != null ? actor.supportPolicies : actor.inboxStaffPolicies)?.[id];
}

/** Same destination-origin predicate before bounded keyset pagination. The alias is a closed server-owned SQL spelling. */
export function messagingSupportStaffFilter(actor: MessagingActor, alias: '' | 'c.' = ''): { sql: string; values: string[] } {
  const clauses = [alias + 'support_entry_id IS NULL'], values: string[] = [];
  for (const [ids, origin] of [[Object.keys(actor.supportPolicies ?? {}), 'IS NOT NULL'], [Object.keys(actor.inboxStaffPolicies ?? {}), 'IS NULL']] as const) {
    if (!ids.length) continue;
    clauses.push(`(${alias}visitor_session_id ${origin} AND ${alias}support_entry_id IN (${ids.map(() => '?').join(',')}))`); values.push(...ids);
  }
  return { sql: '(' + clauses.join(' OR ') + ')', values };
}
