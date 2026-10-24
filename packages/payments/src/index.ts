/** Optional provider selection over one Zero payments facade. Imports never start workers or contact a provider. */
import type { ServerRouteServices } from '@zero/framework/server';
import { StripePayments } from './service';
import { SquarePayments } from './square/service';
import { resolvePaymentsOptions, type PaymentsOptions } from './options';
import { createPaymentsPlugin } from './provider-plugin';
import { PaymentsError } from './errors';
export function stripePayments(input: PaymentsOptions) {
  const options = resolvePaymentsOptions(input);
  return createPaymentsPlugin(options, 'stripe', (db, runtime) => new StripePayments(db, options, runtime));
}
/** Trusted setup integration. A scoped request facade cannot obtain this merchant capability. */
export function getStripePayments(zero: Pick<ServerRouteServices, 'payments'>): StripePayments {
  if (!(zero.payments instanceof StripePayments)) throw new PaymentsError('Stripe Payments is not installed in this runtime.', 'PAYMENTS_UNAVAILABLE', 503);
  return zero.payments;
}
/** Provider-neutral trusted owner, including subjectless custom-amount charges. */
export function getPayments(zero: Pick<ServerRouteServices, 'payments'>): StripePayments | SquarePayments {
  if (!(zero.payments instanceof StripePayments) && !(zero.payments instanceof SquarePayments)) throw new PaymentsError('A trusted payments owner is required.', 'PAYMENTS_UNAVAILABLE', 503);
  return zero.payments;
}
export { StripePayments, PaymentsError };
export { squarePayments, getSquarePayments, SquarePayments } from './square';
export type { SquarePaymentsOptions, SquareOffer } from './square';
export type { PaymentsOptions, StripeOffer } from './options';
export type { PaymentsJob, PaymentsJobStatus, PaymentsJobQuery, PaymentsJobPage } from './jobs';
export type * from '@zero/framework/payments';
