import { expect, test } from 'bun:test';
import type { AuthContext } from '../auth/types';
import { LoggingAdmission } from './logging-admission';
import { loggingContext } from './test-support/logging-fixture';
import type { LoggingEvent } from './logging-contracts';

function fixture(required = true) {
  let now = 0, valid = true;
  const events: LoggingEvent[] = [], auth = { userId: 'fixture-user', sessionId: 'fixture-session', role: 'user', email: 'fixture@example.test', sessionKind: 'web', sessionScopeKind: 'tenant', tenantId: 'tenant-a' } as AuthContext;
  const authority = { auth }, context = loggingContext();
  const admission = new LoggingAdmission(required, context.policyVersion, async event => { events.push(event); return { id: event.id, sourceId: event.sourceId, ordinal: events.length, duplicate: false }; }, () => now);
  const revalidate = async () => { if (!valid) throw new Error('Revoked'); };
  return { admission, authority, context, events, revalidate, advance(ms: number) { now += ms; }, revoke() { valid = false; } };
}

test('strict delivery grants require a durable commit and bind session, scope, policy and current authority', async () => {
  const f = fixture();
  expect(() => f.admission.assertCurrent(f.authority)).toThrow(expect.objectContaining({ code: 'LOGGING_ADMISSION_REQUIRED' }));
  const receipt = await f.admission.acknowledge(f.authority, f.context, f.context.policyVersion, f.revalidate);
  expect(receipt.expiresAt).toBeGreaterThan(Date.now());
  expect(() => f.admission.assertCurrent(f.authority)).not.toThrow();
  for (const patch of [{ sessionId: 'other' }, { tenantId: 'tenant-b' }, { role: 'admin' }, { sessionGeneration: 2 }]) {
    expect(() => f.admission.assertCurrent({ auth: { ...f.authority.auth, ...patch } })).toThrow();
  }
  await expect(f.admission.acknowledge(f.authority, f.context, 'old-policy', f.revalidate)).rejects.toThrow();
  f.advance(60000); expect(() => f.admission.assertCurrent(f.authority)).toThrow();
  await f.admission.acknowledge(f.authority, f.context, f.context.policyVersion, f.revalidate);
  expect(f.events.map(e => e.action)).toEqual(['logging.delivery.acknowledged', 'logging.delivery.interrupted', 'logging.delivery.recovered']);
  f.admission.close(); expect(() => f.admission.assertCurrent(f.authority)).toThrow();
});

test('failed delivery and revoked or interrupted acknowledgments never create grants; optional levels do not gate', async () => {
  const f = fixture(); f.revoke();
  await expect(f.admission.acknowledge(f.authority, f.context, f.context.policyVersion, f.revalidate)).rejects.toThrow('Revoked');
  expect(f.events).toEqual([]); expect(() => f.admission.assertCurrent(f.authority)).toThrow();
  const g = fixture(false); expect(() => g.admission.assertCurrent(g.authority)).not.toThrow();
  const failure = new LoggingAdmission(true, f.context.policyVersion, async () => { throw new Error('Unavailable'); });
  await expect(failure.acknowledge(f.authority, f.context, f.context.policyVersion, async () => {})).rejects.toThrow('Unavailable');
  expect(() => failure.assertCurrent(f.authority)).toThrow();
});

test('simultaneous handshakes coalesce, recheck revocation after commit, and do not survive shutdown', async () => {
  const f = fixture(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const admission = new LoggingAdmission(true, f.context.policyVersion, async e => { await gate; return { id: e.id, sourceId: e.sourceId, ordinal: 1, duplicate: false }; });
  const first = admission.acknowledge(f.authority, f.context, f.context.policyVersion, f.revalidate);
  expect(admission.acknowledge(f.authority, f.context, f.context.policyVersion, f.revalidate)).toBe(first);
  f.revoke(); release(); await expect(first).rejects.toThrow('Revoked'); expect(() => admission.assertCurrent(f.authority)).toThrow();
  const g = fixture(), pending = admission.acknowledge(g.authority, g.context, g.context.policyVersion, g.revalidate);
  admission.close(); await expect(pending).rejects.toThrow();
});

test('sink failure invalidates machine grants and cannot mint late web or machine grants', async () => {
  const f = fixture(), machine = { auth: { ...f.authority.auth, credentialKind: 'api-key' as const } }, owner = {};
  await f.admission.admitMachine(machine, f.context, f.revalidate, owner);
  expect(() => f.admission.assertCurrent(machine, owner)).not.toThrow();
  f.admission.invalidate(); expect(() => f.admission.assertCurrent(machine, owner)).toThrow();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const admission = new LoggingAdmission(true, f.context.policyVersion, async e => { await held; return { id: e.id, sourceId: e.sourceId, ordinal: 1, duplicate: false }; });
  const web = admission.acknowledge(f.authority, f.context, f.context.policyVersion, f.revalidate);
  const native = admission.admitMachine(machine, f.context, f.revalidate, owner);
  const settled = Promise.allSettled([web, native]);
  // Let both requests enter their durable write before invalidating the sink generation.
  await Promise.resolve(); await Promise.resolve(); admission.invalidate(); release();
  for (const result of await settled) expect(result).toMatchObject({ status: 'rejected', reason: { code: 'LOGGING_ADMISSION_REQUIRED' } });
  expect(() => admission.assertCurrent(f.authority)).toThrow();
  expect(() => admission.assertCurrent(machine, owner)).toThrow();
});

test('worker/custody unavailability blocks current release and grant creation, without gating optional capture', async () => {
  const f = fixture(); let ready = true;
  const writer = async (event: LoggingEvent) => ({ id: event.id, sourceId: event.sourceId, ordinal: 1, duplicate: false });
  const admission = new LoggingAdmission(true, f.context.policyVersion, writer, () => 0, 60000, 10, () => ready);
  await admission.acknowledge(f.authority, f.context, f.context.policyVersion, f.revalidate);
  expect(() => admission.assertCurrent(f.authority)).not.toThrow();
  ready = false; expect(() => admission.assertCurrent(f.authority)).toThrow();
  await expect(admission.acknowledge(f.authority, f.context, f.context.policyVersion, f.revalidate)).rejects.toThrow();
  const optional = new LoggingAdmission(false, f.context.policyVersion, writer, () => 0, 60000, 10, () => ready);
  expect(() => optional.assertCurrent(f.authority)).not.toThrow();
});
