import { expect, test } from 'bun:test';
import PostalMime from 'postal-mime';
import { SmtpEmailProvider } from './smtp-email-provider';
import { createEmailRuntime, isEmailDeliveryReady } from './runtime';
import { smtpFixture, testCertificate, tlsSmtpFixture } from './test-support/smtp-fixture';
import { classifyAuthEmailFailure } from '../auth/auth-email-outbox-failure-classification';
import { isEmailAttachmentDeliveryReady } from './index';

const message = { from: 'Sender <sender@example.test>', to: 'receiver@example.test', subject: 'Synthetic mail', text: 'Test body' };

test('direct and facade SMTP sends preserve exact binary subviews, filenames, MIME types and inline IDs', async () => {
  const local = await smtpFixture();
  const runtime = createEmailRuntime({ provider: 'smtp', smtp: local.config, from: message.from }, {});
  const direct = new SmtpEmailProvider(local.config);
  const bytes = new Uint8Array([0, 1, 10, 13, 127, 128, 254, 255]);
  try {
    expect(isEmailAttachmentDeliveryReady(runtime)).toBe(true);
    expect(direct.supportsAttachments).toBe(true);
    for (const sender of [runtime.service, direct]) {
      const backing = new Uint8Array([77, ...bytes, 88]);
      const content = backing.subarray(1, backing.length - 1);
      const sent = sender.send({ ...message, html: '<p>Inline <img src="cid:synthetic@example.test"></p>',
        attachments: [
          { filename: 'synthetic.pdf', content, contentType: 'application/pdf' },
          { filename: 'synthetic.png', content, contentType: 'image/png', contentId: 'synthetic@example.test' },
        ],
      });
      backing.fill(0);
      expect((await sent).accepted).toEqual(['receiver@example.test']);
      const parsed = await PostalMime.parse(local.messages.at(-1)!);
      expect(parsed.attachments).toHaveLength(2);
      for (const part of parsed.attachments) expect(new Uint8Array(part.content as ArrayBuffer)).toEqual(bytes);
      expect(parsed.attachments.find(part => part.filename === 'synthetic.pdf')).toMatchObject({ mimeType: 'application/pdf' });
      expect(parsed.attachments.find(part => part.filename === 'synthetic.png')).toMatchObject({ mimeType: 'image/png', contentId: '<synthetic@example.test>' });
    }
    expect(local.messages).toHaveLength(2);
  } finally { direct.close(); await runtime.close?.(); await local.close(); }
});

test('invalid SMTP attachments fail before authentication or opening a socket', async () => {
  let connections = 0;
  const local = await smtpFixture({ onConnect(_session, done) { connections++; done(); } });
  const runtime = createEmailRuntime({ provider: 'smtp', smtp: local.config, from: message.from }, {});
  try {
    for (const attachments of [
      [{ filename: '../synthetic.pdf', content: new Uint8Array([1]) }],
      [{ filename: 'synthetic.pdf', content: new Uint8Array([1]), contentType: 'application/pdf\r\nX-Header: test' }],
      [{ filename: 'synthetic.pdf', content: new Uint8Array(25 * 1024 * 1024 + 1) }],
    ]) await expect(runtime.service.send({ ...message, attachments })).rejects.toBeInstanceOf(Error);
    expect(connections).toBe(0); expect(local.messages).toHaveLength(0);
  } finally { await runtime.close?.(); await local.close(); }
});

test('SMTP sends MIME, Unicode, reply-to, attachments and honest accepted/rejected results', async () => {
  const local = await smtpFixture({ onRcptTo(address, _session, callback) {
    callback(address.address.startsWith('rejected@') ? Object.assign(new Error('Synthetic recipient rejection'), { responseCode: 550 }) : null);
  } });
  const runtime = createEmailRuntime({ provider: 'smtp', smtp: local.config, from: message.from, replyTo: 'support@example.test' }, {});
  try {
    expect(isEmailDeliveryReady(runtime)).toBe(true);
    const result = await runtime.service.send({ ...message, to: ['receiver@example.test', 'rejected@example.test'],
      cc: 'copy@example.test', bcc: 'hidden@example.test', subject: 'Hello 🌍', html: '<p>Test body</p>',
      attachments: [{ filename: 'example.txt', content: new TextEncoder().encode('attachment data'), contentType: 'text/plain' }],
      metadata: { secret: 'do-not-send-this' }, tags: { private: 'do-not-send-tags' }, idempotencyKey: 'do-not-send-idempotency-key',
    });
    expect(result.provider).toBe('smtp'); expect(result.id).toBeString();
    expect(result.accepted.sort()).toEqual(['copy@example.test', 'hidden@example.test', 'receiver@example.test']);
    expect(result.rejected).toEqual(['rejected@example.test']);
    expect(local.messages).toHaveLength(1);
    const parsed = await PostalMime.parse(local.messages[0]!);
    expect(parsed.subject).toBe('Hello 🌍'); expect(parsed.replyTo?.[0]?.address).toBe('support@example.test');
    expect(parsed.bcc).toBeUndefined();
    expect(parsed.attachments[0]?.filename).toBe('example.txt');
    expect(new TextDecoder().decode(parsed.attachments[0]!.content as ArrayBuffer)).toBe('attachment data');
    expect(local.messages[0]).not.toContain('do-not-send');
  } finally { await runtime.close?.(); await local.close(); }
});

test('SMTP supports implicit TLS and required STARTTLS with certificate validation', async () => {
  const certificate = await testCertificate();
  try {
    for (const secure of [true, false]) {
      const local = await tlsSmtpFixture(certificate, secure);
      const provider = new SmtpEmailProvider({ ...local.config, secure, requireTLS: true, tls: { ca: certificate.cert.toString(), servername: 'localhost' } });
      try { await provider.verify(); expect((await provider.send(message)).accepted).toEqual(['receiver@example.test']); }
      finally { provider.close(); await local.close(); }
    }
    const local = await tlsSmtpFixture(certificate, true);
    try { await expect(new SmtpEmailProvider({ ...local.config, secure: true }).verify()).rejects.toMatchObject({ code: 'EMAIL_SEND_FAILED' }); }
    finally { await local.close(); }
  } finally { await certificate.close(); }
}, 15_000);

test('SMTP never downgrades required TLS and does not authenticate over an unadvertised upgrade', async () => {
  let authenticationAttempts = 0;
  const local = await smtpFixture({ disabledCommands: ['STARTTLS'], onAuth(_auth, _session, callback) { authenticationAttempts++; callback(null, { user: 'synthetic' }); } });
  try {
    await expect(new SmtpEmailProvider({ ...local.config, requireTLS: true, timeoutMs: 2000 }).send(message)).rejects.toMatchObject({ code: 'EMAIL_PROVIDER_REQUEST_REJECTED' });
    expect(authenticationAttempts).toBe(0); expect(local.messages).toHaveLength(0);
  } finally { await local.close(); }
});

test('SMTP maps permanent and temporary server replies to the correct outbox policy without leaking replies', async () => {
  for (const responseCode of [451, 550]) {
    const local = await smtpFixture({ onMailFrom(_address, _session, callback) {
      callback(Object.assign(new Error('private@example.test secret-provider-response'), { responseCode }));
    } });
    try {
      const error = await new SmtpEmailProvider(local.config).send(message).catch(error => error);
      expect(classifyAuthEmailFailure(error).retryable).toBe(responseCode === 451);
      expect(JSON.stringify({ message: error.message, code: error.code })).not.toContain('private@example.test');
      expect(error.cause).toBeUndefined();
    } finally { await local.close(); }
  }
});

test('SMTP rejects invalid credentials as a terminal failure', async () => {
  const local = await smtpFixture();
  try {
    const error = await new SmtpEmailProvider({ ...local.config, auth: { user: 'user@example.test', pass: 'wrong-test-password' } }).send(message).catch(error => error);
    expect(error).toMatchObject({ code: 'EMAIL_PROVIDER_REQUEST_REJECTED', status: 422 });
    expect(classifyAuthEmailFailure(error).retryable).toBe(false); expect(local.messages).toHaveLength(0);
    expect(String(error)).not.toContain('wrong-test-password');
  } finally { await local.close(); }
});

test('SMTP bounds concurrent sockets and aborts all admitted work on shutdown', async () => {
  const local = await smtpFixture(), provider = new SmtpEmailProvider(local.config);
  try {
    const active = Array.from({ length: 16 }, () => provider.send(message).catch(error => error));
    await expect(provider.verify()).rejects.toMatchObject({ code: 'EMAIL_PROVIDER_BUSY', status: 503 });
    provider.close();
    for (const failure of await Promise.all(active)) expect(failure.code).toBe('EMAIL_DELIVERY_ABORTED');
    expect(local.messages).toHaveLength(0);
  } finally { provider.close(); await local.close(); }
});

test('abort, timeout and provider shutdown retire actual stalled SMTP connections', async () => {
  for (const mode of ['abort', 'timeout', 'close']) {
    let entered!: () => void;
    const atData = new Promise<void>(resolve => { entered = resolve; });
    const local = await smtpFixture({ onData(stream) { stream.resume(); stream.on('end', entered); } });
    const provider = new SmtpEmailProvider({ ...local.config, timeoutMs: mode === 'timeout' ? 500 : 5000 });
    const controller = new AbortController();
    try {
      const sent = provider.send({ ...message, signal: controller.signal });
      const failure = sent.catch(error => error);
      await atData;
      if (mode === 'abort') controller.abort();
      if (mode === 'close') provider.close();
      expect((await failure).code).toBe(mode === 'timeout' ? 'EMAIL_DELIVERY_TIMEOUT' : 'EMAIL_DELIVERY_ABORTED');
      const deadline = performance.now() + 1000;
      while (local.server.connections.size && performance.now() < deadline) await Bun.sleep(5);
      expect(local.server.connections.size).toBe(0);
    } finally { provider.close(); await local.close(); }
  }
}, 15_000);
