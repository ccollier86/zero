/** Public wire-shape validation only; capabilities are not proof of current authority or worker health. */
import { expect, test } from 'bun:test';
import { assertMessagingCapabilities, assertMessagingContact, assertMessagingConversation, assertMessagingDirectoryEntry, assertMessagingPage, assertMessagingSupportInbox, assertMessagingSupportQueueItem } from './messaging-response';

const legacy = { enabled: true, directory: 'everyone', canSupport: false,
  maxMessageLength: 20000, maxParticipants: 100, maxUploadBytes: 16 * 1024 * 1024 };

test('history grant metadata admits only a complete positive versioned boundary', () => {
  const page = { items: [], hasMore: false, nextCursor: null };
  expect(() => assertMessagingPage(page, () => {}, 50)).not.toThrow();
  expect(() => assertMessagingPage({ ...page, history: { from: 2, revision: 3, visibility: 'conversation' } }, () => {}, 50)).not.toThrow();
  for (const history of [null, {}, { from: 0, revision: 1, visibility: 'staff' }, { from: 1, revision: 0, visibility: 'staff' }, { from: 1, revision: 2, visibility: 'any' }]) {
    expect(() => assertMessagingPage({ ...page, history }, () => {}, 50)).toThrow('Invalid messaging response.');
  }
});

test('older capability projections remain readable and optional configured integrations are strictly boolean', () => {
  expect(() => assertMessagingCapabilities(legacy)).not.toThrow();
  expect(() => assertMessagingCapabilities({ ...legacy, assistant: true, notifications: false })).not.toThrow();
  for (const key of ['assistant', 'notifications', 'portal', 'supportInboxes']) for (const value of ['true', 1, null, {}]) {
    expect(() => assertMessagingCapabilities({ ...legacy, [key]: value })).toThrow('Invalid messaging response.');
  }
});

test('portal capabilities and inbox descriptors are coherent, bounded optional additions rather than authority claims', () => {
  expect(() => assertMessagingCapabilities({ ...legacy, portal: true, support: true, supportInboxes: true })).not.toThrow();
  for (const fields of [{ portal: true }, { portal: true, support: false }, { portal: true, support: true, canSupport: true }, { supportInboxes: true }]) {
    expect(() => assertMessagingCapabilities({ ...legacy, ...fields })).toThrow('Invalid messaging response.');
  }
  const inbox = { id: 'billing', title: 'Billing', canOpen: true, canHandle: false, assistant: false, default: true };
  expect(() => assertMessagingSupportInbox(inbox)).not.toThrow();
  expect(() => assertMessagingSupportQueueItem({ id: 'request', ownerEpoch: 1, createdAt: 1, owner: 'triage', inboxId: inbox.id })).not.toThrow();
  for (const change of [{ id: '__proto__' }, { title: 'x'.repeat(121) }, { canOpen: false }, { assistant: 'yes' }, { default: null }]) {
    expect(() => assertMessagingSupportInbox({ ...inbox, ...change })).toThrow('Invalid messaging response.');
  }
});

test('optional participant/contact display validates avatar URLs even without a supplied name', () => {
  const contact = { id: 'contact', userId: 'peer', direction: 'incoming', state: 'pending', revision: 1, updatedAt: 1 };
  const conversation = { id: 'conversation', kind: 'direct', title: '', revision: 1, createdAt: 1, updatedAt: 1, archived: false, owner: 'human', ownerId: null,
    ownerEpoch: 1, unreadCount: 0, participants: [], lastMessage: null };
  const member = { id: 'peer', kind: 'user', role: 'member', joinedAt: 1 };
  expect(() => assertMessagingContact({ ...contact, avatarUrl: '/published/avatar' })).not.toThrow();
  expect(() => assertMessagingConversation({ ...conversation, participants: [{ ...member, name: 'Peer', avatarUrl: null }] })).not.toThrow();
  for (const display of [{ avatarUrl: 'javascript:alert(1)' }, { avatarUrl: 'data:text/html,synthetic' }, { name: null }, { name: 'x'.repeat(242) }]) {
    expect(() => assertMessagingContact({ ...contact, ...display })).toThrow('Invalid messaging response.');
    expect(() => assertMessagingConversation({ ...conversation, participants: [{ ...member, ...display }] })).toThrow('Invalid messaging response.');
  }
});

test('private photo metadata is revisioned and exact-path validated on every admitted identity shape', () => {
  const id = 'ava_11111111-1111-4111-8111-111111111111';
  const asset = { id, width: 64, height: 64, byteLength: 12, mimeType: 'image/webp', deliveryPath: `/auth/profile/avatar/assets/${id}` };
  const contact = { id: 'contact', userId: 'peer', direction: 'incoming', state: 'accepted', revision: 1, updatedAt: 1 };
  const conversation = { id: 'conversation', kind: 'direct', title: '', revision: 1, createdAt: 1, updatedAt: 1, archived: false, owner: 'human', ownerId: null,
    ownerEpoch: 1, unreadCount: 0, lastMessage: null };
  const member = { id: 'peer', kind: 'user', role: 'member', joinedAt: 1 };
  const validators = [
    (privateAvatar: unknown) => assertMessagingDirectoryEntry({ id: 'peer', name: 'Peer', avatarUrl: null, privateAvatar }),
    (privateAvatar: unknown) => assertMessagingContact({ ...contact, privateAvatar }),
    (privateAvatar: unknown) => assertMessagingConversation({ ...conversation, participants: [{ ...member, privateAvatar }] }),
  ];
  for (const validate of validators) {
    for (const value of [undefined, null, { revision: 1, asset }, { revision: 2, asset: null }]) expect(() => validate(value)).not.toThrow();
    for (const value of [{ revision: 0, asset }, { revision: 1.1, asset }, { revision: Number.MAX_SAFE_INTEGER, asset }, { revision: 1 },
      { revision: 1, asset, providerUrl: 'https://synthetic.invalid/private' }, { revision: 1, asset: { ...asset, deliveryPath: '//synthetic.invalid/image' } },
      { revision: 1, asset: { ...asset, deliveryPath: '/auth/profile/avatar/assets/another' } }]) expect(() => validate(value)).toThrow('Invalid messaging response.');
  }
});
