/** Public custom logging failures keep stable codes/outcomes and no private exception text. */
import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { LoggingError, type LoggingErrorCode } from '../../logging/logging-error';
import { applyServerExtensionErrorHandler } from './server-extension-error-handler';

test('Zero extension logging errors distinguish caller, admission, conflict and service failures', async () => {
  const cases: readonly [LoggingErrorCode, number][] = [
    ['LOGGING_FORBIDDEN', 403], ['LOGGING_ADMISSION_REQUIRED', 428], ['LOGGING_BACKPRESSURE', 429],
    ['LOGGING_EVENT_INVALID', 422], ['LOGGING_QUERY_INVALID', 422], ['LOGGING_EVENT_CONFLICT', 409],
    ['LOGGING_CONFIG_INVALID', 503], ['LOGGING_RESPONSE_INVALID', 503], ['LOGGING_OUTCOME_UNKNOWN', 503],
  ];
  const app = applyServerExtensionErrorHandler(new Elysia())
    .get('/failure/:index', ({ params }) => {
      throw new LoggingError(cases[Number(params.index)]![0], 'private-records-and-credentials', 'unknown');
    }).compile();
  for (const [index, [code, status]] of cases.entries()) {
    const response = await app.handle(new Request('http://localhost/failure/' + index));
    expect(response.status).toBe(status);
    const result = await response.json();
    expect(result).toMatchObject({ code, outcome: 'unknown' });
    expect(JSON.stringify(result)).not.toContain('private-records-and-credentials');
  }
});
