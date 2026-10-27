/** Pure namespace/display tests complement, but do not replace, native authenticated socket qualification. */
import { expect, test } from 'bun:test';
import { messagingTypingLabel, messagingTypingRoom, parseMessagingTypingTopic } from './typing-topic';

test('public and private-note typing cannot alias IDs containing reserved-looking suffixes', () => {
  const first = messagingTypingRoom('conversation:staff');
  const second = messagingTypingRoom('conversation', 'staff');
  expect(first).not.toBe(second);
  expect(parseMessagingTypingTopic('typing:' + first)).toEqual({ conversationId: 'conversation:staff', visibility: 'conversation' });
  expect(parseMessagingTypingTopic('typing:' + second)).toEqual({ conversationId: 'conversation', visibility: 'staff' });
  for (const topic of ['typing:messaging:conversation', 'typing:messaging:conversation:staff:wrong space', 'typing:messaging:private:one', 'typing:messaging:staff:', 'typing:messaging:staff:' + 'x'.repeat(201)]) expect(parseMessagingTypingTopic(topic)).toBeNull();
});

test('legitimate long profile names fit native wire bounds without a private-email fallback or split surrogate pair', () => {
  const profile = { userId: 'user-one', firstName: 'A'.repeat(120), lastName: 'B'.repeat(120), email: 'private@example.test' };
  const privateOnly = { userId: 'user-one', email: 'private@example.test' };
  expect(messagingTypingLabel(profile)).toHaveLength(160);
  expect(messagingTypingLabel(privateOnly)).toBe('user-one');
  expect(messagingTypingLabel(null, 'A'.repeat(159) + '😀')).toBe('A'.repeat(159));
  expect(messagingTypingLabel(null, ' ')).toBe('Someone');
  expect(messagingTypingLabel(profile, ' Display override ')).toBe('Display override');
});
