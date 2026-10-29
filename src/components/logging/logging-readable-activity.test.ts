import { expect, test } from 'bun:test';
import { loggingActivityCode, loggingResourceLabel, loggingTableLabel, loggingWords } from './logging-readable-activity';
import type { LoggingEvent } from '../../logging/logging-contracts';
test('common activities are understandable without upgrading evidence semantics', () => {
  expect(loggingActivityCode('record.created').label).toBe('Created a record');
  expect(loggingActivityCode('record.updated').label).toBe('Edited a record');
  expect(loggingActivityCode('record.deleted').label).toBe('Deleted a record');
  expect(loggingActivityCode('record.read.prepared').description).toContain('does not prove');
  expect(loggingActivityCode('print.requested').description).toContain('does not prove');
  expect(loggingActivityCode('constructor').label).toBe('Constructor');
  expect(loggingWords('treatmentPlan.approved')).toBe('Treatment Plan approved');
});
test('app-authored labels do not rewrite original identities and work for retained legacy tables', () => {
  const presentation = { actions: { 'plan.reviewed': { label: 'Reviewed a treatment plan' } }, tables: { 'table.clinical-notes': 'Clinical notes' } };
  expect(loggingActivityCode('plan.reviewed', presentation).label).toBe('Reviewed a treatment plan');
  expect(loggingResourceLabel({ target: { type: 'table.clinical-notes', id: 'opaque-id' } }, [], presentation)).toBe('Clinical notes');
  expect(loggingResourceLabel({ target: null }, [], presentation)).toBe('No specific record');
  expect(loggingTableLabel({ type: 'table.clinical-notes', names: ['clinical_notes', 'clinical-notes'] })).toBe('Clinical notes / Clinical notes');
  expect(loggingActivityCode('plan.reviewed').label).toBe('Plan reviewed');
});

test('typed table identity disambiguates colliding legacy slugs instead of borrowing a current label', () => {
  const event: Pick<LoggingEvent, 'target' | 'detail'> = { target: { type: 'table.work-items', id: 'record-a' },
    detail: { kind: 'record-change', table: 'work_items', sequence: 1, changes: [], omittedFields: 1 } };
  const tables = [{ type: 'table.work-items', names: ['work-items', 'work_items'] }];
  expect(loggingResourceLabel(event, tables, { tables: { work_items: 'Support cases', 'work-items': 'Projects' } })).toBe('Support cases');
  expect(loggingResourceLabel(event, [{ type: 'table.work-items', names: ['work-items'], label: 'Projects' }])).toBe('Work items');
  expect(loggingResourceLabel(event, [{ type: 'table.work-items', names: ['work_items'], label: 'Support cases' }])).toBe('Support cases');
  expect(loggingResourceLabel(event, [])).toBe('Work items');
});
