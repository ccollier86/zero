/**
 * resend-attachments.integration.test.ts
 * Proves the real Resend HTTP adapter transmits exact PDF bytes and HTML to a loopback-only mock without provider credentials or external delivery.
 */

import { expect, test } from 'bun:test';
import { configureObservability } from '../observability';
import { EmailService, ResendEmailProvider, type EmailMessage } from './index';

test('HTTP JSON keeps PDF byte hash, filename/MIME, HTML/text, idempotency key, and reply-to without private provider metadata', async () => {
  configureObservability({ console: false, store: false });
  let captured: { method: string; path: string; headers: Headers; body: Record<string, unknown> } | null = null;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    captured = { method: request.method, path: new URL(request.url).pathname, headers: request.headers, body: await request.json() };
    return Response.json({ id: 'synthetic-provider-receipt' });
  } });
  try {
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% \u0000\u00ff\n%%EOF');
    const message: EmailMessage = { to: 'patient@example.test', subject: 'Requested letter', text: 'Reviewed synthetic letter',
      html: '<h1>Reviewed synthetic letter</h1><p>Exact approved content.</p>', metadata: { mustNotSend: 'private internal checklist' },
      attachments: [{ filename: 'patient-letter.pdf', content: pdf, contentType: 'application/pdf' }],
      idempotencyKey: 'letter-delivery:synthetic-attempt', signal: new AbortController().signal };
    const service = new EmailService(new ResendEmailProvider({ apiKey: 'fake-loopback-only-key', baseUrl: server.url.origin }),
      { from: 'Clinic <clinic@example.test>', replyTo: 'office@example.test' });
    const result = await service.send(message);
    expect(result).toMatchObject({ id: 'synthetic-provider-receipt', provider: 'resend', accepted: ['patient@example.test'] });
    expect(captured).not.toBeNull(); const request = captured!;
    expect(request.method).toBe('POST'); expect(request.path).toBe('/emails');
    expect(request.headers.get('authorization')).toBe('Bearer fake-loopback-only-key');
    expect(request.headers.get('idempotency-key')).toBe(message.idempotencyKey!);
    expect(request.body).toMatchObject({ from: 'Clinic <clinic@example.test>', to: ['patient@example.test'],
      reply_to: 'office@example.test', subject: message.subject, text: message.text, html: message.html });
    const attachments = request.body.attachments as Array<{ content: string; filename: string; content_type: string }>;
    expect(attachments).toHaveLength(1); expect(attachments[0]!.filename).toBe('patient-letter.pdf');
    expect(attachments[0]!.content_type).toBe('application/pdf');
    const decoded = Buffer.from(attachments[0]!.content, 'base64');
    expect(new Bun.CryptoHasher('sha256').update(decoded).digest('hex')).toBe(new Bun.CryptoHasher('sha256').update(pdf).digest('hex'));
    expect(Object.keys(attachments[0]!).sort()).toEqual(['content', 'content_type', 'filename']);
    expect(request.body).not.toHaveProperty('metadata'); expect(JSON.stringify(request.body)).not.toContain('private internal checklist');
  } finally { await server.stop(true); }
});
