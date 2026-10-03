import { describe, expect, test } from 'bun:test';

import { DatabaseError } from '../databases/database-error';
import { mapDataStudioDatabaseFailure } from './data-studio-database-error';
import { toDataStudioHttpFailure } from './data-studio-http-error';

describe('Data Studio Fabric failure mapping', () => {
  test('keeps caller payload failures distinct from server result failures', () => {
    const invalid = map('DATABASE_PAYLOAD_INVALID');
    const inputLimit = map('DATABASE_PAYLOAD_LIMIT');
    const resultLimit = map('DATABASE_RESULT_LIMIT');

    expect(invalid.code).toBe('DATA_STUDIO_VALUE_INVALID');
    expect(toDataStudioHttpFailure(invalid, 'read').status).toBe(422);
    expect(inputLimit.code).toBe('DATA_STUDIO_LIMIT_EXCEEDED');
    expect(toDataStudioHttpFailure(inputLimit, 'read').status).toBe(413);
    expect(resultLimit.code).toBe('DATA_STUDIO_INTERNAL_ERROR');
    expect(toDataStudioHttpFailure(resultLimit, 'read').status).toBe(500);
  });

  test('treats a missing realm operation as server readiness, not caller input', () => {
    const unsupported = map('DATABASE_OPERATION_UNSUPPORTED');

    expect(unsupported).toMatchObject({
      code: 'DATA_STUDIO_NOT_READY',
      retryable: false,
      details: {
        databaseCode: 'DATABASE_OPERATION_UNSUPPORTED',
        failureKind: 'invalid',
      },
    });
    expect(toDataStudioHttpFailure(unsupported, 'read')).toMatchObject({
      status: 503,
      body: { code: 'DATA_STUDIO_NOT_READY' },
    });
  });
});

function map(code: ConstructorParameters<typeof DatabaseError>[0]) {
  return mapDataStudioDatabaseFailure(
    new DatabaseError(code, 'private database implementation detail'),
    'read',
  );
}
