/** Real isolated Guardian shutdown fences for retained feature handles and late trusted-adapter responses; no external provider or app data. */
import { expect, test } from 'bun:test';
import { contactFixture } from './auth-user-contact.test-fixture';
import type { AuthContext } from './types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

test('profile and contact handles retire before held worker drain and remain typed unavailable after stop', async () => {
  const fixture = contactFixture();
  const drain = deferred<void>();
  try {
    const registered = await fixture.register();
    const runtime = fixture.getRuntime();
    const profiles = runtime.getUserProfileService()!;
    const contacts = runtime.getUserContactService()!;
    const auth = await runtime.getTokenService()!.resolveAuthContext(registered.accessToken) as AuthContext;
    expect(profiles.update(auth, { expectedRevision: 1, changes: { firstName: 'Before shutdown' } }).revision).toBe(2);
    expect(contacts.setPhone(auth, { expectedRevision: 1, phone: '+12025550123' }).revision).toBe(2);
    const outbox = runtime.getAuthEmailOutbox()!;
    const stopOutbox = outbox.stop.bind(outbox);
    outbox.stop = async () => { await drain.promise; await stopOutbox(); };
    const stopping = runtime.stop();
    for (const operation of [() => profiles.read(auth),
      () => profiles.update(auth, { expectedRevision: 2, changes: { firstName: 'Forbidden during drain' } })]) {
      expect(operation).toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_NOT_READY', status: 503 }));
    }
    for (const operation of [() => contacts.read(auth),
      () => contacts.setPhone(auth, { expectedRevision: 2, phone: '+12025550124' })]) {
      expect(operation).toThrow(expect.objectContaining({ code: 'AUTH_CONTACT_NOT_READY', status: 503 }));
    }
    expect(profiles.capabilities().state).toBe('blocked');
    expect(contacts.capabilities().state).toBe('blocked');
    expect(profiles.capabilities().fields.firstName.editable).toBe(false);
    expect(contacts.capabilities().phone.editable).toBe(false);
    drain.resolve(); await stopping;
    expect(() => profiles.read(auth)).toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_NOT_READY', status: 503 }));
    expect(() => profiles.update(auth, { expectedRevision: 2, changes: { firstName: 'Forbidden after stop' } }))
      .toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_NOT_READY', status: 503 }));
    expect(() => contacts.read(auth)).toThrow(expect.objectContaining({ code: 'AUTH_CONTACT_NOT_READY', status: 503 }));
    expect(() => contacts.setPhone(auth, { expectedRevision: 2, phone: null }))
      .toThrow(expect.objectContaining({ code: 'AUTH_CONTACT_NOT_READY', status: 503 }));
    expect(profiles.capabilities().state).toBe('blocked');
    expect(contacts.capabilities().state).toBe('blocked');
    expect(fixture.db.prepare('SELECT first_name,profile_revision FROM users WHERE user_id=?').get(auth.userId))
      .toEqual({ first_name: 'Before shutdown', profile_revision: 2 });
    expect(fixture.db.prepare('SELECT phone,revision FROM _auth_user_contacts WHERE user_id=?').get(auth.userId))
      .toEqual({ phone: '+12025550123', revision: 2 });
  } finally { drain.resolve(); await fixture.close(); }
});

test('shutdown cancels an admitted verification before other worker drain; an adapter ignoring abort cannot commit late proof', async () => {
  const verification = deferred<boolean>();
  const entered = deferred<AbortSignal>();
  const drain = deferred<void>();
  const fixture = contactFixture({ adapter: { id: 'synthetic-disposal-adapter', isReady: () => true,
    async start() { return { reference: 'synthetic-private-reference' }; },
    verify(input) { entered.resolve(input.signal); return verification.promise; },
  } });
  try {
    const registered = await fixture.register();
    const runtime = fixture.getRuntime();
    const contacts = runtime.getUserContactService()!;
    const auth = await runtime.getTokenService()!.resolveAuthContext(registered.accessToken) as AuthContext;
    contacts.setPhone(auth, { expectedRevision: 1, phone: '+12025550123' });
    const challenge = await contacts.requestPhoneVerification(auth, { expectedRevision: 2 });
    const pending = contacts.completePhone(auth, { expectedRevision: challenge.revision,
      challengeId: challenge.phone!.challengeId!, code: '123456' });
    const outcome = pending.then(() => null, error => error);
    const signal = await entered.promise;
    const outbox = runtime.getAuthEmailOutbox()!;
    const stopOutbox = outbox.stop.bind(outbox);
    outbox.stop = async () => { await drain.promise; await stopOutbox(); };
    const stopping = runtime.stop();
    expect(signal.aborted).toBe(true);
    expect(await outcome).toEqual(expect.objectContaining({ code: 'AUTH_CONTACT_ADAPTER_UNAVAILABLE', status: 503 }));
    drain.resolve(); await stopping;
    verification.resolve(true);
    await Bun.sleep(5);
    expect(fixture.db.prepare('SELECT revision,phone_proof_generation,phone_proved_at FROM _auth_user_contacts WHERE user_id=?').get(auth.userId))
      .toEqual({ revision: challenge.revision, phone_proof_generation: null, phone_proved_at: null });
    expect(fixture.events.query({ code: 'auth.user_contact.proved' }).events).toHaveLength(0);
  } finally { drain.resolve(); verification.resolve(true); await fixture.close(); }
});

test('retained valid completion handles reject before database access during drain and after the auth graph is cleared', async () => {
  const fixture = contactFixture({ profile: { fields: { firstName: { required: true } },
    completion: { enabled: true } } });
  const drain = deferred<void>();
  let stopping: Promise<void> | null = null;
  try {
    const registered = await fixture.register();
    expect(registered.profileCompletionRequired).toBe(true);
    const runtime = fixture.getRuntime();
    const completion = runtime.getUserProfileCompletionService()!;
    const continuation = registered.profileCompletion.continuation;
    expect(completion.read({ continuation })).toMatchObject({ state: 'ready', missingFields: ['firstName'] });
    const profileBefore = fixture.db.prepare('SELECT first_name,profile_revision FROM users WHERE user_id=?')
      .get(registered.user.userId);
    const command = { continuation, expectedRevision: 1, changes: { firstName: 'Forbidden during shutdown' } };
    const outbox = runtime.getAuthEmailOutbox()!;
    const stopOutbox = outbox.stop.bind(outbox);
    outbox.stop = async () => { await drain.promise; await stopOutbox(); };
    stopping = runtime.stop();
    expect(() => completion.read({ continuation }))
      .toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_COMPLETION_NOT_READY', status: 503 }));
    await expect(completion.complete(command))
      .rejects.toMatchObject({ code: 'AUTH_PROFILE_COMPLETION_NOT_READY', status: 503 });
    drain.resolve(); await stopping;
    expect(runtime.getUserProfileCompletionService()).toBeNull();
    expect(() => completion.read({ continuation }))
      .toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_COMPLETION_NOT_READY', status: 503 }));
    await expect(completion.complete(command))
      .rejects.toMatchObject({ code: 'AUTH_PROFILE_COMPLETION_NOT_READY', status: 503 });
    // SYSTEM remains open here: retirement, not a disposed SQLite handle, is
    // responsible for the stable typed failure and untouched proof/profile.
    expect(fixture.db.prepare('SELECT first_name,profile_revision FROM users WHERE user_id=?')
      .get(registered.user.userId)).toEqual(profileBefore);
    expect(fixture.db.prepare('SELECT consumed_at FROM _auth_profile_completion_continuations').get())
      .toEqual({ consumed_at: null });
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM _refresh_tokens').get()).toEqual({ count: 0 });
  } finally { drain.resolve(); await stopping?.catch(() => {}); await fixture.close(); }
});
