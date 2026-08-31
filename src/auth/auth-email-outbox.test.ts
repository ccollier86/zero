import { afterEach, describe, expect, test } from 'bun:test';
import { configureEmail, MemoryEmailProvider, type EmailMessage,
  type EmailProvider } from '../email';
import { activeTokens, emailToken, fixture, terminalRecipient, user } from './auth-email-outbox-test-support';

afterEach(() => configureEmail(false));

describe('AuthEmailOutbox delivery', () => {
  test('defers lookup, token creation, and provider work until the worker runs', async () => {
    const provider = new MemoryEmailProvider();
    const runtime = fixture(provider);
    try {
      await runtime.users.createUser(user('person@test.com'));
      runtime.outbox.start(false);
      runtime.outbox.enqueue({ kind: 'password_reset', recipient: 'person@test.com' });
      expect(provider.messages).toHaveLength(0);
      expect(activeTokens(runtime.db)).toBe(0);
      expect(await runtime.outbox.processDue()).toBe(1);
      expect(provider.messages).toHaveLength(1);
      expect(provider.messages[0]!.message.idempotencyKey).toMatch(/^aem_.+:1$/);
      expect(runtime.outbox.count('delivered')).toBe(1);
      expect(activeTokens(runtime.db)).toBe(1);
      expect(terminalRecipient(runtime.db, 'delivered')).toBe('');
    } finally { await runtime.outbox.stop(); runtime.db.dispose(); }
  });

  test('uses at-least-once retry with a fresh token after an ambiguous failure', async () => {
    let attempts = 0;
    const attemptedMessages: EmailMessage[] = [];
    const provider: EmailProvider = { name: 'fail-once', async send(message) {
      attempts += 1; attemptedMessages.push(message);
      if (attempts === 1) throw new Error('private provider detail');
      return { provider: this.name,
        accepted: Array.isArray(message.to) ? message.to : [message.to] };
    } };
    let now = 100;
    const runtime = fixture(provider, () => now);
    try {
      await runtime.users.createUser(user('retry@test.com'));
      runtime.outbox.start(false);
      runtime.outbox.enqueue({ kind: 'password_reset', recipient: 'retry@test.com' });
      expect(await runtime.outbox.processDue()).toBe(1);
      expect(activeTokens(runtime.db)).toBe(0);
      const firstToken = emailToken(attemptedMessages[0]!);
      expect(() => runtime.tokens.inspect(firstToken)).toThrow();
      now = 10_000;
      expect(await runtime.outbox.processDue()).toBe(1);
      const secondToken = emailToken(attemptedMessages[1]!);
      expect(secondToken).not.toBe(firstToken);
      expect(runtime.tokens.inspect(secondToken).user.email).toBe('retry@test.com');
      expect(attemptedMessages.map((message) => message.idempotencyKey)).toEqual([
        expect.stringMatching(/:1$/), expect.stringMatching(/:2$/),
      ]);
    } finally { await runtime.outbox.stop(); runtime.db.dispose(); }
  });

  test('lease recovery is not suppressed by a token left before a crash', async () => {
    const provider = new MemoryEmailProvider();
    const runtime = fixture(provider);
    try {
      const created = await runtime.users.createUser(user('recovery@test.com'));
      runtime.tokens.create({ userId: created.userId, type: 'password_reset' });
      runtime.outbox.start(false);
      runtime.outbox.enqueue({ kind: 'password_reset', recipient: 'recovery@test.com' });
      runtime.db.prepare(`UPDATE _auth_email_outbox SET attempts = 1
        WHERE recipient <> ''`).run();
      expect(await runtime.outbox.processDue()).toBe(1);
      expect(provider.messages).toHaveLength(1);
      expect(runtime.outbox.count('delivered')).toBe(1);
      expect(activeTokens(runtime.db)).toBe(2);
    } finally { await runtime.outbox.stop(); runtime.db.dispose(); }
  });

  test('privately suppresses queued work when its policy is later disabled', async () => {
    const provider = new MemoryEmailProvider();
    const runtime = fixture(provider);
    try {
      await runtime.users.createUser(user('disabled@test.com'));
      runtime.config.accountEmails.passwordReset = false;
      runtime.outbox.start(false);
      runtime.outbox.enqueue({ kind: 'password_reset', recipient: 'disabled@test.com' });
      expect(await runtime.outbox.processDue()).toBe(1);
      expect(provider.messages).toHaveLength(0);
      expect(runtime.outbox.count('suppressed')).toBe(1);
      expect(activeTokens(runtime.db)).toBe(0);
    } finally { await runtime.outbox.stop(); runtime.db.dispose(); }
  });
});
