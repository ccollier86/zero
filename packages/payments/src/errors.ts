export class PaymentsError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly outcome: 'none' | 'unknown' = 'none', readonly retryable = outcome === 'unknown') { super(message); this.name = 'PaymentsError'; }
}
export function invalid(message = 'Payment request fields are invalid.'): never { throw new PaymentsError(message, 'PAYMENTS_INPUT_INVALID'); }
export function safeProviderError(error: unknown): PaymentsError {
  if (error instanceof PaymentsError) return error;
  const type = error && typeof error === 'object' && 'type' in error ? String(error.type) : '';
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (['StripePermissionError', 'StripeAuthenticationError', 'StripeRateLimitError'].includes(type) || code === 'idempotency_key_in_use') return new PaymentsError('The provider could not admit this operation. Correct its configuration or retry this same operation ID.', 'PAYMENTS_PROVIDER_UNAVAILABLE', 503, 'none', true);
  if (['StripeInvalidRequestError', 'StripeCardError'].includes(type)) return new PaymentsError('The payment provider rejected this request.', 'PAYMENTS_PROVIDER_REJECTED', 422);
  return new PaymentsError('The provider outcome is not confirmed. Reconcile this operation; do not issue a replacement payment.', 'PAYMENTS_OUTCOME_UNKNOWN', 409, 'unknown');
}
export function safeReadError(error: unknown): PaymentsError {
  if (error instanceof PaymentsError) return error;
  return new PaymentsError('Billing information is temporarily unavailable. Retry the read after the provider or storage service recovers.', 'PAYMENTS_READ_UNAVAILABLE', 503, 'none', true);
}
