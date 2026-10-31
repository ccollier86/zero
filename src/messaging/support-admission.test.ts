/** Pure actor/read predicate equivalence. Native Guardian/HTTP/files/Sync regressions qualify the actual transport separately. */
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { canHandleMessagingSupport, messagingSupportStaffFilter } from './support-admission';
import type { ConversationRow, MessagingActor } from './realm-model';

test('point admission and paginated SQL distinguish public, inbox and legacy origins even when both grants use the same name', () => {
  const db = new Database(':memory:'), hash = 'a'.repeat(64);
  const rows = [
    { id: 'legacy', kind: 'support', support_entry_id: null, visitor_session_id: null },
    { id: 'private', kind: 'support', support_entry_id: 'team', visitor_session_id: null },
    { id: 'public', kind: 'support', support_entry_id: 'team', visitor_session_id: 'visitor' },
    { id: 'other', kind: 'support', support_entry_id: 'other', visitor_session_id: null },
    { id: 'empty-entry', kind: 'support', support_entry_id: '', visitor_session_id: null },
    { id: 'nonnull-visitor', kind: 'support', support_entry_id: 'team', visitor_session_id: '' },
  ] as const;
  try {
    db.exec('CREATE TABLE cases(id TEXT,kind TEXT,support_entry_id TEXT,visitor_session_id TEXT)');
    for (const row of rows) db.query('INSERT INTO cases VALUES(?,?,?,?)').run(row.id, row.kind, row.support_entry_id, row.visitor_session_id);
    for (const grants of [{}, { supportPolicies: { team: hash } }, { inboxStaffPolicies: { team: hash } }, { supportPolicies: { team: hash }, inboxStaffPolicies: { team: hash } }]) {
      const actor: MessagingActor = { scopeId: 'application', id: 'staff', kind: 'user', staff: true, ...grants };
      const expected = rows.filter(row => canHandleMessagingSupport(actor, row as unknown as ConversationRow)).map(row => row.id).sort();
      for (const alias of ['', 'c.'] as const) {
        const filter = messagingSupportStaffFilter(actor, alias);
        expect(db.query<{ id: string }, string[]>('SELECT id FROM cases c WHERE ' + filter.sql + ' ORDER BY id').all(...filter.values).map(row => row.id)).toEqual(expected);
      }
      expect(canHandleMessagingSupport({ ...actor, staff: false }, rows[0])).toBe(false);
      expect(canHandleMessagingSupport({ ...actor, kind: 'external' }, rows[0])).toBe(false);
    }
    expect(canHandleMessagingSupport({ scopeId: 'application', id: 'staff', kind: 'user', staff: true, supportPolicies: { team: hash } }, rows[1])).toBe(false);
    expect(canHandleMessagingSupport({ scopeId: 'application', id: 'staff', kind: 'user', staff: true, inboxStaffPolicies: { team: hash } }, rows[2])).toBe(false);
  } finally { db.close(); }
});
