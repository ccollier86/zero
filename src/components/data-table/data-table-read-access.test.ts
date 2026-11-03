/** Definitive read rejection must not be guessed from arbitrary errors, text or transient provider failures. */
import { expect, test } from 'bun:test';
import { FetchError } from '../../frontend/client/sdk';
import { isDataTableReadAccessDenied } from './data-table-read-access';
test('recognizes actual SDK read denials without depending on custom server code spelling', () => {
  for (const status of [401, 403]) expect(isDataTableReadAccessDenied(new FetchError('Synthetic denied read.', status, { code: 'APP_CUSTOM_READ_DENIED' }))).toBe(true);
  expect(isDataTableReadAccessDenied(new FetchError('Synthetic required admission.', 428, { code: 'LOGGING_ADMISSION_REQUIRED' }))).toBe(true);
});
test('does not misclassify transient failures, arbitrary message strings or unrelated preconditions', () => {
  for (const error of [new FetchError('Access denied', 503, { code: 'APP_CUSTOM_READ_DENIED' }), new Error('403 Forbidden'),
    { status: 403 }, new FetchError('Synthetic precondition', 428, { code: 'SOME_OTHER_PRECONDITION' }),
    new FetchError('Synthetic validation', 400, {}), new FetchError('Synthetic overload', 429, {})]) expect(isDataTableReadAccessDenied(error)).toBe(false);
});
