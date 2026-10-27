/** A trusted Guardian directory snapshot reconciles canonical group membership in one short tracked commit. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { messagingCommand } from './realm-errors';
import { conversationMembers, memberKey, type ConversationRow, type MemberRow } from './realm-model';
import { jobScope } from './job-model';
import { messagingArray, messagingChoice, messagingFail, messagingId, messagingInteger, messagingRecord, messagingText } from './validation';

export function reconcileMessagingGroup(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['scopeId', 'id', 'groupId', 'name', 'policyHash', 'history', 'members', 'maxParticipants']);
    const scope = jobScope(r.scopeId), id = messagingId(r.id), group = messagingText(r.groupId, 64), name = messagingText(r.name, 120);
    const policy = messagingText(r.policyHash, 64), history = messagingChoice(r.history, ['all', 'since-join']);
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(group) || !/^[a-f0-9]{64}$/.test(policy)) messagingFail('MESSAGING_INPUT_INVALID', 422);
    const members = [...new Set(messagingArray(r.members, messagingInteger(r.maxParticipants, 2, 100)).map(messagingId))].sort();
    let row = context.db.get('messaging_conversations', id) as ConversationRow | null;
    if (row && (row.scope_id !== scope || row.kind !== 'group' || row.managed_group_id !== group)) messagingFail('MESSAGING_OWNER_INVALID');
    const now = Date.now();
    if (!row) {
      context.db.createStrict('messaging_conversations', { id, scope_id: scope, kind: 'group', title: name, revision: 1, created_at: now, updated_at: now,
        public_updated_at: now, archived: 0, created_by: 'system:group:' + group, owner: 'human', owner_id: null, owner_epoch: 1,
        internal_sequence: 0, public_sequence: 0, channel_id: null, assistant_id: null, managed_group_id: group, group_policy_hash: policy, members_json: '[]' });
      row = context.db.get('messaging_conversations', id) as ConversationRow;
    }
    const priorMembers = conversationMembers(row), changed = row.title !== name || row.group_policy_hash !== policy || JSON.stringify([...priorMembers].sort()) !== JSON.stringify(members);
    for (const prior of priorMembers) if (!members.includes(prior)) context.db.update('messaging_members', memberKey(id, prior), { active: 0 });
    for (const user of members) {
      const key = memberKey(id, user), prior = context.db.get('messaging_members', key) as MemberRow | null;
      if (prior?.active) continue;
      const values = { id: key, scope_id: scope, conversation_id: id, participant_id: user, kind: 'user', role: 'member', active: 1, joined_at: now,
        history_from: history === 'since-join' ? row.public_sequence + 1 : 1, read_sequence: prior?.read_sequence ?? 0 };
      if (prior) context.db.update('messaging_members', key, values); else context.db.createStrict('messaging_members', values);
    }
    if (changed) {
      if (row.revision >= Number.MAX_SAFE_INTEGER - 2) messagingFail('MESSAGING_CAPACITY', 429);
      context.db.update('messaging_conversations', id, { title: name, group_policy_hash: policy, members_json: JSON.stringify(members), revision: row.revision + 1,
        updated_at: now, public_updated_at: now });
    }
    return { id, changed };
  });
}
