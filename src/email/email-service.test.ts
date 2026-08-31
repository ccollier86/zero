import { afterEach, describe, expect, test } from 'bun:test';
import { configureObservability } from '../observability';
import { EmailError } from './email-error';
import { EmailService } from './email-service';
import { MemoryEmailProvider } from './memory-email-provider';
import { ResendEmailProvider } from './resend-email-provider';
import {
  configureEmail,
  getEmailRuntime,
  getEmailService,
  isEmailDeliveryReady,
} from './runtime';
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

  test('normalizes custom provider failures without exposing provider details', async () => {
    const service = new EmailService({
      name: 'unsafe-provider',
      async send() {
        throw new Error('Recipient user@example.com was rejected');
      },
    }, { from: 'Zero <noreply@example.com>' });

    const error = await service.send({
      to: 'user@example.com',
      subject: 'Reset',
      text: 'Reset body',
    }).catch((value) => value);

    expect(error).toBeInstanceOf(EmailError);
    expect(error.code).toBe('EMAIL_SEND_FAILED');
    expect(error.message).toBe('Email provider request failed');
    expect(error.message).not.toContain('user@example.com');
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

  test('uses environment sender defaults and reports real delivery readiness', () => {
    const previous = {
      from: Bun.env.EMAIL_FROM,
      replyTo: Bun.env.EMAIL_REPLY_TO,
      apiKey: Bun.env.RESEND_API_KEY,
    };
    Bun.env.EMAIL_FROM = 'Zero Env <noreply@env.test>';
    Bun.env.EMAIL_REPLY_TO = 'support@env.test';
    Bun.env.RESEND_API_KEY = 'test_resend_key';

    try {
      const runtime = configureEmail(true);
      expect(runtime.config).toMatchObject({
        from: 'Zero Env <noreply@env.test>',
        replyTo: 'support@env.test',
      });
      expect(isEmailDeliveryReady(runtime)).toBe(true);
    } finally {
      restoreEnv('EMAIL_FROM', previous.from);
      restoreEnv('EMAIL_REPLY_TO', previous.replyTo);
      restoreEnv('RESEND_API_KEY', previous.apiKey);
    }
  });

  test('does not advertise a provider without the required sender', () => {
    const previous = Bun.env.EMAIL_FROM;
    Bun.env.EMAIL_FROM = '';
    try {
      const runtime = configureEmail({ provider: 'memory' });
      expect(runtime.enabled).toBe(true);
      expect(isEmailDeliveryReady(runtime)).toBe(false);
    } finally {
      restoreEnv('EMAIL_FROM', previous);
    }
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

function restoreEnv(key: 'EMAIL_FROM' | 'EMAIL_REPLY_TO' | 'RESEND_API_KEY', value: string | undefined) {
  if (value === undefined) delete Bun.env[key];
  else Bun.env[key] = value;
}

describe('ResendEmailProvider', () => {
  test('uses stable safe errors for permanent and retryable provider responses', async () => {
    const provider = new ResendEmailProvider({
      apiKey: 'test_key', baseUrl: 'https://resend.test',
    });
    for (const [status, code] of [
      [422, 'EMAIL_PROVIDER_REQUEST_REJECTED'],
      [429, 'EMAIL_SEND_FAILED'],
      [503, 'EMAIL_SEND_FAILED'],
    ] as const) {
      globalThis.fetch = (async () => Response.json(
        { message: 'secret provider response' }, { status }
      )) as unknown as typeof fetch;
      let error: unknown;
      try {
        await provider.send({
          from: 'Zero <noreply@example.com>', to: 'user@example.com',
          subject: 'Reset', text: 'Reset body',
        });
      } catch (value) {
        error = value;
      }
      expect(error).toBeInstanceOf(EmailError);
      if (!(error instanceof EmailError)) throw new Error('Expected EmailError');
      expect(error.code).toBe(code);
      expect(error.status).toBe(status);
      expect(error.message).toBe('Email provider request failed');
      expect(error.message).not.toContain('secret provider response');
    }
  });

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
      idempotencyKey: 'auth-job:1',
    });

    expect(result).toEqual({
      id: 'resend_123',
      provider: 'resend',
      accepted: ['user@example.com'],
    });
    expect(request!.url).toBe('https://resend.test/emails');
    expect(request!.headers.get('authorization')).toBe('Bearer test_key');
    expect(request!.headers.get('idempotency-key')).toBe('auth-job:1');
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
