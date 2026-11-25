/** Closed in-memory facades only; no databases, servers, files or providers are opened. */
import { expect, test } from 'bun:test';
import { AuthError, type AuthContext } from '../auth/types';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import { MessagingService, type MessagingAuthority, type MessagingDependencies } from './service';
import type { ConversationRecord, MessagingDirectoryEntry } from './contracts';

function fixture(relationships = true) {
  const auth: AuthContext = { userId: 'resident', email: 'synthetic@example.test', role: 'user', sessionKind: 'web' };
  const calls: Array<{ viewer: string; subject: string }> = [];
  let admitted = true, photoAllowed = true, revision = 1, kind: ConversationRecord['kind'] = 'group';
  const row: MessagingDirectoryEntry = { id: 'staff', name: 'Staff', avatarUrl: null };
  const directory = { assertScope() {}, assertRecipient() {}, notificationRecipient: () => true,
    list: (_scope: unknown, _actor: string, _query: unknown, _staff: boolean, peers?: readonly string[]) => {
      expect(peers).toEqual(relationships ? ['staff'] : undefined);
      return { items: [row], hasMore: false, nextCursor: null };
    },
    resolve: (_scope: unknown, ids: readonly string[]) => ids.map(id => ({ id, name: id, avatarUrl: null })),
  };
  const conversation = (): ConversationRecord => ({ id: 'house', kind, title: 'House', revision: 1, createdAt: 1, updatedAt: 1, archived: false,
    owner: 'human', ownerId: null, ownerEpoch: 1, unreadCount: 0, lastMessage: null,
    participants: [{ id: 'resident', kind: 'user', role: 'member', joinedAt: 1 }, { id: kind === 'direct' ? 'staff' : 'housemate', kind: 'user', role: 'member', joinedAt: 1 }] });
  const runtime = { read: async (_scope: unknown, name: string, _input: unknown, check: () => void) => {
    check(); if (!admitted) throw new AuthError('Synthetic inaccessible conversation.', 'MESSAGING_NOT_FOUND', 404);
    if (name === 'messaging.conversation') return conversation();
    if (name === 'messaging.conversations') return { items: [conversation()], hasMore: false, nextCursor: null };
    if (name === 'messaging.contacts') return { items: [{ id: 'contact', userId: 'staff', direction: 'outgoing', state: 'accepted', revision: 1, updatedAt: 1 }], hasMore: false, nextCursor: null };
    throw new Error('Unexpected synthetic query: ' + name);
  } };
  const deps = { directory, runtime, attachments: { forAuthority: () => ({}) },
    config: { portal: false, directory: 'everyone', support: false, assistants: {}, groups: {}, supportInboxes: {},
      ...(relationships ? { relationships: () => ({ direct: [], groups: [] }) } : {}) },
    ...(relationships ? { relationships: () => ({ direct: [{ users: ['resident', 'staff'], epoch: 'assigned' }],
      groups: [{ id: 'house', name: 'House', members: [{ id: 'resident', epoch: 'stay' }, { id: 'housemate', epoch: 'other-stay' }] }] }) } : {}),
    privateAvatar: (viewer: AuthContext, subject: string) => {
      calls.push({ viewer: viewer.userId, subject });
      if (!photoAllowed) throw new Error('Synthetic private policy failure: NEVER_EXPOSE');
      return { revision, asset: null };
    },
  } as unknown as MessagingDependencies;
  const authority: MessagingAuthority = { scope: applicationServiceDataScope(),
    access: { requireUser: () => auth, requireAuthorizationScope: () => ({}) } as unknown as RequestAuthorizationAccess,
    assertCurrentAuthoritySync() {},
  };
  const service = new MessagingService(deps), api = service.forAuthority(authority);
  return { api, calls, denyConversation: () => { admitted = false; }, denyPhoto: () => { photoAllowed = false; },
    replace: () => { revision++; }, direct: () => { kind = 'direct'; } };
}

test('admitted group peers receive private metadata without becoming direct-message targets', async () => {
  const f = fixture();
  const directory = await f.api.directory(); expect(directory.items.map(row => row.id)).toEqual(['staff']);
  expect(directory.items[0]?.privateAvatar).toEqual({ revision: 1, asset: null });
  const people = await f.api.conversations.people('house');
  expect(people.items.find(row => row.id === 'housemate')?.privateAvatar).toEqual({ revision: 1, asset: null });
  expect(f.calls).toContainEqual({ viewer: 'resident', subject: 'housemate' });
  f.replace(); const next = await f.api.conversations.people('house');
  expect(next.items.find(row => row.id === 'housemate')?.privateAvatar?.revision).toBe(2);
  f.calls.length = 0; f.denyConversation();
  await expect(f.api.conversations.people('house')).rejects.toMatchObject({ status: 404 }); expect(f.calls).toEqual([]);
});

test('direct previews and contacts project private photos after admission and optional photo errors yield initials', async () => {
  const f = fixture(false); f.direct();
  const page = await f.api.conversations.list();
  expect(page.items[0]?.participants.find(row => row.id === 'staff')?.privateAvatar).toEqual({ revision: 1, asset: null });
  expect((await f.api.contacts.list()).items[0]?.privateAvatar).toEqual({ revision: 1, asset: null });
  f.denyPhoto();
  expect((await f.api.directory()).items[0]?.privateAvatar).toBeNull();
  expect((await f.api.conversations.people('house')).items.every(row => row.privateAvatar === null)).toBe(true);
  expect((await f.api.contacts.list()).items[0]?.privateAvatar).toBeNull();
});
