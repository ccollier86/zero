/** Trusted custom-amount intents are detached before asynchronous admission; no raw card data or arbitrary request properties. */
import type { MerchantChargeRequest, MerchantCheckoutRequest } from '@zero/framework/payments';
import { inputObject, operationId } from './validation';
import { invalid } from './errors';

export function merchantInput<T extends MerchantCheckoutRequest>(input: T, charge = false): Readonly<T> {
  inputObject(input, ['operationId', 'total', 'description', 'reference', ...(charge ? ['paymentToken', 'verificationToken'] : [])]);
  operationId(input.operationId); inputObject(input.total, ['amount', 'currency']);
  if (!Number.isSafeInteger(input.total.amount) || input.total.amount < 1 || typeof input.total.currency !== 'string' || !/^[A-Za-z]{3}$/.test(input.total.currency)) invalid('Charge total must be a positive integer in minor currency units with a three-letter currency.');
  if (typeof input.description !== 'string' || !input.description.trim() || input.description.length > 500 || input.reference !== undefined && (typeof input.reference !== 'string' || input.reference.length > 200)) invalid('Charge description/reference is invalid.');
  if (charge) {
    const request = input as unknown as MerchantChargeRequest;
    if (typeof request.paymentToken !== 'string' || request.paymentToken.length < 8 || request.paymentToken.length > 4096 || /\s/.test(request.paymentToken) || /^\d+$/.test(request.paymentToken) || request.verificationToken !== undefined && (typeof request.verificationToken !== 'string' || request.verificationToken.length < 8 || request.verificationToken.length > 4096 || /\s/.test(request.verificationToken))) invalid('Use a valid provider payment token, never raw card details.');
  }
  return Object.freeze({ ...input, total: Object.freeze({ amount: input.total.amount, currency: input.total.currency.toLowerCase() }) });
}
