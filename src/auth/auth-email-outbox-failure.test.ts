import { afterEach, describe, expect, test } from 'bun:test';
import { configureEmail, EmailError, type EmailProvider } from '../email';
import { configureObservability, getObservabilityRuntime, MemoryEventStore } from '../observability';
import { activeTokens, fixture, terminalRecipient, user } from './auth-email-outbox-test-support';

afterEach(() => configureEmail(false));

describe('AuthEmailOutbox failure handling', () => {
  test('dead-letters deterministic provider 4xx with a stable safe code', async () => {
    const previousObservability = getObservabilityRuntime().config;
    const events = new MemoryEventStore();
    configureObservability({ console: false, store: events });
    const provider: EmailProvider = { name: 'private-provider', async send() {
      throw new EmailError(
        'provider body named permanent@test.com', 'VENDOR_PRIVATE_CODE', 422
      );
    } };
    const runtime = fixture(provider);
    try {
      await runtime.users.createUser(user('permanent@test.com'));
      runtime.outbox.start(false);
      runtime.outbox.enqueue({ kind: 'password_reset', recipient: 'permanent@test.com' });
      await runtime.outbox.processDue();
      expect(runtime.db.prepare(`SELECT status, attempts, last_error_code, recipient
        FROM _auth_email_outbox`).get()).toEqual({
        status: 'dead', attempts: 1,
        last_error_code: 'EMAIL_PROVIDER_REQUEST_REJECTED', recipient: '',
      });
      expect(activeTokens(runtime.db)).toBe(0);
      const observed = JSON.stringify(events.query({}).events);
      expect(observed).not.toContain('permanent@test.com');
      expect(observed).not.toContain('VENDOR_PRIVATE_CODE');
      expect(observed).not.toContain('provider body');
    } finally {
      await runtime.outbox.stop(); runtime.db.dispose();
      configureObservability(previousObservability);
    }
  });

  test('dead-letters provider rejection without retaining the address in logs', async () => {
    const previousObservability = getObservabilityRuntime().config;
    const events = new MemoryEventStore();
    configureObservability({ console: false, store: events });
    const provider: EmailProvider = { name: 'reject', async send() {
      return { provider: this.name, accepted: [], rejected: ['dead@test.com'] };
    } };
    const runtime = fixture(provider);
    try {
      await runtime.users.createUser(user('dead@test.com'));
      runtime.outbox.start(false);
      runtime.outbox.enqueue({ kind: 'password_reset', recipient: 'dead@test.com' });
      await runtime.outbox.processDue();
      expect(runtime.outbox.count('dead')).toBe(1);
      expect(terminalRecipient(runtime.db, 'dead')).toBe('');
      expect(activeTokens(runtime.db)).toBe(0);
      expect(JSON.stringify(events.query({}).events)).not.toContain('dead@test.com');
    } finally {
      await runtime.outbox.stop(); runtime.db.dispose();
      configureObservability(previousObservability);
    }
  });

  test('shutdown aborts and joins delivery before database ownership is released', async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const provider: EmailProvider = { name: 'stuck-provider', async send() {
      markStarted(); return new Promise<never>(() => undefined);
    } };
    const runtime = fixture(provider);
    try {
      await runtime.users.createUser(user('shutdown@test.com'));
      runtime.outbox.start(false);
      runtime.outbox.enqueue({ kind: 'password_reset', recipient: 'shutdown@test.com' });
      const processing = runtime.outbox.processDue();
      await started;
      await runtime.outbox.stop();
      await processing;
      expect(runtime.outbox.count('processing')).toBe(0);
      expect(runtime.outbox.count('pending')).toBe(1);
      expect(activeTokens(runtime.db)).toBe(0);
      expect(runtime.db.prepare(`SELECT attempts, last_error_code FROM _auth_email_outbox`)
        .get()).toEqual({ attempts: 0, last_error_code: null });
    } finally { runtime.db.dispose(); }
  });
});
