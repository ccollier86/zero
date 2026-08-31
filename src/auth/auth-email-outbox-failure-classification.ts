import { EmailError } from '../email';
import {
  EMAIL_PROVIDER_REQUEST_REJECTED,
  isDeterministicEmailProviderRejection,
} from '../email/email-failure-policy';
import { AuthError } from './types';

export interface AuthEmailFailureClassification {
  code: string;
  retryable: boolean;
}

/** Reduce provider failures to privacy-safe, stable outbox policy codes. */
export function classifyAuthEmailFailure(
  error: unknown
): AuthEmailFailureClassification {
  if (error instanceof AuthError) {
    if (error.code === 'EMAIL_DELIVERY_REJECTED'
      || error.code === 'AUTH_EMAIL_TEMPLATE_INVALID') {
      return { code: error.code, retryable: false };
    }
    return { code: 'EMAIL_SEND_FAILED', retryable: true };
  }
  if (!(error instanceof EmailError)) {
    return { code: 'EMAIL_SEND_FAILED', retryable: true };
  }
  if (error.code === 'EMAIL_DELIVERY_ABORTED'
    || error.code === 'EMAIL_DELIVERY_LEASE_LOST'
    || error.code === 'EMAIL_DELIVERY_TIMEOUT') {
    return { code: error.code, retryable: true };
  }
  if (error.code === 'EMAIL_DELIVERY_REJECTED'
    || error.code === 'AUTH_EMAIL_TEMPLATE_INVALID') {
    return { code: error.code, retryable: false };
  }
  if (error.code === EMAIL_PROVIDER_REQUEST_REJECTED
    || isDeterministicEmailProviderRejection(error.status)) {
    return { code: EMAIL_PROVIDER_REQUEST_REJECTED, retryable: false };
  }
  return { code: 'EMAIL_SEND_FAILED', retryable: true };
}
