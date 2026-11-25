import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import type { AccessRequirement } from '../auth/authorization-kernel';
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { ReactiveDB } from '../sync/reactive-db';
import { messagingArray, messagingCatalogId, messagingFail, messagingHash, messagingId, messagingRecord, messagingText } from './validation';

export interface MessagingRelationshipContext {
  readonly scope: ServiceDataScope;
  readonly db: Pick<ReactiveDB, 'get' | 'query'>;
  allows(userId: string, requirement?: AccessRequirement): boolean;
  users(requirement: AccessRequirement): readonly string[];
}

export interface MessagingRelationshipSnapshot {
  readonly direct: readonly { readonly users: readonly [string, string]; readonly epoch: string }[];
  readonly groups: readonly {
    readonly id: string;
    readonly name: string;
    readonly members: readonly { readonly id: string; readonly epoch: string }[];
  }[];
}

export type MessagingRelationshipPolicy = (context: MessagingRelationshipContext) => MessagingRelationshipSnapshot;
export type MessagingRelationshipReader = (scope: ServiceDataScope) => MessagingRelationshipSnapshot;
export interface MessagingRelationshipNotice {
  readonly conversationKind?: string | null;
  readonly managedGroupId?: string | null;
  readonly senderId?: string | null;
  readonly relationshipEpoch?: string | null;
  readonly relationshipEpochs?: Readonly<Record<string, string>>;
}

export function readMessagingRelationships(policy: MessagingRelationshipPolicy, context: MessagingRelationshipContext, maxParticipants: number): MessagingRelationshipSnapshot {
  const snapshot = invokeSynchronousAuthCallback(() => policy(context), {
    component: 'messaging', invariant: 'relationship-policy', message: 'Messaging relationship policy must be synchronous.',
  });
  const input = messagingRecord(snapshot, ['direct', 'groups']);
  const pairs = new Map<string, MessagingRelationshipSnapshot['direct'][number]>();
  for (const raw of messagingArray(input.direct, 10000)) {
    const entry = messagingRecord(raw, ['users', 'epoch']), pair = messagingArray(entry.users, 2).map(messagingId).sort();
    if (pair.length !== 2 || pair[0] === pair[1]) messagingFail('MESSAGING_INPUT_INVALID', 422);
    const key = messagingHash(pair);
    if (pairs.has(key)) messagingFail('MESSAGING_INPUT_INVALID', 422);
    pairs.set(key, { users: pair as [string, string], epoch: messagingId(entry.epoch) });
  }
  const groupIds = new Set<string>();
  const groups = messagingArray(input.groups, 32).map(value => {
    const row = messagingRecord(value, ['id', 'name', 'members']);
    const id = messagingCatalogId(row.id), users = new Set<string>();
    if (groupIds.has(id)) messagingFail('MESSAGING_INPUT_INVALID', 422);
    groupIds.add(id);
    const members = messagingArray(row.members, maxParticipants).map(value => {
      const entry = messagingRecord(value, ['id', 'epoch']), user = messagingId(entry.id);
      if (users.has(user)) messagingFail('MESSAGING_INPUT_INVALID', 422);
      users.add(user);
      return { id: user, epoch: messagingId(entry.epoch) };
    }).sort((a, b) => a.id.localeCompare(b.id));
    return { id: 'rel_' + messagingHash([id]).slice(0, 48), name: messagingText(row.name, 120), members };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return { direct: [...pairs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, pair]) => pair), groups };
}

export function relationshipGroupHash(id: string): string {
  return messagingHash(['relationship-group', id]);
}

export function relationshipNoticeRecipients(graph: MessagingRelationshipSnapshot, notice: MessagingRelationshipNotice): ReadonlySet<string> {
  const recipients = new Set<string>();
  if (notice.conversationKind === 'direct' && notice.senderId) {
    for (const { users: [first, second], epoch } of graph.direct) {
      if (notice.relationshipEpoch !== epoch) continue;
      if (first === notice.senderId) recipients.add(second);
      else if (second === notice.senderId) recipients.add(first);
    }
  } else if (notice.managedGroupId) {
    for (const member of graph.groups.find(group => group.id === notice.managedGroupId)?.members ?? []) {
      if (notice.relationshipEpochs?.[member.id] === member.epoch) recipients.add(member.id);
    }
  }
  return recipients;
}
