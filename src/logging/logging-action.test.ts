import { expect, test } from 'bun:test';
import { captureLoggingAction, defineLoggingAction } from './logging-action';
import { loggingContext } from './test-support/logging-fixture';
const definition = defineLoggingAction({ code: 'app.invoice.approved', version: '1', label: 'Approved an invoice', family: 'records', values: { previous: ['pending', 'review'], next: ['approved'] } });
test('typed action definitions detach finite vocabularies and retain a readable stable replay fact', () => {
  const input = { id: 'invoice-operation', occurredAt: 1000, target: { type: 'table.invoices', id: 'invoice-one' }, outcome: 'succeeded' as const, values: { previous: 'pending' as const, next: 'approved' as const } };
  const event = captureLoggingAction(loggingContext(), definition, input);
  expect(event).toMatchObject({ action: 'app.invoice.approved', evidence: 'server-confirmed', actor: loggingContext().actor,
    metadata: { actionName: 'Approved an invoice', actionVersion: '1', value_previous: 'pending', value_next: 'approved' } });
  expect(captureLoggingAction(loggingContext(), definition, input)).toEqual(event);
  expect(Object.isFrozen(definition.values.previous)).toBe(true);
  expect(() => captureLoggingAction(loggingContext(), definition, { ...input, values: { previous: 'private narrative', next: 'approved' } })).toThrow();
  expect(() => captureLoggingAction(loggingContext(), definition, { ...input, values: { ...input.values, unexpected: 'extra' } })).toThrow();
  expect(() => defineLoggingAction({ ...definition, code: 'session.revoked' })).toThrow();
  expect(() => defineLoggingAction({ ...definition, values: { apiToken: ['not-allowed'] } })).toThrow();
});
