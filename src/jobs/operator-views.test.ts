/** Pure safe-view checks. No files, fixtures, databases or processes are created. */
import { expect, test } from 'bun:test';
import type { JobOccurrenceView } from './contracts';
import { activeJobOccurrence, jobBlockedCode, jobOccurrenceView } from './operator-views';

const occurrence: JobOccurrenceView = { id: 'occ_synthetic', generation: 2, scheduledAt: 100, state: 'claimed', workflowId: null,
  terminalStatus: null, errorCode: null, createdAt: 100, updatedAt: 101 };

test('blocked reasons are closed operational stops, not arbitrary retained text', () => {
  expect(jobBlockedCode(null)).toBeNull();
  for (const code of ['JOBS_CAPACITY', 'JOBS_AUTHORITY_RETIRED', 'JOBS_DEFINITION_UNAVAILABLE'] as const) expect(jobBlockedCode(code)).toBe(code);
  expect(() => jobBlockedCode('PRIVATE_RETAINED_DETAIL')).toThrow(expect.objectContaining({ code: 'JOBS_STATE_INVALID' }));
  expect(() => jobBlockedCode('JOBS_OUTCOME_UNKNOWN')).toThrow(expect.objectContaining({ code: 'JOBS_STATE_INVALID' }));
});

test('occurrence projection never copies private dispatch state from a richer row', () => {
  const privateRow = { id: occurrence.id, generation: 2, scheduled_at: 100, state: 'claimed' as const, workflow_id: null,
    terminal_status: null, error_code: null, created_at: 100, updated_at: 101, lease_nonce: 'PRIVATE_NONCE',
    receipt_json: 'PRIVATE_RECEIPT', admission_id: 'PRIVATE_ADMISSION', scope_id: 'PRIVATE_SCOPE' };
  const view = jobOccurrenceView(privateRow);
  expect(view).toEqual(occurrence); expect(Object.keys(view)).toHaveLength(9);
  expect(JSON.stringify(view)).not.toContain('PRIVATE');
  expect(() => jobOccurrenceView({ ...privateRow, error_code: 'PRIVATE_PROVIDER_DETAIL' })).toThrow(expect.objectContaining({ code: 'JOBS_STATE_INVALID' }));
  expect(() => jobOccurrenceView({ ...privateRow, terminal_status: 'PRIVATE_PROVIDER_DETAIL' })).toThrow(expect.objectContaining({ code: 'JOBS_STATE_INVALID' }));
});

test('one active representative keeps older-generation work visible independently of the latest occurrence', () => {
  const claimed = { ...occurrence, id: 'new-claim', generation: 3, scheduledAt: 300 };
  const dispatched = { ...occurrence, id: 'old-run', generation: 1, scheduledAt: 100, state: 'dispatched' as const, workflowId: 'workflow_synthetic' };
  expect(activeJobOccurrence(claimed, dispatched)).toBe(dispatched);
  expect(activeJobOccurrence({ ...claimed, generation: 1, scheduledAt: 200 }, dispatched)?.id).toBe('new-claim');
  expect(activeJobOccurrence(null, dispatched)).toBe(dispatched);
  expect(activeJobOccurrence(claimed, null)).toBe(claimed);
  expect(activeJobOccurrence(null, null)).toBeNull();
});
