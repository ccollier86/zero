import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClientProvider } from '../../frontend/client/client-context';
import type { NativeMessagingAttachmentDisplay, MessagingMessageDisplay } from '../../messaging/presentation';
import type { Client } from '../../frontend/client/sdk';
import { installMinimalHookDom } from '../../frontend/client/test-fixtures/react-hook-dom';
import {
  ConversationTypingIndicator, ConversationAssistantActivity, MessageBubble, NativeMessageBubble,
  MessageDeliveryIndicator, MessagingLayout, MessagingComposer, ConversationList,
  ConversationHeader,
  useConversationTyping,
} from '@zero/framework/messaging';

test('typing is accessible, escapes display labels and never invents an active participant', () => {
  expect(renderToStaticMarkup(createElement(ConversationTypingIndicator, { participants: [] }))).toBe('');
  const output = renderToStaticMarkup(createElement(ConversationTypingIndicator, { participants: [{ userId: 'alice', label: '<script>bad</script>', since: 1, updatedAt: 1, activity: 'typing' }], participantFor: () => ({ id: 'alice', kind: 'user' as const, label: 'Alice' }) }));
  expect(output).toContain('role="status"'); expect(output).toContain('aria-live="polite"'); expect(output).toContain('Alice is typing'); expect(output).not.toContain('<script>');
});
test('conversation typing server-renders safely under the standard provider SSR fallback', () => {
  function Input() {
    const typing = useConversationTyping('room-ssr');
    expect(typing.isTyping).toBe(false); expect(typing.participants).toEqual([]);
    expect(typing.resetError()).toBe(false);
    return createElement(MessagingComposer, { value: '', onChange() {}, onSubmit() {}, onTyping: typing.onTextChange });
  }
  expect(renderToStaticMarkup(createElement(Input))).toContain('aria-label="Message"');
});
test('browser room typing cannot silently opt into an auth-disabled legacy topic', () => {
  const restore = installMinimalHookDom();
  try {
    function Input() { useConversationTyping('room-auth-required'); return null; }
    expect(() => renderToStaticMarkup(createElement(ClientProvider, {
      client: { auth: null } as unknown as Client, children: createElement(Input),
    }))).toThrow('auth-enabled Zero');
  } finally { restore(); }
});
test('human activity, assistant processing and delivery receipts remain distinct', () => {
  const output = renderToStaticMarkup(createElement(ConversationAssistantActivity, { activity: { runId: 'run-fixture', label: 'Assistant', state: 'awaiting-human' } }));
  expect(output).toContain('waiting for a team member'); expect(output).not.toContain('is typing');
  expect(renderToStaticMarkup(createElement(MessageDeliveryIndicator, { state: 'accepted' }))).toContain('Saved by server');
  expect(renderToStaticMarkup(createElement(MessageDeliveryIndicator, { state: 'unknown' }))).toContain('Delivery not confirmed');
});
test('messages escape content and attachment labels and never emit an automatic public file URL', () => {
  const output = renderToStaticMarkup(createElement(MessageBubble, { own: true, message: { id: 'm1', author: { id: 'u1', label: 'Alice', kind: 'user' }, text: '<img src="https://private.invalid">', createdAt: 1, delivery: 'read', attachments: [{ id: 'f1', name: '<invoice>.pdf', sizeBytes: 1024, mimeType: 'application/pdf', storage: { driveId: 'drive-private', path: '/private/file', checksum: 'a' } }] } }));
  expect(output).not.toContain('<img'); expect(output).toContain('&lt;img'); expect(output).not.toContain('href='); expect(output).not.toContain('drive-private'); expect(output).toContain('&lt;invoice&gt;.pdf'); expect(output).toContain('Read');
});
test('native private attachment presentation needs no fabricated Storage drive, path or reusable capability', () => {
  const message: MessagingMessageDisplay<NativeMessagingAttachmentDisplay> = { id: 'native-message', author: { id: 'native-user', kind: 'user', label: 'Member' }, text: '', createdAt: 1,
    attachments: [{ id: 'native-attachment', conversationId: 'native-conversation', name: 'Private note.txt', mimeType: 'text/plain', sizeBytes: 32 }] };
  const output = renderToStaticMarkup(createElement(NativeMessageBubble, { message, onAttachment: file => { void file.conversationId; } }));
  expect(output).toContain('Private note.txt'); expect(output).not.toContain('href='); expect(output).not.toContain('driveId'); expect(output).not.toContain('native-conversation');
});
test('layout composes inside AppShell and composer cannot submit an unfinished upload', () => {
  const output = renderToStaticMarkup(createElement(MessagingLayout, { sidebar: 'Conversation list', header: 'Current conversation', children: 'Transcript', composer: createElement(MessagingComposer, { value: 'Hello', onChange() {}, onSubmit() {}, files: [{ id: 'f1', name: 'file.pdf', state: 'uploading', progress: 42 }] }) }));
  expect(output).toContain('Messaging workspace'); expect(output).toContain('data-slot="scroll-area"'); expect(output).toContain('42%'); expect(output).toContain('disabled="" aria-label="Send message"');
});
test('conversation presence is explicit, list labels escape and unread count does not create read receipts', () => {
  const participant = { id: 'u1', kind: 'user' as const, label: '<Alice>' };
  const output = renderToStaticMarkup(createElement(ConversationList, { conversations: [{ id: 'c1', participant, preview: '<img src=x>', unreadCount: 4 }], onSelect() {} }));
  expect(output).toContain('&lt;Alice&gt;'); expect(output).toContain('&lt;img src=x&gt;'); expect(output).toContain('4 unread messages');
  expect(output).not.toContain('avatar-presence-indicator'); expect(output).not.toContain('Online');
  const header = renderToStaticMarkup(createElement(ConversationHeader, { participant, presence: { label: 'Available', tone: 'success' } }));
  expect(header).toContain('Available'); expect(header).toContain('data-variant="ring"');
});
test('messaging preserves explicit dot/badge variants and carries avatar shape to image and status decoration', () => {
  const participant = { id: 'u1', kind: 'user' as const, label: 'Alice', avatarShape: 'square' as const };
  for (const variant of ['ring', 'dot', 'badge'] as const) {
    const header = renderToStaticMarkup(createElement(ConversationHeader, { participant, presence: { label: 'Busy', tone: 'destructive', variant, icon: createElement('i', { 'data-status-icon': '' }) } }));
    expect(header).toContain(`data-variant="${variant}"`); expect(header).toContain('data-shape="square"');
    expect(header).toContain('--zero-messaging-avatar-radius:var(--zero-avatar-group-square-radius, 0px)');
    expect(header.includes('data-status-icon')).toBe(variant === 'badge');
  }
});
test('message time defaults to hydration-stable UTC and accepts an explicit application formatter', () => {
  const message = { id: 'm', author: { id: 'u', label: 'User', kind: 'user' as const }, text: 'Hello', createdAt: Date.UTC(2026, 9, 24, 13, 5) };
  expect(renderToStaticMarkup(createElement(MessageBubble, { message }))).toContain('13:05 UTC');
  expect(renderToStaticMarkup(createElement(MessageBubble, { message, formatTime: () => 'Application time' }))).toContain('Application time');
});
