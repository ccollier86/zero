import { beforeEach, expect, test } from 'bun:test';
import { configureObservability, emitPlatformCode } from '../observability';
import { EmailService } from './email-service';
import { ResendEmailProvider } from './resend-email-provider';
import { createEmailRuntime } from './runtime';
import { ImapMailbox } from './imap-mailbox';
import { smtpFixture } from './test-support/smtp-fixture';
import { imapFixture } from './test-support/imap-fixture';
import type { EmailMessage, EmailProvider } from './types';

const message = { from: 'sender@example.test', to: 'receiver@example.test', subject: 'Synthetic', text: 'Synthetic body' };
beforeEach(() => configureObservability({ console: false, store: false }));

test('accepted SMTP sends can save an IMAP copy without reclassifying a failed copy as failed delivery', async () => {
  const smtp = await smtpFixture(), imap = await imapFixture();
  try {
    for (const folder of ['Sent', 'Missing']) {
      const runtime = createEmailRuntime({ provider: 'smtp', smtp: smtp.config, from: message.from,
        imap: { ...imap.config, sentFolder: folder },
      }, {});
      try {
        const receipt = await runtime.service.send(message);
        expect(receipt.accepted).toEqual(['receiver@example.test']);
        expect(receipt.sentCopy).toBe(folder === 'Sent' ? 'saved' : 'failed');
      } finally { await runtime.close?.(); }
    }
    expect(smtp.messages).toHaveLength(2);
  } finally { await smtp.close(); await imap.close(); }
});

test('sent-copy failure supports frozen provider receipts and never mistakes a vendor id for a Message-ID', async () => {
  let sends = 0; let capturedMessageId: string | undefined = 'not-called';
  const provider: EmailProvider = { name: 'custom', async send() { sends++; return Object.freeze({ id: 'vendor-request-id', provider: 'custom', accepted: [message.to] }); } };
  const mailbox = { async append(_message: EmailMessage, options: { messageId?: string }) { capturedMessageId = options.messageId; throw new Error('synthetic failure'); } } as unknown as ImapMailbox;
  const codes: string[] = [];
  const service = new EmailService(provider, { imap: { sentFolder: 'Sent' } }, definition => { codes.push(definition.code); return emitPlatformCode(definition); }, mailbox);
  const result = await service.send(message);
  expect(result.sentCopy).toBe('failed'); expect(sends).toBe(1);
  expect(capturedMessageId).toBeUndefined(); expect(codes).toContain('email.sent.copy_failed');
});

test('receive-only and synthetic senders never append fake delivered mail', async () => {
  const local = await imapFixture();
  const runtime = createEmailRuntime({ provider: 'noop', from: message.from, imap: { ...local.config, sentFolder: 'Sent' } }, {});
  try {
    expect((await runtime.service.send(message)).sentCopy).toBeUndefined(); expect(local.connections).toBe(0);
  } finally { await runtime.close?.(); await local.close(); }
});

test('message admission rejects header injection and paths; async transports receive owned snapshots', async () => {
  let captured: EmailMessage | undefined;
  const service = new EmailService({ name: 'capture', async send(value) { captured = value; return { provider: 'capture', accepted: [message.to] }; } });
  for (const extra of [{ subject: 'Subject\r\nBcc: attacker@example.test' }, { cc: ['valid@example.test', null] },
    { attachments: [{ filename: 'private', content: { path: '/synthetic/private/file' } }] }]) {
    await expect(service.send({ ...message, ...extra } as EmailMessage)).rejects.toMatchObject({ code: 'EMAIL_MESSAGE_INVALID' });
    expect(captured).toBeUndefined();
  }
  const content = new Uint8Array([1, 2]), to = [message.to];
  const sent = service.send({ ...message, to, attachments: [{ filename: 'data.bin', content }] });
  content[0] = 99; to[0] = 'changed@example.test'; await sent;
  expect(captured!.to).toEqual([message.to]); expect(captured!.attachments![0]!.content[0]).toBe(1);
});

test('Resend preserves attachments, explicit MIME types and inline content IDs', async () => {
  const original = globalThis.fetch; let body: any; let calls = 0;
  globalThis.fetch = (async (_input, init) => { calls++; body = JSON.parse(init!.body as string); return Response.json({ id: 'vendor-id' }); }) as typeof fetch;
  try {
    const provider = new ResendEmailProvider({ apiKey: 'synthetic' });
    const receipt = await provider.send({ ...message, cc: 'copy@example.test', bcc: ['hidden@example.test'],
      inReplyTo: '<original@example.test>', references: ['<original@example.test>'],
      attachments: [{ filename: 'data.txt', content: new TextEncoder().encode('test') }],
    });
    expect(receipt.accepted).toEqual([message.to, 'copy@example.test', 'hidden@example.test']);
    expect(body).toMatchObject({ cc: 'copy@example.test', bcc: ['hidden@example.test'],
      headers: { 'In-Reply-To': '<original@example.test>', References: '<original@example.test>' },
      attachments: [{ filename: 'data.txt', content: 'dGVzdA==' }],
    });
    await provider.send({ ...message, attachments: [{ filename: 'data.txt', content: new Uint8Array(), contentId: 'inline', contentType: 'text/plain' }] });
    expect(body.attachments).toEqual([{ filename: 'data.txt', content: '', content_id: 'inline', content_type: 'text/plain' }]);
    await expect(provider.send({ ...message, attachments: [{ filename: 'data.txt', content: new Uint8Array(), contentId: 'a'.repeat(128) }] })).rejects.toMatchObject({ code: 'EMAIL_PROVIDER_REQUEST_REJECTED' });
    expect(calls).toBe(2);
  } finally { globalThis.fetch = original; }
});

test('a successful HTTP response without a provider receipt remains an uncertain delivery', async () => {
  const original = globalThis.fetch; globalThis.fetch = (async () => Response.json({ unexpected: true })) as unknown as typeof fetch;
  try { await expect(new ResendEmailProvider({ apiKey: 'synthetic' }).send(message)).rejects.toMatchObject({ code: 'EMAIL_SEND_FAILED' }); }
  finally { globalThis.fetch = original; }
});
