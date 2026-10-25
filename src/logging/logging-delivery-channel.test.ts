/** Pure transport admission/fencing tests. No worker or SQLite substitute is used for integration claims. */
import { expect, test } from 'bun:test';
import { LoggingDeliveryChannel } from './logging-delivery-channel';
import { LOGGING_DELIVERY_PROTOCOL, LOGGING_DELIVERY_VERSION, readDeliveryPage, readDeliveryWire, type DeliveryWire } from './logging-delivery-protocol';

const nonce = '00000000-0000-0000-0000-000000000001';
const reply = (id: number, op: string, value: unknown): DeliveryWire => ({ protocol: LOGGING_DELIVERY_PROTOCOL, version: LOGGING_DELIVERY_VERSION, nonce, type: 'reply', id, op, value });

test('delivery channels bound capacity, reject stale generations and mark already dispatched outcomes unknown', async () => {
  const sent: DeliveryWire[] = []; let failures = 0;
  const channel = new LoggingDeliveryChannel(nonce, value => sent.push(value), async () => null, () => {}, () => { failures++; }, 1);
  const first = channel.call('write', { opaque: true });
  await expect(channel.call('write', {})).rejects.toMatchObject({ code: 'LOGGING_BACKPRESSURE', outcome: 'not-admitted' });
  expect(sent).toHaveLength(1);
  channel.receive({ ...reply(1, 'write', null), nonce: '00000000-0000-0000-0000-000000000002' });
  await expect(first).rejects.toMatchObject({ code: 'LOGGING_OUTCOME_UNKNOWN', outcome: 'unknown' }); expect(failures).toBe(1);
});
test('a mismatched response cannot resolve another operation and malformed fields never evaluate getters', async () => {
  let invoked = false; expect(() => readDeliveryWire({ get nonce() { invoked = true; return nonce; } })).toThrow(); expect(invoked).toBe(false);
  expect(() => readDeliveryWire(reply(1, 'write', { get nested() { invoked = true; return true; } }))).toThrow(); expect(invoked).toBe(false);
  const channel = new LoggingDeliveryChannel(nonce, () => {}, async () => null, () => {}, () => {});
  const request = channel.call('flush', null); channel.receive(reply(1, 'stop', null));
  await expect(request).rejects.toMatchObject({ code: 'LOGGING_OUTCOME_UNKNOWN' });
  expect(() => readDeliveryPage({ rows: [], queued: 1, bytes: 10 })).toThrow();
});

test('a malformed error response rejects its dispatched request instead of removing an unsettled promise', async () => {
  const channel = new LoggingDeliveryChannel(nonce, () => {}, async () => null, () => {}, () => {});
  const request = channel.call('write', null);
  channel.receive({ ...reply(1, 'write', null), error: { code: 'UNRECOGNIZED', outcome: 'unknown' } });
  await expect(request).rejects.toMatchObject({ code: 'LOGGING_OUTCOME_UNKNOWN', outcome: 'unknown' });
});
