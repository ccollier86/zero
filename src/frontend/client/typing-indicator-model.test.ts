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
test('server freshness ignores publisher wall-clock skew and does not renew an old snapshot', () => {
  const entries = { 'user:alice': { userId: 'alice', value: { label: 'Alice', updatedAt: 1, since: 1 },
    freshness: { ageMs: 1000, ttlMs: 5000 }, observedAt: 10_000 } };
  expect(typingIndicatorMembers(entries, { now: 2e12, idleMs: 3500, monotonicNow: 11_000 })).toMatchObject([{ userId: 'alice', updatedAt: 2e12 - 2000 }]);
  expect(typingIndicatorMembers(entries, { now: 1, idleMs: 3500, monotonicNow: 12_500 })).toEqual([]);
  expect(typingIndicatorMembers({ 'user:alice': { ...entries['user:alice'], freshness: { ageMs: 4000, ttlMs: 5000 } } }, { now: 2e12, idleMs: 3500, monotonicNow: 10_000 })).toEqual([]);
});
test('malformed freshness cannot turn an expired or unverified entry into live activity', () => {
  const entry = { userId: 'alice', value: { updatedAt: 10_000 }, observedAt: 20 };
  for (const freshness of [{ ageMs: -1, ttlMs: 5000 }, { ageMs: 0, ttlMs: Infinity }, { ageMs: NaN, ttlMs: 5000 }, { ageMs: 0, ttlMs: 0 }]) {
    expect(typingIndicatorMembers({ 'user:alice': { ...entry, freshness } }, { now: 10_000, idleMs: 3500, monotonicNow: 21 })).toEqual([]);
  }
  expect(typingIndicatorMembers({ 'user:alice': { ...entry, observedAt: undefined, freshness: { ageMs: 0, ttlMs: 5000 } } }, { now: 10_000, idleMs: 3500, monotonicNow: 21 })).toEqual([]);
});
test('custom policy keys retain envelope identity and the caller display key can still exclude self', () => {
  const entries = { 'user:display-key': { userId: 'connection:verified', value: { userId: 'display-key', updatedAt: 1000 } } };
  expect(typingIndicatorMembers(entries, { now: 1000, idleMs: 3500 })).toEqual([]);
  expect(typingIndicatorMembers(entries, { now: 1000, idleMs: 3500, customKeys: true })).toMatchObject([{ userId: 'connection:verified' }]);
  expect(typingIndicatorMembers(entries, { now: 1000, idleMs: 3500, customKeys: true, actorId: 'display-key' })).toEqual([]);
});
