import { afterEach, describe, expect, test } from 'bun:test';
import { configureObservability } from '../observability';
import { EmailError } from './email-error';
import { EmailService } from './email-service';
import { MemoryEmailProvider } from './memory-email-provider';
import { ResendEmailProvider } from './resend-email-provider';
import { configureEmail, getEmailRuntime, getEmailService } from './runtime';
import type { EmailProvider } from './types';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  configureEmail(false);
});

describe('EmailService', () => {
  test('applies default sender and delegates to provider', async () => {
    configureObservability({ console: false, store: false });
    const provider = new MemoryEmailProvider();
    const service = new EmailService(provider, {
      from: 'Zero <noreply@example.com>',
      replyTo: 'support@example.com',
    });

    const result = await service.send({
      to: 'user@example.com',
      subject: 'Welcome',
      text: 'Hello',
    });

    expect(result.provider).toBe('memory');
    expect(result.accepted).toEqual(['user@example.com']);
    expect(provider.messages[0].message.from).toBe('Zero <noreply@example.com>');
    expect(provider.messages[0].message.replyTo).toBe('support@example.com');
  });

  test('rejects messages without a sender', async () => {
    const service = new EmailService(new MemoryEmailProvider());

    await expect(
      service.send({
        to: 'user@example.com',
        subject: 'No sender',
        text: 'Hello',
      })
    ).rejects.toThrow(EmailError);
  });
});

describe('configureEmail', () => {
  test('defaults to disabled noop provider', () => {
    const runtime = configureEmail(undefined, { name: 'Zero' });

    expect(runtime.enabled).toBe(false);
    expect(runtime.provider.name).toBe('noop');
    expect(runtime.app.name).toBe('Zero');
  });

  test('true enables the Resend provider by default', () => {
    const runtime = configureEmail(true);

    expect(runtime.enabled).toBe(true);
    expect(runtime.provider.name).toBe('resend');
  });

  test('accepts custom provider objects', async () => {
    const provider: EmailProvider = {
      name: 'custom',
      async send(message) {
        return {
          provider: 'custom',
          accepted: Array.isArray(message.to) ? message.to : [message.to],
        };
      },
    };

    const runtime = configureEmail({
      from: 'custom@example.com',
      provider,
    });

    expect(runtime.enabled).toBe(true);
    expect(getEmailRuntime().provider.name).toBe('custom');
    const result = await getEmailService().send({
      to: 'user@example.com',
      subject: 'Custom',
      text: 'Hello',
    });
    expect(result.provider).toBe('custom');
  });
});

describe('ResendEmailProvider', () => {
  test('maps EmailMessage to Resend send-email API', async () => {
    let request: Request | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init);
      return Response.json({ id: 'resend_123' });
    }) as typeof fetch;

    const provider = new ResendEmailProvider({
      apiKey: 'test_key',
      baseUrl: 'https://resend.test',
    });

    const result = await provider.send({
      from: 'Zero <noreply@example.com>',
      to: ['user@example.com'],
      replyTo: 'support@example.com',
      subject: 'Welcome',
      text: 'Hello',
      html: '<p>Hello</p>',
      tags: { system: 'auth' },
    });

    expect(result).toEqual({
      id: 'resend_123',
      provider: 'resend',
      accepted: ['user@example.com'],
    });
    expect(request!.url).toBe('https://resend.test/emails');
    expect(request!.headers.get('authorization')).toBe('Bearer test_key');
    const body = await request!.json();
    expect(body).toMatchObject({
      from: 'Zero <noreply@example.com>',
      to: ['user@example.com'],
      reply_to: 'support@example.com',
      subject: 'Welcome',
      text: 'Hello',
      html: '<p>Hello</p>',
      tags: [{ name: 'system', value: 'auth' }],
    });
  });

  test('requires an API key before sending', async () => {
    const provider = new ResendEmailProvider({ apiKey: '' });

    await expect(
      provider.send({
        from: 'Zero <noreply@example.com>',
        to: 'user@example.com',
        subject: 'Welcome',
        text: 'Hello',
      })
    ).rejects.toThrow(EmailError);
  });
});
