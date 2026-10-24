import { expect, test } from 'bun:test';
import { typingIndicatorMembers } from './typing-indicator-model';
import { conversationActivityLabel, conversationActivityMembers } from '../../messaging/activity';

test('typing identity comes from the authenticated envelope, never a payload claim', () => {
  const members = typingIndicatorMembers({ 'user:alice': { userId: 'alice', value: { userId: 'bob', label: 'Displayed name', since: 1000, updatedAt: 1000 } } }, { now: 1000, idleMs: 3500 });
  expect(members[0]?.userId).toBe('alice');
  expect(typingIndicatorMembers({ 'user:bob': { userId: 'alice', value: { updatedAt: 1000 } } }, { now: 1000, idleMs: 3500 })).toEqual([]);
});
test('multiple tabs collapse to one participant and clearing one leaves the other visible', () => {
  const entries = { 'user:alice:session:first-01': { userId: 'alice', value: { label: 'Alice', updatedAt: 1000 } }, 'user:alice:session:second-1': { userId: 'alice', value: { label: 'Alice', updatedAt: 1100 } } };
  expect(typingIndicatorMembers(entries, { now: 1200, idleMs: 3500 })).toMatchObject([{ userId: 'alice', updatedAt: 1100 }]);
  expect(typingIndicatorMembers({ 'user:alice:session:first-01': entries['user:alice:session:first-01'] }, { now: 1200, idleMs: 3500 })).toHaveLength(1);
});
test('idle, self, malformed and future activity are excluded without requiring a database write', () => {
  const entries = Object.fromEntries([['idle', 1], ['self', 10_000], ['future', 1e20], ['bad', Infinity], ['active', 9999]].map(([id, updatedAt]) => [`user:${id}`, { userId: id as string, value: { label: id, updatedAt } }]));
  expect(typingIndicatorMembers(entries, { now: 10_000, idleMs: 3500, actorId: 'self' }).map(item => item.userId)).toEqual(['active']);
  expect(typingIndicatorMembers(entries, { now: 10_000, idleMs: 3500, actorId: 'self', includeSelf: true }).map(item => item.userId)).toEqual(['self', 'active']);
});
test('activity labels distinguish multiple typers, recording, upload and trusted directory labels', () => {
  const a = { userId: 'a', label: 'Alice', since: 1, updatedAt: 1 }, b = { ...a, userId: 'b', label: 'Bob' };
  expect(conversationActivityLabel(conversationActivityMembers([a]))).toBe('Alice is typing…');
  expect(conversationActivityLabel(conversationActivityMembers([a, b]))).toBe('Alice and Bob are typing…');
  expect(conversationActivityLabel(conversationActivityMembers([a, b, { ...a, userId: 'c' }]))).toBe('Alice, Bob and 1 other are typing…');
  expect(conversationActivityLabel(conversationActivityMembers([{ ...a, metadata: { activity: 'recording' } }]), () => 'Verified Alice')).toBe('Verified Alice is recording a voice message.');
  expect(conversationActivityLabel(conversationActivityMembers([{ ...a, metadata: { activity: 'uploading' } }]))).toBe('Alice is uploading a file.');
});
