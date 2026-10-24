/** Resource fences, stream cleanup, bounded transport and operator recovery for Square. */
import { expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { createReactiveDB } from '@zero/framework/sync';
import { SquarePayments } from './service';
import { authority, squareFixture, squareOptions } from './square-fixture';
import { resolveSquareOptions } from './options';

test('merchant receipt inspection is local even when the provider is unavailable', async () => {
  const f = squareFixture();
  try {
    f.fixture.handle = () => { throw new Error('Provider offline'); };
    expect(await f.service.charges.operations.read('missing-operation')).toBeNull(); expect(f.fixture.requests).toHaveLength(0);
  } finally { await f.close(); }
});
test('a checkout buyer already bound to another Zero account cannot steal the order, invoice, subscription or grants', async () => {
  const f = squareFixture();
  try {
    const alice = f.service.forAuthority(authority('alice')), bob = f.service.forAuthority(authority('bob'));
    const checkout = await alice.checkout.create({ operationId: 'alice-existing-buyer', offer: 'pro' });
    const buyer = await bob.customers.ensure({ operationId: 'bob-customer-binding' }), completed = f.fixture.complete(checkout.id, buyer.id);
    f.fixture.orders.get(completed.orderId).customer_id = buyer.id;
    // Payment may arrive before invoice/subscription events, including a shared buyer directory ID.
    const event = f.fixture.event('payment.updated', completed.paymentId); await f.service.acceptWebhook(event.payload, event.signature); await f.service.drain();
    expect((await alice.entitlements.read()).search).toBe(true); expect((await bob.reconcile()).entitlements).toEqual({});
    for (const [kind, id] of [['payment', completed.paymentId], ['order', completed.orderId], ['invoice', completed.invoiceId!], ['subscription', completed.subId!]]) {
      expect(f.service.resources.get(kind!, id!)?.owner).toEqual({ kind: 'user', id: 'alice' });
    }
    await expect(bob.invoices.read(completed.invoiceId!)).rejects.toMatchObject({ code: 'PAYMENTS_RESOURCE_FORBIDDEN' });
    expect((await bob.payments.list()).items).toEqual([]);
    // A bare provider customer ID, without admitted lineage or explicit trusted adoption, is not ownership proof.
    f.fixture.payments.set('UNPROVEN_PAYMENT', { ...f.fixture.payments.get(completed.paymentId), id: 'UNPROVEN_PAYMENT', order_id: undefined, customer_id: buyer.id });
    expect(await f.service.ownership.payment('UNPROVEN_PAYMENT')).toBeNull();
  } finally { await f.close(); }
});
test('paused Square streams release their database listener immediately on abort and reject revoked authority', async () => {
  const f = squareFixture();
  try {
    let listeners = 0; const original = f.db.onChange.bind(f.db);
    f.db.onChange = callback => { listeners++; const unsubscribe = original(callback); return () => { listeners--; unsubscribe(); }; };
    const abort = new AbortController(), auth = authority(), iterator = f.service.watch(auth, abort.signal)[Symbol.asyncIterator]();
    expect((await iterator.next()).value?.revision).toBe(0); expect(listeners).toBe(1);
    abort.abort(); expect(listeners).toBe(0); await iterator.return?.(); expect(listeners).toBe(0);
    auth.revoke(); await expect(f.service.watch(auth)[Symbol.asyncIterator]().next()).rejects.toBeDefined();
  } finally { await f.close(); }
});
test('only explicit trusted adoption imports existing customer history and its subject is captured before awaits', async () => {
  const f = squareFixture();
  try {
    f.fixture.customers.set('LEGACY_CUSTOMER', { id: 'LEGACY_CUSTOMER', given_name: 'Legacy' });
    f.fixture.payments.set('LEGACY_PAYMENT', { id: 'LEGACY_PAYMENT', customer_id: 'LEGACY_CUSTOMER', location_id: 'LOCATION_FIXTURE', total_money: { amount: 700, currency: 'USD' }, status: 'COMPLETED', created_at: new Date().toISOString() });
    expect(await f.service.ownership.payment('LEGACY_PAYMENT')).toBeNull();
    const subject = { kind: 'user' as const, id: 'legacy-owner' }, pending = f.service.adoptCustomer(subject, 'LEGACY_CUSTOMER'); subject.id = 'different-owner'; await pending;
    expect((await f.service.ownership.payment('LEGACY_PAYMENT'))?.owner).toEqual({ kind: 'user', id: 'legacy-owner' });
    await expect(f.service.adoptCustomer({ kind: 'user', id: 'other-owner' }, 'LEGACY_CUSTOMER')).rejects.toMatchObject({ code: 'PAYMENTS_BINDING_CONFLICT' });
  } finally { await f.close(); }
});
test('lifetime history remains pageable without full-history polling or losing current invoice evidence', async () => {
  const f = squareFixture();
  try {
    const scoped = f.service.forAuthority(authority()), checkout = await scoped.checkout.create({ operationId: 'history-checkout', offer: 'pro' }), completed = f.fixture.complete(checkout.id);
    await f.service.ownership.subscription(completed.subId!);
    const subject = { kind: 'user' as const, id: 'user-fixture' };
    f.db.transaction(() => { for (let index = 0; index < 3001; index++) {
      const id = 'HISTORIC_PAYMENT_' + index, created = new Date(100000 + index * 1000).toISOString();
      f.service.resources.bind(subject, 'payment', id, { id, status: 'COMPLETED', totalMoney: { amount: 100, currency: 'USD' }, createdAt: created });
      f.fixture.payments.set(id, { id, status: 'COMPLETED', location_id: 'LOCATION_FIXTURE', total_money: { amount: 100, currency: 'USD' }, created_at: created });
    } });
    const snapshot = await scoped.reconcile(); expect(snapshot.entitlements.search).toBe(true); expect(snapshot.payments[0]?.id).toBe(completed.paymentId);
    expect(f.fixture.requests.filter(value => value.path.startsWith('/v2/payments/HISTORIC_PAYMENT_')).length).toBeLessThanOrEqual(100);
    const first = await scoped.payments.list({ limit: 100 }); expect(first.items).toHaveLength(100); expect(first.next).toBeTruthy();
    const next = await scoped.payments.list({ limit: 100, after: first.next }); expect(next.items).toHaveLength(100); expect(next.items[0]?.id).not.toBe(first.items[0]?.id);
  } finally { await f.close(); }
});
test('resource lease loss before physical transport admission prevents cancellation and remains safely retryable', async () => {
  const f = squareFixture();
  try {
    const scoped = f.service.forAuthority(authority()), checkout = await scoped.checkout.create({ operationId: 'lease-checkout', offer: 'pro' }), completed = f.fixture.complete(checkout.id);
    await f.service.ownership.subscription(completed.subId!);
    f.fixture.handle = request => { if (request.path === '/v2/subscriptions/' + completed.subId) f.db.prepare('UPDATE _zero_payments_locks SET lease=0 WHERE id=?').run('subscription:' + completed.subId); return undefined; };
    const input = { operationId: 'lease-cancel-operation', subscriptionId: completed.subId!, timing: 'period-end' as const };
    await expect(scoped.subscriptions.cancel(input)).rejects.toMatchObject({ code: 'PAYMENTS_LEASE_LOST', retryable: true });
    expect(f.fixture.requests.some(value => value.path.endsWith('/cancel'))).toBe(false);
    f.fixture.handle = undefined; expect((await scoped.subscriptions.cancel(input)).cancelAtPeriodEnd).toBe(true);
  } finally { await f.close(); }
});
test('Square transport deadlines abort unresolved writes without returning a fabricated rejection or success', async () => {
  const f = squareFixture({ timeoutMs: 100 });
  try {
    await f.service.verifyMerchant();
    f.fixture.handle = request => request.path === '/v2/payments' ? new Promise((_resolve, reject) => {
      const fail = () => reject(new Error('Synthetic aborted transport')); request.signal.addEventListener('abort', fail, { once: true }); if (request.signal.aborted) fail();
    }) : undefined;
    await expect(f.service.charges.create({ operationId: 'bounded-charge-operation', total: { amount: 200, currency: 'usd' }, description: 'Bounded charge', paymentToken: 'cnon:card-nonce-ok' })).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    expect(f.fixture.requests.filter(value => value.path === '/v2/payments')).toHaveLength(1);
  } finally { await f.close(); }
});
test('failed merchant callbacks stay durable, can be retried by operators and expose no raw provider/token details', async () => {
  const seen: string[] = []; let fail = true;
  const f = squareFixture({ onMerchantEvent: async event => { seen.push(event.eventId); if (fail) throw new Error('private callback secret'); } });
  try {
    const charge = await f.service.charges.create({ operationId: 'callback-charge-operation', total: { amount: 200, currency: 'usd' }, description: 'Work', paymentToken: 'cnon:card-nonce-ok' });
    const event = f.fixture.event('payment.updated', charge.id); await f.service.acceptWebhook(event.payload, event.signature); await f.service.drain();
    expect(f.service.store.pending().pending).toBe(1); const jobs = f.service.jobs.list();
    expect(JSON.stringify(jobs)).not.toContain('private callback secret'); expect(JSON.stringify(jobs)).not.toContain('cnon:');
    fail = false; expect(f.service.jobs.retry(seen[0]!)).toBe(true); await f.service.drain();
    expect(seen).toEqual([seen[0]!, seen[0]!]); expect(f.service.store.pending().pending).toBe(0);
  } finally { await f.close(); }
});
test('version/merchant mismatches cannot enter the inbox and overlapping signing-key rotation works', async () => {
  const f = squareFixture({ webhookSignatureKeys: ['synthetic-rotated-signature-key', ...squareOptions.webhookSignatureKeys!] });
  try {
    for (const change of [{ merchant_id: 'OTHER_MERCHANT' }, { api_version: '2020-01-01' }]) {
      const payload = JSON.stringify({ ...JSON.parse(f.fixture.event('payment.updated', 'PAYMENT_1').payload), ...change });
      const signature = createHmac('sha256', squareOptions.webhookSignatureKeys![0]!).update(squareOptions.webhookNotificationUrl).update(payload).digest('base64');
      await expect(f.service.acceptWebhook(payload, signature)).rejects.toBeDefined();
    }
    expect(f.service.store.pending().pending).toBe(0); const event = f.fixture.event('payment.updated', 'PAYMENT_1');
    expect((await f.service.acceptWebhook(event.payload, event.signature)).received).toBe(true);
  } finally { await f.close(); }
});
test('invalid configuration, raw external payment records and location currency mismatches fail before financial sends', async () => {
  const db = createReactiveDB({ mode: 'memory', emitTelemetry: false });
  try {
    expect(() => new SquarePayments(db, { ...squareOptions, allowEphemeralTestMode: false })).toThrow('file-backed');
    for (const bad of [{ successUrl: undefined }, { access: null }, { connectionId: 12 }, { catalog: { bad: { ...squareOptions.catalog.pro, features: [] } } }]) {
      expect(() => resolveSquareOptions({ ...squareOptions, ...bad } as never)).toThrow();
    }
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '_zero_payments_%'").all()).toEqual([]);
  } finally { db.dispose(); }
  const f = squareFixture();
  try {
    await expect(f.service.charges.create({ operationId: 'external-not-a-charge', total: { amount: 500, currency: 'usd' }, description: 'Not tokenized', paymentToken: 'EXTERNAL' })).rejects.toBeDefined();
    await expect(f.service.charges.checkout({ operationId: 'wrong-location-currency', total: { amount: 500, currency: 'eur' }, description: 'Wrong currency' })).rejects.toMatchObject({ code: 'PAYMENTS_INPUT_INVALID' });
    expect(f.fixture.requests.filter(value => value.path === '/v2/payments' || value.path === '/v2/online-checkout/payment-links')).toHaveLength(0);
  } finally { await f.close(); }
});
