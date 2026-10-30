import { expect, test } from 'bun:test';
import { captureLoggingRecordChange } from './logging-record-change';
import { normalizeLoggingResourcePolicies } from './logging-resource-policy';
import { captureLoggingEvent, normalizeLoggingEvent, loggingCanonical } from './logging-validation';
import { loggingContext, loggingEvent } from './test-support/logging-fixture';
import { decodeLoggingSourceEvent, encodeLoggingSourceEvent } from './logging-source-codec';
import { isLoggingActivityDetail } from './logging-activity-shape';
import { normalizeLoggingActivityDetail } from './logging-activity-validation';

const change = { op: 'UPDATE' as const, table: 'invoices', seq: 7, previousRow: { id: 'invoice-7', status: 'draft', amount: 140, secret: 'PRIVATE_OLD' },
  row: { id: 'invoice-7', status: 'approved', amount: 200, secret: 'PRIVATE_NEW' } };

test('actual source differences default to names only; approved values and omissions are explicit', () => {
  const resources = normalizeLoggingResourcePolicies({ invoices: { label: 'Invoices', fields: { status: { values: ['draft', 'approved'] }, secret: 'omit' } } });
  const result = captureLoggingRecordChange(change, resources)!;
  expect(result).toEqual({ kind: 'record-change', table: 'invoices', sequence: 7, changes: [
    { field: 'amount', beforePresent: true, afterPresent: true, kind: 'redacted' },
    { field: 'status', beforePresent: true, afterPresent: true, kind: 'value', before: 'draft', after: 'approved' },
  ], omittedFields: 1 });
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|140|200/);
  expect(captureLoggingRecordChange({ ...change, row: change.previousRow }, resources)).toBeNull();
  expect(captureLoggingRecordChange({ ...change, row: { ...change.row, status: 'unapproved-vocabulary' } }, resources)?.changes.at(-1)?.kind).toBe('redacted');
});

test('missing fields, nulls and create/delete remain distinct; wide changes report their bounded omission', () => {
  const resources = normalizeLoggingResourcePolicies({ invoices: { fields: { flag: { values: [true, false, null] } } } });
  const created = captureLoggingRecordChange({ ...change, op: 'INSERT', previousRow: null, row: { flag: null } }, resources)!;
  expect(created.changes[0]).toEqual({ field: 'flag', beforePresent: false, afterPresent: true, kind: 'value', before: null, after: null });
  const deleted = captureLoggingRecordChange({ ...change, op: 'DELETE', previousRow: { flag: false }, row: null }, resources)!;
  expect(deleted.changes[0]).toEqual({ field: 'flag', beforePresent: true, afterPresent: false, kind: 'value', before: false, after: null });
  const wide = captureLoggingRecordChange({ ...change, previousRow: null, row: Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['field-' + i, i])) })!;
  expect(wide.changes).toHaveLength(32); expect(wide.omittedFields).toBe(68);
});

test('credential values cannot opt in, policy getters/proxies never execute, and unknown free-form bodies stay redacted', () => {
  for (const field of ['password', 'access_token', 'refreshToken', 'api_key', 'privateKey']) {
    expect(() => normalizeLoggingResourcePolicies({ invoices: { fields: { [field]: { values: ['PRIVATE_OLD', 'PRIVATE_NEW'] } } } })).toThrow();
  }
  let called = false;
  expect(() => normalizeLoggingResourcePolicies({ get invoices() { called = true; return {}; } })).toThrow(); expect(called).toBe(false);
  expect(() => normalizeLoggingResourcePolicies(new Proxy({}, { ownKeys() { called = true; return []; } }))).toThrow(); expect(called).toBe(false);
  const result = captureLoggingRecordChange(change)!;
  expect(result.changes.every(field => field.kind === 'redacted')).toBe(true);
});

test('v2 structured differences round-trip through source spools while legacy canonical envelopes remain unchanged', () => {
  const detail = captureLoggingRecordChange(change)!;
  const event = captureLoggingEvent(loggingContext(), { id: 'changed', family: 'records', action: 'record.updated', outcome: 'succeeded', evidence: 'server-confirmed',
    occurredAt: 1, target: { type: 'table.invoices', id: 'invoice-7' }, detail });
  expect(event.version).toBe(2); expect(isLoggingActivityDetail(event.detail)).toBe(true);
  expect(normalizeLoggingEvent(JSON.parse(JSON.stringify(event)))).toEqual(event);
  const encoded = encodeLoggingSourceEvent(event);
  expect(decodeLoggingSourceEvent(encoded.payload, encoded.context)).toEqual(event);
  const old = loggingEvent(), canonical = loggingCanonical(old), legacy = encodeLoggingSourceEvent(old);
  expect(JSON.parse(legacy.payload)).toHaveLength(9); expect(loggingCanonical(normalizeLoggingEvent(old))).toBe(canonical);
  expect(decodeLoggingSourceEvent(legacy.payload, legacy.context)).toEqual(old);
  expect(event.detail?.kind).toBe('record-change');
  expect(Object.isFrozen(event.detail?.kind === 'record-change' && event.detail.changes)).toBe(true);
  expect(() => normalizeLoggingEvent({ ...event, version: 1 })).toThrow();
  expect(() => normalizeLoggingEvent({ ...event, origin: 'frontend', evidence: 'browser-observed' })).toThrow();
  expect(() => normalizeLoggingEvent({ ...event, detail: { ...detail, changes: [{ field: 'password', kind: 'value', beforePresent: true, afterPresent: true, before: 'old', after: 'new' }] } })).toThrow();
  let called = false;
  expect(() => normalizeLoggingEvent({ ...event, detail: { ...detail, get changes() { called = true; return []; } } })).toThrow(); expect(called).toBe(false);
});

test('source sequences use the full positive safe-integer range, not the timestamp range', () => {
  const detail = { ...captureLoggingRecordChange(change)!, sequence: Number.MAX_SAFE_INTEGER };
  expect(normalizeLoggingActivityDetail(detail)).toEqual(detail); expect(isLoggingActivityDetail(detail)).toBe(true);
  for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    expect(() => normalizeLoggingActivityDetail({ ...detail, sequence })).toThrow();
    expect(isLoggingActivityDetail({ ...detail, sequence })).toBe(false);
  }
});

test('JSON-equivalent scalar values are no-ops and accepted differences survive JSON/spool replay', () => {
  const detail = { ...captureLoggingRecordChange(change)!, changes: [
    { field: 'amount', kind: 'value' as const, beforePresent: true, afterPresent: true, before: -0, after: 0 },
  ] };
  expect(() => normalizeLoggingActivityDetail(detail)).toThrow(); expect(isLoggingActivityDetail(detail)).toBe(false);
  expect(captureLoggingRecordChange({ ...change, previousRow: { amount: -0 }, row: { amount: 0 } })).toBeNull();
  const created = { ...detail, changes: [{ ...detail.changes[0]!, beforePresent: false, before: null, after: -0 }] };
  const normalized = normalizeLoggingActivityDetail(created);
  expect(normalizeLoggingActivityDetail(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized);
});

test('typed facts cannot contradict their native table, operation, or changed-field meaning', () => {
  const detail = captureLoggingRecordChange(change)!;
  const input = { id: 'coherent-edit', family: 'records' as const, action: 'record.updated', outcome: 'succeeded' as const, evidence: 'server-confirmed' as const,
    occurredAt: 1, target: { type: 'table.invoices', id: 'invoice-7' }, detail };
  expect(() => captureLoggingEvent(loggingContext(), { ...input, target: { type: 'table.other', id: 'invoice-7' } })).toThrow();
  expect(() => captureLoggingEvent(loggingContext(), { ...input, action: 'record.created' })).toThrow();
  expect(() => captureLoggingEvent(loggingContext(), { ...input, action: 'record.deleted' })).toThrow();
  expect(() => captureLoggingEvent(loggingContext(), { ...input, detail: { ...detail, changes: [], omittedFields: 0 } })).toThrow();
  const omitted = captureLoggingEvent(loggingContext(), { ...input, detail: { ...detail, changes: [], omittedFields: 3 } }).detail;
  expect(omitted?.kind === 'record-change' && omitted.omittedFields).toBe(3);
  for (const op of ['INSERT', 'DELETE'] as const) {
    const valid = captureLoggingRecordChange({ ...change, op, previousRow: op === 'INSERT' ? null : change.previousRow, row: op === 'DELETE' ? null : change.row })!;
    expect(captureLoggingEvent(loggingContext(), { ...input, action: op === 'INSERT' ? 'record.created' : 'record.deleted', detail: valid }).detail).toEqual(valid);
  }
});

test('credential vocabulary cannot bypass field policy or normalized envelope admission', () => {
  const detail = captureLoggingRecordChange(change)!;
  for (const field of ['idToken', 'action_token', 'verificationToken', 'reset_token', 'token_value']) {
    expect(() => normalizeLoggingResourcePolicies({ invoices: { fields: { [field]: { values: ['old', 'new'] } } } })).toThrow();
    const unsafe = { ...detail, changes: [{ field, kind: 'value', beforePresent: true, afterPresent: true, before: 'old', after: 'new' }] };
    expect(() => normalizeLoggingActivityDetail(unsafe)).toThrow(); expect(isLoggingActivityDetail(unsafe)).toBe(false);
  }
});
