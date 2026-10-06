import { describe, expect, test } from 'bun:test';
import { DataStudioMutationError } from '../../frontend/client/data-studio-client';
import { dataStudioRowCreateFailure } from './data-studio-row-dialog-error';

describe('Data Studio record creation failure presentation', () => {
  test('never includes callback exception messages, operation identifiers or unexpected codes', () => {
    for (const cause of [new Error('private form contents'), 'private raw failure',
      new DataStudioMutationError('private server data', 'private-operation-id')]) {
      const failure = dataStudioRowCreateFailure(cause);
      expect(failure.message).toContain('Your values are kept');
      expect(failure.uncertain).toBe(false);
      expect(JSON.stringify(failure)).not.toContain('private');
    }
  });

  test('preserves ambiguous acknowledgement retry semantics without exposing the cause', () => {
    const cause = new DataStudioMutationError('private network failure', 'private-operation-id', { requiresSameIdempotencyKey: true });
    const failure = dataStudioRowCreateFailure(cause);
    expect(failure.uncertain).toBe(true);
    expect(failure.message).toContain('without changing its values');
    expect(JSON.stringify(failure)).not.toContain('private');
  });

  test('maps recognized permission and revision failures to useful instructions', () => {
    expect(dataStudioRowCreateFailure(new DataStudioMutationError('private', 'op', { status: 403 })).message).toContain('permission');
    expect(dataStudioRowCreateFailure(new DataStudioMutationError('private', 'op', { code: 'DATA_STUDIO_REVISION_CONFLICT' })).message).toContain('Reload its fields');
    expect(dataStudioRowCreateFailure(new DataStudioMutationError('private', 'op', { code: 'DATA_STUDIO_TABLE_ARCHIVED' })).message).toContain('Restore it');
  });
});
