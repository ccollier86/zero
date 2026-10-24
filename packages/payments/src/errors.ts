export class PaymentsError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly outcome: 'none' | 'unknown' = 'none') { super(message); this.name = 'PaymentsError'; }
}
export function invalid(message = 'Payment request fields are invalid.'): never { throw new PaymentsError(message, 'PAYMENTS_INPUT_INVALID'); }
export function safeProviderError(error: unknown): PaymentsError {
  if (error instanceof PaymentsError) return error;
  const type = error && typeof error === 'object' && 'type' in error ? String(error.type) : '';
  if (['StripeInvalidRequestError', 'StripeCardError', 'StripePermissionError', 'StripeAuthenticationError'].includes(type)) return new PaymentsError('The payment provider rejected this request.', 'PAYMENTS_PROVIDER_REJECTED', 422);
  return new PaymentsError('The provider outcome is not confirmed. Reconcile this operation; do not issue a replacement payment.', 'PAYMENTS_OUTCOME_UNKNOWN', 409, 'unknown');
}
