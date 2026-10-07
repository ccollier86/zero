import { afterEach, describe, expect, test } from 'bun:test';
import { contactFixture } from './auth-user-contact.test-fixture';
import { AuthUserContactService } from './auth-user-contact-service';
import { normalizeAuthUserContacts } from './auth-config-user-contact';
import type { PhoneVerificationAdapter } from './auth-user-contact-types';
import { AuthUserContactAdapterRequests } from './auth-user-contact-adapter';

const fixtures: ReturnType<typeof contactFixture>[] = [];
const extra: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of extra.splice(0).reverse()) await close();
  for (const f of fixtures.splice(0).reverse()) await f.close();
});
function adapter(overrides: Partial<PhoneVerificationAdapter> = {}): PhoneVerificationAdapter {
  return { id: 'synthetic-phone', isReady: () => true,
    start: async ({ challengeId }) => ({ reference: `reference-${challengeId}` }),
    verify: async ({ code }) => code === 'accepted', ...overrides };
}
async function setup(provider = adapter()) {
  const f = contactFixture({ adapter: provider }); fixtures.push(f);
  const owner = await f.register();
  const auth = await f.getRuntime().getTokenService()!.resolveAuthContext(owner.accessToken);
  await f.request('PATCH', '/auth/profile/contacts/phone', { expectedRevision: 1, phone: '+12025550123' }, owner.accessToken);
  return { ...f, owner, auth: auth! };
}
function isolatedService(f: Awaited<ReturnType<typeof setup>>, provider: PhoneVerificationAdapter, deadline = 15_000) {
  const r = f.getRuntime();
  const service = new AuthUserContactService({ db: f.db, users: r.getStore()!, tokens: r.getTokenService()!,
    actions: r.getActionTokenService()!, email: r.getAccountEmailService()!, getOutbox: () => r.getAuthEmailOutbox(),
    config: normalizeAuthUserContacts({ enabled: true, email: { verify: true, change: true },
      phone: { enabled: true, editable: true, verify: true }, resendCooldown: '1s' }),
    adapter: provider, emitCode: (() => undefined) as never }, deadline);
  extra.push(() => service.stop()); return service;
}
describe('phone adapter ceremonies', () => {
  test('accepted proof stays private and replacing or clearing a number retires it', async () => {
    const f = await setup();
    const pending = await f.request('POST', '/auth/profile/contacts/phone/verify', { expectedRevision: 2 }, f.owner.accessToken);
    expect(pending.status).toBe(200); expect(pending.body.phone.state).toBe('pending');
    expect(JSON.stringify(pending.body)).not.toContain('reference-');
    const accepted = await f.request('POST', '/auth/profile/contacts/phone/complete', {
      expectedRevision: 3, challengeId: pending.body.phone.challengeId, code: 'accepted' }, f.owner.accessToken);
    expect(accepted.status).toBe(200); expect(accepted.body.phone.state).toBe('possession-verified');
    expect(accepted.body.revision).toBe(4);
    expect((await f.request('POST', '/auth/profile/contacts/phone/complete', {
      expectedRevision: 4, challengeId: pending.body.phone.challengeId, code: 'accepted' }, f.owner.accessToken)).status).toBe(400);
    const changed = await f.request('PATCH', '/auth/profile/contacts/phone', { expectedRevision: 4, phone: '+442079460018' }, f.owner.accessToken);
    expect(changed.body.phone.state).toBe('unverified'); expect(changed.body.phone.verifiedAt).toBeNull();
    expect(await f.getRuntime().getTokenService()!.resolveAuthContext(f.owner.accessToken)).not.toBeNull();
  });
  test('failed codes are durably counted, exhausted challenges cannot call the adapter again', async () => {
    let checks = 0;
    const f = await setup(adapter({ verify: async () => { checks++; return false; } }));
    const pending = await f.request('POST', '/auth/profile/contacts/phone/verify', { expectedRevision: 2 }, f.owner.accessToken);
    for (let index = 0; index < 5; index++) {
      expect((await f.request('POST', '/auth/profile/contacts/phone/complete', {
        expectedRevision: 3, challengeId: pending.body.phone.challengeId, code: 'bad' }, f.owner.accessToken)).status).toBe(422);
    }
    expect(checks).toBe(5);
    const retained = f.db.prepare('SELECT attempts,status,adapter_reference FROM _auth_contact_challenges WHERE challenge_id = ?')
      .get(pending.body.phone.challengeId);
    expect(retained).toMatchObject({ attempts: 5, status: 'cancelled' });
    expect((await f.request('POST', '/auth/profile/contacts/phone/complete', {
      expectedRevision: 3, challengeId: pending.body.phone.challengeId, code: 'accepted' }, f.owner.accessToken)).status).toBe(400);
    expect(checks).toBe(5);
  });
  test('concurrent verification shares a durable lease and a later revocation cannot publish proof', async () => {
    let resolve!: (value: boolean) => void;
    let entered!: () => void; const enteredPromise = new Promise<void>(done => { entered = done; });
    let checks = 0;
    const f = await setup(adapter({ verify: async () => { checks++; entered(); return await new Promise<boolean>(done => { resolve = done; }); } }));
    const pending = await f.request('POST', '/auth/profile/contacts/phone/verify', { expectedRevision: 2 }, f.owner.accessToken);
    const command = { expectedRevision: 3, challengeId: pending.body.phone.challengeId, code: 'accepted' };
    const first = f.request('POST', '/auth/profile/contacts/phone/complete', command, f.owner.accessToken);
    await enteredPromise;
    expect((await f.request('POST', '/auth/profile/contacts/phone/complete', command, f.owner.accessToken)).status).toBe(429);
    f.getRuntime().getStore()!.revokeAllUserTokens(f.owner.user.userId); resolve(true);
    expect((await first).status).toBe(409); expect(checks).toBe(1);
    expect(f.db.prepare('SELECT phone_proved_at FROM _auth_user_contacts WHERE user_id = ?').get(f.owner.user.userId)).toEqual({ phone_proved_at: null });
  });
  test('ignored abort and rejected provider errors settle safely, with no leaked reference or late proof', async () => {
    const f = await setup();
    let resolve!: (value: { reference: string }) => void;
    const service = isolatedService(f, adapter({ start: async () => await new Promise(done => { resolve = done; }) }), 5);
    await expect(service.requestPhoneVerification(f.auth, { expectedRevision: 2 })).rejects.toMatchObject({ code: 'AUTH_CONTACT_ADAPTER_UNAVAILABLE' });
    resolve({ reference: 'late-private-reference' }); await Promise.resolve(); await Promise.resolve();
    expect(f.db.prepare('SELECT status,adapter_reference FROM _auth_contact_challenges').get()).toMatchObject({ status: 'pending', adapter_reference: null });
    const bounded = new AuthUserContactAdapterRequests(5);
    await expect(bounded.run(async () => await new Promise<boolean>(() => {}))).rejects.toMatchObject({ code: 'AUTH_CONTACT_ADAPTER_UNAVAILABLE' });
  });
  test('restart recovery repeats the same idempotency key after a lost delivery receipt', async () => {
    const keys: string[] = [];
    let lose = true;
    const provider = adapter({ start: async ({ challengeId }) => {
      keys.push(challengeId);
      if (lose) throw new Error('Synthetic lost receipt');
      return { reference: 'retained-private-reference' };
    } });
    const f = await setup(provider);
    const first = isolatedService(f, provider, 10);
    await expect(first.requestPhoneVerification(f.auth, { expectedRevision: 2 })).rejects.toThrow();
    await first.stop(); lose = false;
    f.db.prepare('UPDATE _auth_contact_challenges SET lease_expires_at = 0').run();
    const restarted = isolatedService(f, provider);
    expect(await restarted.processPhoneDeliveries()).toBe(1);
    expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
    expect(f.db.prepare('SELECT status FROM _auth_contact_challenges').get()).toEqual({ status: 'delivered' });
  });
  test('closing runtime aborts an outstanding adapter operation and late acceptance cannot restore state', async () => {
    const f = await setup();
    let resolve!: (value: { reference: string }) => void;
    let entered!: () => void; const entry = new Promise<void>(done => { entered = done; });
    const service = isolatedService(f, adapter({ start: async () => {
      entered(); return await new Promise(done => { resolve = done; });
    } }));
    const request = service.requestPhoneVerification(f.auth, { expectedRevision: 2 });
    await entry; await service.stop();
    await expect(request).rejects.toMatchObject({ code: 'AUTH_CONTACT_ADAPTER_UNAVAILABLE' });
    resolve({ reference: 'never-published' }); await Promise.resolve();
    expect(f.db.prepare('SELECT adapter_reference FROM _auth_contact_challenges').get()).toEqual({ adapter_reference: null });
  });
});
