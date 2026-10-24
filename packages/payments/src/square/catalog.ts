/** Resolve server-selected Square catalog aliases; arbitrary client amounts and variable/complex subscription pricing are not catalog billing. */
import type { BillingOffer } from '@zero/framework/payments';
import type { SquarePayments } from './service';
import { money } from './models';
import { PaymentsError, invalid } from '../errors';
export async function squareOffer(service: SquarePayments, id: string, quantity?: number) {
  const offer = service.options.offers.get(id); if (!offer) invalid('Unknown billing offer.');
  const count = quantity ?? 1; if (!Number.isSafeInteger(count) || count < offer.quantity.min || count > offer.quantity.max) invalid('Offer quantity is outside its declared range.');
  await service.verifyMerchant();
  const objectId = offer.kind === 'payment' ? offer.itemVariationId : offer.planVariationId;
  const value = (await service.native.catalog.object.get({ objectId, includeRelatedObjects: true })).object;
  if (!value || value.id !== objectId || value.isDeleted || value.absentAtLocationIds?.includes(service.options.locationId) || value.presentAtAllLocations === false && !value.presentAtLocationIds?.includes(service.options.locationId)) throw new PaymentsError('This Square offer is unavailable at the configured location.', 'PAYMENTS_OFFER_UNAVAILABLE', 409);
  let price;
  let interval: string | undefined;
  if (offer.kind === 'payment' && value.type === 'ITEM_VARIATION') {
    const variation = value.itemVariationData;
    if (!variation || variation.pricingType !== 'FIXED_PRICING') throw new PaymentsError('Catalog checkout requires fixed pricing.', 'PAYMENTS_CAPABILITY_UNSUPPORTED', 501);
    price = money(variation.locationOverrides?.find(item => item.locationId === service.options.locationId)?.priceMoney ?? variation.priceMoney);
  } else if (offer.kind === 'subscription' && value.type === 'SUBSCRIPTION_PLAN_VARIATION') {
    const phases = value.subscriptionPlanVariationData?.phases;
    if (!phases || phases.length !== 1 || phases[0]!.pricing?.type !== 'STATIC' || phases[0]!.pricing?.discountIds?.length) throw new PaymentsError('Self-service Square subscriptions require one static-price phase. Complex plans need an explicit merchant workflow.', 'PAYMENTS_CAPABILITY_UNSUPPORTED', 501);
    price = money(phases[0]!.pricing?.priceMoney ?? phases[0]!.recurringPriceMoney); interval = phases[0]!.cadence?.toLowerCase();
  } else throw new PaymentsError('Square catalog object type does not match the offer.', 'PAYMENTS_OFFER_UNAVAILABLE', 409);
  if (price.currency !== service.currency || price.amount < 0 || !Number.isSafeInteger(price.amount * count)) invalid('Catalog amount/currency does not match this Square location.');
  const projection: BillingOffer = { id: offer.id, label: offer.label, kind: offer.kind, quantity: { ...offer.quantity }, features: { ...offer.features }, unitAmount: price.amount, currency: price.currency, ...(interval ? { interval } : {}) };
  return { offer, quantity: count, price, projection };
}
