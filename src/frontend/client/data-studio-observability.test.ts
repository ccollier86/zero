import { afterEach, describe, expect, test } from 'bun:test';
import { OBS_CODES } from '../../observability/codes';
import { DataStudioMutationError } from './data-studio-client';
import { reportDataStudioFrontendFailure } from './data-studio-observability';
import {
  configureFrontendObservability,
  type FrontendObservabilityEvent,
} from './observability';

afterEach(() => {
  configureFrontendObservability({ console: false, http: false });
});

describe('Data Studio frontend observability', () => {
  test('emits one stable event containing only bounded failure metadata', () => {
    const events: FrontendObservabilityEvent[] = [];
    configureFrontendObservability({
      sink: { emit: (event) => { events.push(event); } },
    });
    const error = new DataStudioMutationError(
      'Private row value and tenant name must not be emitted',
      'private-idempotency-key',
      {
        code: 'DATA_STUDIO_REVISION_CONFLICT',
        retryable: true,
      },
    );

    reportDataStudioFrontendFailure('row.replace', 'mutation', error);

    expect(events).toEqual([expect.objectContaining({
      code: OBS_CODES.FRONTEND_DATA_STUDIO_OPERATION_FAILED.code,
      metadata: {
        operation: 'row.replace',
        category: 'mutation',
        code: 'DATA_STUDIO_REVISION_CONFLICT',
        retryable: true,
      },
    })]);
    expect(events[0]?.error).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain('Private row value');
    expect(JSON.stringify(events)).not.toContain('private-idempotency-key');
  });

  test('normalizes unclassified read failures without serializing the error', () => {
    const events: FrontendObservabilityEvent[] = [];
    configureFrontendObservability({ sink: { emit: (event) => { events.push(event); } } });

    reportDataStudioFrontendFailure(
      'row-page.load',
      'load',
      new Error('/private/path?tenant=secret'),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toEqual({
      operation: 'row-page.load',
      category: 'load',
      code: null,
      retryable: false,
    });
    expect(JSON.stringify(events)).not.toContain('/private/path');
  });
});
