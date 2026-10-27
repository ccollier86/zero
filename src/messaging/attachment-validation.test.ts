/** Presentation declarations are closed and bounded; checksums are verified against actual Storage bytes separately. */
import { expect, test } from 'bun:test';
import { captureMessagingAttachment } from './attachment-validation';
import { messagingText } from './validation';
import { captureMessagingActor } from './realm-model';
const input = { fileName: 'Synthetic image.png', mimeType: 'image/png', sizeBytes: 100, checksum: 'a'.repeat(64) };
test('attachments require a safe name, passive declared type, exact bounded length and sha256 declaration', () => {
  expect(captureMessagingAttachment(input, 1024)).toEqual({ ...input, visibility: 'conversation' });
  for (const fileName of ['../private.txt', 'a/b', 'a\\b', 'name\nheader', ' padded ', '.', '..']) expect(() => captureMessagingAttachment({ ...input, fileName }, 1024)).toThrow();
  for (const mimeType of ['text/html', 'image/svg+xml', 'application/javascript', 'image/png\r\nLocation: bad']) expect(() => captureMessagingAttachment({ ...input, mimeType }, 1024)).toThrow();
  for (const sizeBytes of [0, -1, 1.5, NaN, Infinity, 1025]) expect(() => captureMessagingAttachment({ ...input, sizeBytes }, 1024)).toThrow();
  expect(() => captureMessagingAttachment({ ...input, checksum: 'not-a-checksum' }, 1024)).toThrow();
  expect(() => captureMessagingAttachment({ ...input, driveId: 'browser-selected' }, 1024)).toThrow();
  expect(messagingText('Unicode 👋 message')).toBe('Unicode 👋 message');
  expect(() => messagingText('unpaired\ud800')).toThrow();
});
test('canonical worker scope accepts the full native tenant identifier bound, never a browser-selected authority', () => {
  const actor = { scopeId: 'tenant:' + 't'.repeat(256), id: 'synthetic-user', kind: 'user', staff: false };
  expect(captureMessagingActor(actor).scopeId).toBe(actor.scopeId);
  expect(() => captureMessagingActor({ ...actor, scopeId: 'tenant:' + 't'.repeat(257) })).toThrow();
  expect(() => captureMessagingActor({ ...actor, scopeId: 'tenant:bad\nidentity' })).toThrow();
  expect(() => captureMessagingActor({ ...actor, scopeId: 'unscoped' })).toThrow();
});
