import type { EmailError } from './email-error';

export const EMAIL_PROVIDER_REQUEST_REJECTED = 'EMAIL_PROVIDER_REQUEST_REJECTED';

/** True when retrying the same provider request cannot change its HTTP result. */
export function isDeterministicEmailProviderRejection(status: number): boolean {
  return status >= 400 && status < 500
    && status !== 408
    && status !== 425
    && status !== 429;
}

/** Keep provider-specific error codes out of shared observability metadata. */
export function safeEmailFailureCode(error: EmailError): string {
  if (isDeterministicEmailProviderRejection(error.status)) {
    return EMAIL_PROVIDER_REQUEST_REJECTED;
  }
  return error.code === 'EMAIL_PROVIDER_MISCONFIGURED'
    ? error.code
    : 'EMAIL_SEND_FAILED';
}
