import { expect, test } from 'bun:test';
import { OBS_CODES } from '../../observability/codes';
import { DataStudioMutationError } from './data-studio-client';
import { reportDataStudioFrontendFailure } from './data-studio-observability';
import { configureFrontendObservability, getFrontendObservabilitySink, type FrontendObservabilityEvent } from './observability';

test('emits one stable event containing only bounded failure metadata', () => {
  const previous = getFrontendObservabilitySink();
  const events: FrontendObservabilityEvent[] = [];
  configureFrontendObservability({ sink: { emit: event => { events.push(event); } } });
  try {
    const error = new DataStudioMutationError('Private row value and tenant name must not be emitted', 'private-idempotency-key', {
      code: 'DATA_STUDIO_REVISION_CONFLICT', retryable: true,
    });
    reportDataStudioFrontendFailure('row.replace', 'mutation', error);
    expect(events).toEqual([expect.objectContaining({
      code: OBS_CODES.FRONTEND_DATA_STUDIO_OPERATION_FAILED.code,
      metadata: { operation: 'row.replace', category: 'mutation', code: 'DATA_STUDIO_REVISION_CONFLICT', retryable: true },
    })]);
    expect(events[0]?.error).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain('Private row value');
    expect(JSON.stringify(events)).not.toContain('private-idempotency-key');
  } finally { configureFrontendObservability({ sink: previous }); }
});

test('normalizes unclassified read failures without serializing the error', () => {
  const previous = getFrontendObservabilitySink();
  const events: FrontendObservabilityEvent[] = [];
  configureFrontendObservability({ sink: { emit: event => { events.push(event); } } });
  try {
    reportDataStudioFrontendFailure('row-page.load', 'load', new Error('/private/path?tenant=secret'));
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toEqual({ operation: 'row-page.load', category: 'load', code: null, retryable: false });
    expect(JSON.stringify(events)).not.toContain('/private/path');
  } finally { configureFrontendObservability({ sink: previous }); }
});

test('controller and component reporting of the same Data Studio failure emits once', () => {
  const previous = getFrontendObservabilitySink();
  const events: FrontendObservabilityEvent[] = [];
  configureFrontendObservability({ sink: { emit: event => { events.push(event); } } });
  try {
    const failure = new DataStudioMutationError('private row values', 'private-operation-id', { code: 'DATA_STUDIO_VALUE_INVALID', retryable: true });
    reportDataStudioFrontendFailure('row.create', 'mutation', failure);
    reportDataStudioFrontendFailure('row.create', 'mutation', failure);
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toEqual({ operation: 'row.create', category: 'mutation', code: 'DATA_STUDIO_VALUE_INVALID', retryable: true });
    expect(events[0].error).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain('private');
    reportDataStudioFrontendFailure('row.replace', 'mutation', failure);
    reportDataStudioFrontendFailure('row.create', 'load', failure);
    expect(events).toHaveLength(3);
  } finally { configureFrontendObservability({ sink: previous }); }
});

test('separate errors and direct SDK/custom adapter failures remain observable without raw data', () => {
  const previous = getFrontendObservabilitySink();
  const events: FrontendObservabilityEvent[] = [];
  configureFrontendObservability({ sink: { emit: event => { events.push(event); } } });
  try {
    reportDataStudioFrontendFailure('row.create', 'mutation', new DataStudioMutationError('private', 'secret', { requiresSameIdempotencyKey: true }));
    reportDataStudioFrontendFailure('row.create', 'mutation', new Error('secret submitted record'));
    reportDataStudioFrontendFailure('row.create', 'mutation', new Error('secret submitted record'));
    expect(events).toHaveLength(3);
    expect(events.every(event => event.error === undefined)).toBe(true);
    expect(JSON.stringify(events)).not.toContain('secret');
    const forged = new DataStudioMutationError('private', 'secret');
    Object.defineProperty(forged, 'code', { value: 'secret-value' });
    reportDataStudioFrontendFailure('row.create', 'mutation', forged);
    expect(events.at(-1)?.metadata?.code).toBeNull();
  } finally { configureFrontendObservability({ sink: previous }); }
});
