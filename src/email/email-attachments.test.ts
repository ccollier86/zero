/**
 * email-attachments.test.ts
 * Proves shared file admission, honest capabilities, owned bytes and safe
 * failures without reading real files or sending to an external provider.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { configureObservability, OBS_CODES, type PlatformEvent } from '../observability';
import { ConsoleEmailProvider, EmailError, EmailService, MemoryEmailProvider,
  NoopEmailProvider, ResendEmailProvider, SmtpEmailProvider, createEmailRuntime,
  configureEmail, isEmailAttachmentDeliveryReady, type EmailAttachment,
  type EmailMessage, type EmailProvider } from './index';
import { prepareEmailAttachments } from './email-attachments';
import { resetEmailCompatibilityRuntimeForTesting } from './runtime';

const originalFetch = globalThis.fetch;
const message: EmailMessage = { from: 'sender@example.test', to: 'receiver@example.test',
  subject: 'Synthetic attachment', text: 'Synthetic body' };
const bytes = new Uint8Array([0, 1, 10, 13, 127, 128, 254, 255]);
const file = (): EmailAttachment => ({ filename: 'synthetic.pdf', content: new Uint8Array(bytes), contentType: 'application/pdf' });
const smtpConfig = { host: '127.0.0.1', port: 1, secure: false, requireTLS: false, auth: false as const };

beforeEach(() => configureObservability({ console: false, store: false }));
afterEach(() => { globalThis.fetch = originalFetch; resetEmailCompatibilityRuntimeForTesting(); });

test('unsupported providers reject files before dispatch while plain/empty-list sends remain compatible', async () => {
  let calls = 0;
  const custom: EmailProvider = { name: 'legacy-custom', async send() { calls++; return { provider: 'custom', accepted: [] }; } };
  for (const provider of [custom, new ConsoleEmailProvider(), new NoopEmailProvider()]) {
    await expect(new EmailService(provider).send({ ...message, attachments: [file()] })).rejects.toMatchObject({ code: 'EMAIL_ATTACHMENTS_UNSUPPORTED', status: 400 });
  }
  for (const provider of [new ConsoleEmailProvider(), new NoopEmailProvider()]) {
    await expect(provider.send({ ...message, attachments: [file()] })).rejects.toMatchObject({ code: 'EMAIL_ATTACHMENTS_UNSUPPORTED' });
  }
  expect(calls).toBe(0);
  await new EmailService(custom).send({ ...message, attachments: [] });
  await new EmailService(custom).send(message);
  expect(calls).toBe(2);
});

test('service owns the exact byte view before a capable asynchronous custom provider can observe caller changes', async () => {
  let release!: () => void, captured: EmailMessage | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const provider: EmailProvider = { name: 'capable', supportsAttachments: true,
    async send(input) { await gate; captured = input; return { provider: 'capable', accepted: [] }; } };
  const backing = new Uint8Array([77, ...bytes, 88]);
  const attachment = { ...file(), content: backing.subarray(1, backing.length - 1), contentId: 'inline@example.test' };
  const controller = new AbortController();
  const pending = new EmailService(provider).send({ ...message, attachments: [attachment], signal: controller.signal, idempotencyKey: 'synthetic-attempt-1' });
  backing.fill(0); attachment.filename = 'changed.pdf'; release(); await pending;
  expect(captured!.attachments).toHaveLength(1);
  expect(captured!.attachments![0]).toEqual({ ...file(), contentId: 'inline@example.test' });
  expect(captured!.signal).toBe(controller.signal);
  expect(captured!.idempotencyKey).toBe('synthetic-attempt-1');
});

test('direct memory capture owns attachment containers and bytes but never advertises real delivery', async () => {
  const provider = new MemoryEmailProvider(), attachment = file(), attachments = [attachment];
  await provider.send({ ...message, attachments });
  attachment.content.fill(0); attachment.filename = 'changed.pdf'; attachments.length = 0;
  expect(provider.messages[0]!.message.attachments).toEqual([file()]);
  for (const selected of ['memory', 'console', 'noop', provider] as const) {
    expect(isEmailAttachmentDeliveryReady(createEmailRuntime({ from: message.from, provider: selected }, {}))).toBe(false);
  }
  expect(isEmailAttachmentDeliveryReady(createEmailRuntime(false, {}))).toBe(false);
});

test('readiness requires a sender, explicit capability and captured Resend/SMTP configuration, including custom-object adapters', async () => {
  for (const provider of ['resend', new ResendEmailProvider({ apiKey: 'synthetic' })] as const) {
    expect(isEmailAttachmentDeliveryReady(createEmailRuntime({ from: message.from, provider, resend: { apiKey: 'synthetic' } }, {}))).toBe(true);
  }
  expect(isEmailAttachmentDeliveryReady(createEmailRuntime({ from: message.from, provider: new ResendEmailProvider({ apiKey: '' }) }, {}))).toBe(false);
  expect(isEmailAttachmentDeliveryReady(createEmailRuntime({ from: message.from, provider: 'resend', resend: { apiKey: '' } }, {}))).toBe(false);
  expect(isEmailAttachmentDeliveryReady(createEmailRuntime({ from: '', provider: 'resend', resend: { apiKey: 'synthetic' } }, {}))).toBe(false);
  for (const provider of ['smtp', new SmtpEmailProvider(smtpConfig)] as const) {
    const runtime = createEmailRuntime({ from: message.from, provider, smtp: smtpConfig }, {});
    expect(isEmailAttachmentDeliveryReady(runtime)).toBe(true);
    await runtime.close?.();
    expect(isEmailAttachmentDeliveryReady(runtime)).toBe(false);
  }
  for (const provider of ['smtp', new SmtpEmailProvider({ ...smtpConfig, host: '' })] as const) {
    expect(isEmailAttachmentDeliveryReady(createEmailRuntime({ from: message.from, provider, smtp: { ...smtpConfig, host: '' } }, {}))).toBe(false);
  }
  const send: EmailProvider['send'] = async () => ({ provider: 'custom', accepted: [] });
  for (const supportsAttachments of [undefined, false, true]) {
    expect(isEmailAttachmentDeliveryReady(createEmailRuntime({ from: message.from, provider: { name: 'custom', supportsAttachments, send } }, {}))).toBe(supportsAttachments === true);
  }
  configureEmail({ from: message.from, provider: 'resend', resend: { apiKey: 'synthetic' } });
  expect(isEmailAttachmentDeliveryReady()).toBe(true);
});

test('both direct production providers reject unsafe inputs before external fetch or SMTP connection', async () => {
  let requests = 0;
  globalThis.fetch = (async () => { requests++; return Response.json({ id: 'synthetic' }); }) as unknown as typeof fetch;
  const invalid: unknown[] = [null, {}, [undefined], new Array(1),
    [{ ...file(), filename: '../private.pdf' }], [{ ...file(), filename: 'C:\\private.pdf' }],
    [{ ...file(), filename: '' }], [{ ...file(), filename: '..' }], [{ ...file(), filename: ' x.pdf' }],
    [{ ...file(), filename: 'synthetic\r\nBcc:someone.pdf' }], [{ ...file(), filename: 'synthetic\u202Efdp.pdf' }],
    [{ ...file(), filename: 'x'.repeat(256) }], [{ ...file(), contentType: 'application/pdf\n' }],
    [{ ...file(), contentType: 'application/*' }], [{ ...file(), contentType: 'application/pdf; charset=utf-8' }],
    [{ ...file(), contentId: '' }], [{ ...file(), contentId: 'inline\n' }],
    [{ filename: 'synthetic.pdf', content: 'https://private.example.test/file' }],
    [{ ...file(), path: '/private/synthetic.pdf' }], [{ ...file(), content: new Uint8Array(new SharedArrayBuffer(8)) }],
  ];
  const detached = new Uint8Array(4); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  invalid.push([{ ...file(), content: detached }]);
  for (const provider of [new ResendEmailProvider({ apiKey: 'synthetic' }), new SmtpEmailProvider(smtpConfig)]) {
    for (const attachments of invalid) {
      await expect(provider.send({ ...message, attachments } as EmailMessage)).rejects.toMatchObject({ code: 'EMAIL_ATTACHMENT_INVALID', status: 400 });
    }
  }
  expect(requests).toBe(0);
});

test('count and aggregate raw-byte bounds cannot be bypassed by a shadow byteLength', () => {
  expect(() => prepareEmailAttachments(Array.from({ length: 101 }, file))).toThrow(expect.objectContaining({ code: 'EMAIL_ATTACHMENT_LIMIT_EXCEEDED', status: 413 }));
  const big = new Uint8Array(25 * 1024 * 1024 + 1);
  Object.defineProperty(big, 'byteLength', { value: 0 });
  expect(() => prepareEmailAttachments([{ ...file(), content: big }])).toThrow(expect.objectContaining({ code: 'EMAIL_ATTACHMENT_LIMIT_EXCEEDED' }));
  const first = new Uint8Array(13 * 1024 * 1024);
  expect(() => prepareEmailAttachments([{ ...file(), content: first }, { ...file(), content: first }])).toThrow(expect.objectContaining({ code: 'EMAIL_ATTACHMENT_LIMIT_EXCEEDED' }));
  expect(prepareEmailAttachments(Array.from({ length: 100 }, file))).toHaveLength(100);
  expect(prepareEmailAttachments([{ filename: 'empty.txt', content: new Uint8Array() }])![0]!.content).toHaveLength(0);
});

test('attachment accessors cannot leak even a caller-supplied EmailError or fabricated array length', () => {
  const attachment = { ...file(), get contentType(): string { throw new EmailError('private-synthetic-data', 'PRIVATE_CODE', 500); } };
  for (const input of [[attachment], new Proxy([], { get() { throw new Error('private-synthetic-data'); } }), new Proxy([], { get(target, key) { return key === 'length' ? -1 : Reflect.get(target, key); } })]) {
    let failure: unknown;
    try { prepareEmailAttachments(input); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'EMAIL_ATTACHMENT_INVALID', status: 400 });
    expect(String(failure)).not.toContain('private-synthetic-data');
  }
});

test('provider failure events and errors never contain attachment names, content or recipient details', async () => {
  const events: PlatformEvent[] = [];
  configureObservability({ console: false, store: false, sink: { emit(event) { events.push(event); } } });
  const service = new EmailService({ name: 'capable', supportsAttachments: true,
    async send() { throw new Error('synthetic.pdf receiver@example.test private-synthetic-data'); } });
  const failure = await service.send({ ...message, attachments: [file()] }).catch(error => error);
  expect(failure).toMatchObject({ code: 'EMAIL_SEND_FAILED', status: 502 });
  expect(events.map(event => event.code)).toContain(OBS_CODES.EMAIL_SEND_FAILED.code);
  const output = JSON.stringify(events) + String(failure);
  for (const sensitive of ['synthetic.pdf', 'receiver@example.test', 'private-synthetic-data', Buffer.from(bytes).toString('base64')]) expect(output).not.toContain(sensitive);
});
