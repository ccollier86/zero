/** Public wire-shape validation only; capabilities are not proof of current authority or worker health. */
import { expect, test } from 'bun:test';
import { assertMessagingCapabilities, assertMessagingContact, assertMessagingConversation, assertMessagingPage } from './messaging-response';

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
  for (const key of ['assistant', 'notifications']) for (const value of ['true', 1, null, {}]) {
    expect(() => assertMessagingCapabilities({ ...legacy, [key]: value })).toThrow('Invalid messaging response.');
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
