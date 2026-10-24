import { expect, test } from 'bun:test';
import { ReactiveDB } from '@zero/framework/sync';
import { PaymentsError } from './errors';
import { PaymentsStore } from './store';
import { fixtureOptions } from './payments-fixture';
import { StripePayments } from './service';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('command fences, payload conflicts and unknown outcomes retain the same provider key', () => {
  const db = new ReactiveDB({ mode: 'memory', emitTelemetry: false }), store = new PaymentsStore(db, 'test'), subject = { kind: 'user' as const, id: 'one' };
  try {
    const first = store.reserve(subject, 'op', { price: 1 });
    expect(() => store.reserve(subject, 'op', { price: 1 })).toThrow('still running');
    expect(() => store.reserve(subject, 'op', { price: 2 })).toThrow('different payment input');
    store.finish(subject, 'op', first.fence, null, new PaymentsError('Unknown', 'PAYMENTS_OUTCOME_UNKNOWN', 409, 'unknown'));
    const retry = store.reserve(subject, 'op', { price: 1 }); expect(retry.key).toBe(first.key); expect(retry.fence).not.toBe(first.fence);
    expect(() => store.finish(subject, 'op', first.fence, {})).toThrow('lost its commit fence');
    store.finish(subject, 'op', retry.fence, { id: 'paid' }); expect(store.reserve(subject, 'op', { price: 1 }).replay).toEqual({ id: 'paid' });
    const expired = store.reserve(subject, 'old', {}); store.finish(subject, 'old', expired.fence, null, new PaymentsError('Unknown', 'PAYMENTS_OUTCOME_UNKNOWN', 409, 'unknown'));
    db.prepare('UPDATE _zero_payments_commands SET created=0 WHERE id=?').run('old');
    expect(() => store.reserve(subject, 'old', {})).toThrow('safe provider replay window');
  } finally { db.dispose(); }
});
test('customer binding is one-to-one, inbox claims are fenced and terminal payloads are compacted', () => {
  const db = new ReactiveDB({ mode: 'memory', emitTelemetry: false }), store = new PaymentsStore(db, 'test'), a = { kind: 'user' as const, id: 'one' }, b = { kind: 'user' as const, id: 'two' };
  try {
    store.bind(a, 'cus_one'); expect(() => store.bind(a, 'cus_two')).toThrow('already bound'); expect(() => store.bind(b, 'cus_one')).toThrow('different subject');
    store.admit('evt_one', 'webhook', 'sensitive-fixture', 'cus_one'); expect(() => store.admit('evt_one', 'webhook', 'other-body', 'cus_one')).toThrow('conflicts');
    const first = store.claim()!; expect(store.claim()).toBeNull();
    db.prepare('UPDATE _zero_payments_inbox SET lease=0').run(); const second = store.claim()!;
    store.complete(first); expect(store.pending().pending).toBe(1); store.complete(second); expect(store.pending().pending).toBe(0);
    expect(db.prepare('SELECT payload FROM _zero_payments_inbox').get()).toEqual({ payload: '' });
    store.admit('evt_one', 'webhook', 'sensitive-fixture', 'cus_one'); expect(store.pending().pending).toBe(0);
  } finally { db.dispose(); }
});
test('merchant/environment connection identity cannot be switched on an existing ledger', () => {
  const db = new ReactiveDB({ mode: 'memory', emitTelemetry: false });
  try { new PaymentsStore(db, 'same', 'test/acct_one'); expect(() => new PaymentsStore(db, 'same', 'live/acct_one')).toThrow('another merchant/environment'); }
  finally { db.dispose(); }
});
test('live/memory and implicit test/memory persistence are refused', () => {
  const db = new ReactiveDB({ mode: 'memory', emitTelemetry: false });
  try {
    expect(() => new StripePayments(db, { ...fixtureOptions, allowEphemeralTestMode: false })).toThrow('file-backed');
    expect(() => new StripePayments(db, { ...fixtureOptions, mode: 'live', secretKey: 'sk_live_fixture' })).toThrow('only available');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '_zero_payments_%'").all()).toEqual([]);
  } finally { db.dispose(); }
});
test('file mode also requires explicit power-loss durability and startup schema checks are atomic', async () => {
  const root = await mkdtemp(join(tmpdir(), 'payments-durability-'));
  const db = new ReactiveDB({ mode: 'file', path: join(root, 'system.db'), synchronous: 'NORMAL', emitTelemetry: false });
  try {
    expect(() => new StripePayments(db, { ...fixtureOptions, allowEphemeralTestMode: false })).toThrow('synchronous FULL');
    db.exec('CREATE TABLE _zero_payments_schema(version INTEGER NOT NULL)'); db.prepare('INSERT INTO _zero_payments_schema VALUES(99)').run();
    expect(() => new PaymentsStore(db, 'future')).toThrow('migration required');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '_zero_payments_%'").all()).toEqual([{ name: '_zero_payments_schema' }]);
  } finally { db.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('empty worker probes take no SQLite write transaction or authority lease', () => {
  const db = new ReactiveDB({ mode: 'memory', emitTelemetry: false }), store = new PaymentsStore(db, 'test');
  const transaction = db.transaction.bind(db); let writes = 0;
  db.transaction = <T>(fn: () => T): T => { writes++; return transaction(fn); };
  try { expect(store.claim()).toBeNull(); store.queueRefreshes(1000); expect(writes).toBe(0); }
  finally { db.transaction = transaction; db.dispose(); }
});
