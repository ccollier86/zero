import { expect, test } from 'bun:test';
import { EmailError } from '../email';
import { AuthError } from './types';
import { classifyAuthEmailFailure } from './auth-email-outbox-failure-classification';

test('classifies provider failures with stable retry policy codes', () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    expect(classifyAuthEmailFailure(
      new EmailError('provider secret', 'VENDOR_PRIVATE_CODE', status)
    )).toEqual({
      code: 'EMAIL_PROVIDER_REQUEST_REJECTED', retryable: false,
    });
  }

  for (const status of [408, 425, 429, 500, 502, 503]) {
    expect(classifyAuthEmailFailure(
      new EmailError('provider secret', 'VENDOR_PRIVATE_CODE', status)
    )).toEqual({ code: 'EMAIL_SEND_FAILED', retryable: true });
  }

  expect(classifyAuthEmailFailure(new Error('network secret')))
    .toEqual({ code: 'EMAIL_SEND_FAILED', retryable: true });
  expect(classifyAuthEmailFailure(
    new EmailError('stopping', 'EMAIL_DELIVERY_ABORTED', 503)
  )).toEqual({ code: 'EMAIL_DELIVERY_ABORTED', retryable: true });
  expect(classifyAuthEmailFailure(
    new AuthError('rejected', 'EMAIL_DELIVERY_REJECTED', 502)
  )).toEqual({ code: 'EMAIL_DELIVERY_REJECTED', retryable: false });
  expect(classifyAuthEmailFailure(
    new AuthError('bad template', 'AUTH_EMAIL_TEMPLATE_INVALID', 500)
  )).toEqual({ code: 'AUTH_EMAIL_TEMPLATE_INVALID', retryable: false });
});
