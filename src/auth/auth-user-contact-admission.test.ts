import { afterEach, describe, expect, test } from 'bun:test';
import { contactFixture, deliveredContactToken } from './auth-user-contact.test-fixture';
import { MemoryEmailProvider } from '../email/memory-email-provider';
import type { EmailMessage } from '../email/types';
import { captureContactInput } from './auth-user-contact-request';

const fixtures: ReturnType<typeof contactFixture>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0).reverse()) await f.close(); });
const setup = (...args: Parameters<typeof contactFixture>) => { const f = contactFixture(...args); fixtures.push(f); return f; };

describe('contact proof admission and provenance', () => {
  test('an explicit administrator attestation is not a mailbox possession proof and cannot survive address replacement', async () => {
    const f = setup(); const owner = await f.register(); const member = await f.register('contact-member');
    const before = await f.request('GET', '/auth/profile/contacts', undefined, member.accessToken);
    expect(before.body.email.state).toBe('unverified');
    const marked = await f.request('POST', `/auth/admin/users/${member.user.userId}/verify-email`, {}, owner.accessToken);
    expect(marked.status).toBe(200);
    const runtime = f.getRuntime();
    const login = await f.request('POST', '/auth/login', { username: 'contact-member', password: 'password123' });
    expect(login.status).toBe(200); const issued = login.body;
    const attested = await f.request('GET', '/auth/profile/contacts', undefined, issued.accessToken);
    expect(attested.body.email.state).toBe('administratively-attested');
    expect(attested.body.revision).toBe(2);
    runtime.getStore()!.updateUser(member.user.userId, { email: 'replacement@example.test' });
    expect((await f.request('GET', '/auth/profile/contacts', undefined, issued.accessToken)).body.email.state).toBe('unverified');
    expect((await f.request('POST', '/auth/profile/contacts/email/verify', { expectedRevision: 2 }, issued.accessToken)).status).toBe(409);
  });
  test('an expired, revoked-source or replaced-generation link never attaches proof to another current value', async () => {
    for (const reason of ['expired', 'revoked', 'replaced'] as const) {
      const f = setup(); const owner = await f.register(); const runtime = f.getRuntime();
      await f.request('POST', '/auth/profile/contacts/email/verify', { expectedRevision: 1 }, owner.accessToken);
      await runtime.getAuthEmailOutbox()!.processDue(); const token = deliveredContactToken(f.provider);
      if (reason === 'expired') f.db.prepare('UPDATE _auth_contact_challenges SET expires_at = 0').run();
      if (reason === 'revoked') runtime.getStore()!.revokeAllUserTokens(owner.user.userId);
      if (reason === 'replaced') runtime.getStore()!.updateUser(owner.user.userId, { email: 'new-current@example.test' });
      expect((await f.request('POST', '/auth/profile/contacts/email/complete', { token })).status).toBe(400);
      expect(f.db.prepare('SELECT email_proved_at FROM _auth_user_contacts WHERE user_id = ?').get(owner.user.userId)).toEqual({ email_proved_at: null });
    }
  });
  test('lost provider receipt leaves an actually delivered sibling usable after durable retry', async () => {
    class LoseReceipt extends MemoryEmailProvider {
      first = true;
      override async send(message: EmailMessage) {
        const result = await super.send(message);
        if (this.first) { this.first = false; throw new Error('Synthetic accepted delivery with lost response'); }
        return result;
      }
    }
    const provider = new LoseReceipt(); const f = setup({ provider });
    const owner = await f.register(); const runtime = f.getRuntime();
    await f.request('POST', '/auth/profile/contacts/email/verify', { expectedRevision: 1 }, owner.accessToken);
    await runtime.getAuthEmailOutbox()!.processDue(); const first = deliveredContactToken(provider);
    expect(runtime.getAuthEmailOutbox()!.count('pending')).toBe(1);
    f.db.prepare("UPDATE _auth_email_outbox SET available_at = 0 WHERE status = 'pending'").run();
    await runtime.getAuthEmailOutbox()!.processDue(); const second = deliveredContactToken(provider);
    expect(second).not.toBe(first); expect(runtime.getAuthEmailOutbox()!.count('delivered')).toBe(1);
    expect((await f.request('POST', '/auth/profile/contacts/email/complete', { token: first })).status).toBe(200);
    expect((await f.request('POST', '/auth/profile/contacts/email/complete', { token: second })).status).toBe(400);
    const events = f.events.query({ code: 'auth.user_contact.delivered' }).events;
    expect(events).toHaveLength(1);
    expect(JSON.stringify(f.events.query({}).events)).not.toContain(first);
    expect(JSON.stringify(f.events.query({}).events)).not.toContain('Synthetic accepted delivery');
  });
  test('cancellation preserves the old login and makes already delivered links unusable', async () => {
    const f = setup(); const owner = await f.register(); const runtime = f.getRuntime();
    const pending = await f.request('POST', '/auth/profile/contacts/email/change', { expectedRevision: 1,
      email: 'discarded@example.test', currentPassword: 'password123' }, owner.accessToken);
    await runtime.getAuthEmailOutbox()!.processDue(); const token = deliveredContactToken(f.provider);
    const cancelled = await f.request('DELETE', '/auth/profile/contacts/challenge', {
      expectedRevision: 2, challengeId: pending.body.email.challengeId }, owner.accessToken);
    expect(cancelled.status).toBe(200); expect(cancelled.body.email.pendingValue).toBeNull();
    expect((await f.request('POST', '/auth/profile/contacts/email/complete', { token })).status).toBe(400);
    expect(runtime.getStore()!.getUserById(owner.user.userId)?.email).toBe(owner.user.email);
    expect(await runtime.getTokenService()!.resolveAuthContext(owner.accessToken)).not.toBeNull();
  });
  test('disabled delivery cannot leave a pending challenge, and unknown fields/accessors never reach the store', async () => {
    const f = setup({ emailEnabled: false }); const owner = await f.register();
    const unavailable = await f.request('POST', '/auth/profile/contacts/email/verify', { expectedRevision: 1 }, owner.accessToken);
    expect(unavailable.status).toBe(503);
    expect(f.db.prepare('SELECT count(*) AS count FROM _auth_contact_challenges').get()).toEqual({ count: 0 });
    expect((await f.request('GET', '/auth/profile/contacts', undefined, owner.accessToken)).body.revision).toBe(1);
    let invoked = false;
    const object = Object.defineProperty({}, 'expectedRevision', { enumerable: true, get() { invoked = true; return 1; } });
    expect(() => captureContactInput(object, ['expectedRevision'])).toThrow(); expect(invoked).toBe(false);
    expect(() => captureContactInput({ expectedRevision: 1, userId: 'other' }, ['expectedRevision'])).toThrow();
    const auth = await f.getRuntime().getTokenService()!.resolveAuthContext(owner.accessToken);
    expect(() => f.getRuntime().getUserContactService()!.read({ ...auth!, credentialKind: 'api-key' })).toThrow(expect.objectContaining({ code: 'AUTH_CONTACT_SESSION_REQUIRED' }));
  });
});
