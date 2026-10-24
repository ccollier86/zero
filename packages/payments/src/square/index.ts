/** Optional Square provider behind the same ScopedPayments and trusted MerchantPayments contracts as Stripe. */
import type { ServerRouteServices } from '@zero/framework/server';
import { createPaymentsPlugin } from '../provider-plugin';
import { SquarePayments } from './service';
import { resolveSquareOptions, type SquarePaymentsOptions } from './options';
import { PaymentsError } from '../errors';
export function squarePayments(input: SquarePaymentsOptions) {
  const options = resolveSquareOptions(input);
  return createPaymentsPlugin(options, 'square', (db, runtime) => new SquarePayments(db, options, runtime));
}
export function getSquarePayments(zero: Pick<ServerRouteServices, 'payments'>): SquarePayments {
  if (!(zero.payments instanceof SquarePayments)) throw new PaymentsError('Square Payments is not installed in this runtime.', 'PAYMENTS_UNAVAILABLE', 503);
  return zero.payments;
}
export { SquarePayments };
export { SQUARE_API_VERSION } from './options';
export type { SquarePaymentsOptions, SquareOffer } from './options';
export type * from '@zero/framework/payments';
