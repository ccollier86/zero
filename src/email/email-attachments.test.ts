/**
 * email-attachments.test.ts
 * Exercises bounded owned attachment bytes, explicit provider capabilities, safe errors, and existing message signal/idempotency behavior.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { configureObservability, type PlatformEvent } from '../observability';
import { ConsoleEmailProvider, EmailError, EmailService, MemoryEmailProvider, NoopEmailProvider, ResendEmailProvider,
  configureEmail, isEmailAttachmentDeliveryReady, type EmailAttachment, type EmailMessage, type EmailProvider } from './index';

const originalFetch = globalThis.fetch;
const base: EmailMessage = { from: 'Sender <sender@example.test>', to: 'patient@example.test', subject: 'Clinical letter', text: 'Synthetic letter text', html: '<p>Synthetic letter</p>' };
const bytes = new TextEncoder().encode('%PDF-1.4\nSynthetic attachment\n%%EOF');
const pdf = (): EmailAttachment => ({ filename: 'patient-letter.pdf', content: new Uint8Array(bytes), contentType: 'application/pdf' });
beforeEach(() => { configureObservability({ console: false, store: false }); });
afterEach(() => { globalThis.fetch = originalFetch; configureEmail(false); });

/** Keep assertions on stable safe codes without reflecting caller filenames or bodies through failed expectations. */
async function fails(operation: () => Promise<unknown>, code: string) {
  const error = await operation().catch((cause) => cause);
  expect(error).toBeInstanceOf(EmailError);
  expect((error as EmailError).code).toBe(code);
  return error as EmailError;
}

test('unsupported custom and built-in providers reject attached messages without swallowing files or calling their send boundary', async () => {
  let calls = 0;
  const custom: EmailProvider = { name: 'legacy-custom', async send() { calls++; return { provider: 'legacy-custom', accepted: [] }; } };
  for (const provider of [custom, new ConsoleEmailProvider(), new NoopEmailProvider()]) {
    await fails(() => new EmailService(provider).send({ ...base, attachments: [pdf()] }), 'EMAIL_ATTACHMENTS_UNSUPPORTED');
  }
  for (const provider of [new ConsoleEmailProvider(), new NoopEmailProvider()]) {
    await fails(() => provider.send({ ...base, attachments: [pdf()] }), 'EMAIL_ATTACHMENTS_UNSUPPORTED');
  }
  expect(calls).toBe(0);
  await new EmailService(custom).send({ ...base, attachments: [] });
  expect(calls).toBe(1);
});

test('service snapshots byte views before an asynchronous custom provider can observe caller mutation', async () => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  let received: EmailMessage | undefined;
  const provider: EmailProvider = { name: 'explicit-custom', supportsAttachments: true,
    async send(message) { await wait; received = message; return { provider: 'explicit-custom', accepted: [] }; } };
  const backing = new Uint8Array([99, ...bytes, 88]);
  const attachment = { filename: 'reviewed.pdf', content: backing.subarray(1, backing.length - 1), contentType: 'application/pdf' };
  const controller = new AbortController();
  const pending = new EmailService(provider).send({ ...base, attachments: [attachment], signal: controller.signal, idempotencyKey: 'letter-attempt:1' });
  backing.fill(0); attachment.filename = 'changed.pdf'; release(); await pending;
  expect([...received!.attachments![0]!.content]).toEqual([...bytes]);
  expect(received!.attachments![0]!.filename).toBe('reviewed.pdf');
  expect(received!.signal).toBe(controller.signal); expect(received!.idempotencyKey).toBe('letter-attempt:1');
});

test('memory captures independent attachment bytes and containers but is never positive production delivery readiness', async () => {
  const provider = new MemoryEmailProvider(); const attachment = pdf(); const attachments = [attachment];
  await provider.send({ ...base, attachments });
  attachment.content.fill(0); attachment.filename = 'changed.pdf'; attachments.length = 0;
  expect(provider.messages[0]!.message.attachments).toHaveLength(1);
  expect([...provider.messages[0]!.message.attachments![0]!.content]).toEqual([...bytes]);
  expect(provider.messages[0]!.message.attachments![0]!.filename).toBe('patient-letter.pdf');
  for (const selected of ['memory', 'console', 'noop', provider] as const) {
    expect(isEmailAttachmentDeliveryReady(configureEmail({ from: base.from, provider: selected }))).toBe(false);
  }
  expect(isEmailAttachmentDeliveryReady(configureEmail(false))).toBe(false);
});

test('positive capability requires an explicitly capable real provider and configured sender/Resend credentials', () => {
  expect(isEmailAttachmentDeliveryReady(configureEmail({ from: base.from, provider: 'resend', resend: { apiKey: 'test-only-key' } }))).toBe(true);
  expect(isEmailAttachmentDeliveryReady(configureEmail({ from: base.from, provider: 'resend', resend: { apiKey: '' } }))).toBe(false);
  expect(isEmailAttachmentDeliveryReady(configureEmail({ from: base.from, provider: new ResendEmailProvider({ apiKey: '' }) }))).toBe(false);
  const previous = Bun.env.EMAIL_FROM; Bun.env.EMAIL_FROM = '';
  try { expect(isEmailAttachmentDeliveryReady(configureEmail({ provider: 'resend', resend: { apiKey: 'test-only-key' } }))).toBe(false); }
  finally { if (previous === undefined) delete Bun.env.EMAIL_FROM; else Bun.env.EMAIL_FROM = previous; }
  const send: EmailProvider['send'] = async () => ({ provider: 'custom', accepted: [] });
  expect(isEmailAttachmentDeliveryReady(configureEmail({ from: base.from, provider: { name: 'custom', send } }))).toBe(false);
  expect(isEmailAttachmentDeliveryReady(configureEmail({ from: base.from, provider: { name: 'custom', supportsAttachments: true, send } }))).toBe(true);
});

test('invalid names, MIME types, URL/file inputs, sparse arrays, and shared bytes fail before any Resend fetch', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ id: 'must-not-send' }); }) as unknown as typeof fetch;
  const provider = new ResendEmailProvider({ apiKey: 'test-only-key', baseUrl: 'https://resend.test' });
  const invalid: unknown[] = [
    [{ ...pdf(), filename: '../private.pdf' }], [{ ...pdf(), filename: 'C:\\private.pdf' }], [{ ...pdf(), filename: 'patient\r\nBcc:someone.pdf' }],
    [{ ...pdf(), filename: '' }], [{ ...pdf(), filename: '..' }], [{ ...pdf(), filename: 'patient\u0000.pdf' }], [{ ...pdf(), filename: 'patient\u202Efdp.pdf' }],
    [{ ...pdf(), filename: 'x'.repeat(256) }], [{ ...pdf(), contentType: 'application/pdf\r\nX-Header: value' }],
    [{ ...pdf(), contentType: 'not a MIME type' }], [{ ...pdf(), contentType: 'application/pdf; charset=utf-8' }],
    [{ ...pdf(), contentType: 'application/*' }],
    [{ ...pdf(), contentType: 'application/pdf\n' }],
    [{ filename: 'patient.pdf', content: 'https://private.example.test/patient.pdf' }],
    [{ filename: 'patient.pdf', path: '/private/patient.pdf' }], [{ ...pdf(), path: 'https://private.example.test/patient.pdf' }],
    [{ ...pdf(), content: new ArrayBuffer(2) }], [{ ...pdf(), content: new Uint8Array(0) }],
    [{ ...pdf(), content: new Uint8Array(new SharedArrayBuffer(2)) }], new Array(1), { filename: 'not-array' },
  ];
  for (const attachments of invalid) {
    const error = await fails(() => provider.send({ ...base, attachments } as EmailMessage), 'EMAIL_ATTACHMENT_INVALID');
    expect(error.message).not.toContain('patient.pdf');
  }
  expect(calls).toBe(0);
});

test('count and aggregate raw-byte bounds include a spoofed byteLength and accept the exact permitted boundary', async () => {
  const provider = new MemoryEmailProvider();
  await fails(() => provider.send({ ...base, attachments: Array.from({ length: 11 }, pdf) }), 'EMAIL_ATTACHMENT_LIMIT_EXCEEDED');
  await provider.send({ ...base, attachments: Array.from({ length: 10 }, pdf) });
  const allowed = new Uint8Array(25 * 1024 * 1024);
  await provider.send({ ...base, attachments: [{ filename: 'limit.pdf', content: allowed }] });
  await fails(() => provider.send({ ...base, attachments: [{ filename: 'limit.pdf', content: allowed }, pdf()] }), 'EMAIL_ATTACHMENT_LIMIT_EXCEEDED');
  const spoofed = new Uint8Array(allowed.byteLength + 1); Object.defineProperty(spoofed, 'byteLength', { value: 1 });
  await fails(() => provider.send({ ...base, attachments: [{ filename: 'over-limit.pdf', content: spoofed }] }), 'EMAIL_ATTACHMENT_LIMIT_EXCEEDED');
});

test('provider failures and observability never include filenames, attachment bytes, or recipient/body text', async () => {
  const events: PlatformEvent[] = [];
  configureObservability({ console: false, store: false, sink: { emit(event) { events.push(event); } } });
  const attachment = { ...pdf(), filename: 'Synthetic_Private_Patient.pdf' };
  const service = new EmailService({ name: 'custom', supportsAttachments: true, async send() {
    throw new Error('Synthetic_Private_Patient.pdf patient@example.test Synthetic letter');
  } });
  const error = await fails(() => service.send({ ...base, attachments: [attachment] }), 'EMAIL_SEND_FAILED');
  const output = JSON.stringify(events) + error.message;
  for (const sensitive of [attachment.filename, base.to as string, base.text, Buffer.from(bytes).toString('base64')]) expect(output).not.toContain(sensitive);
});
