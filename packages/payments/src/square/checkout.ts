/** One canonical hosted-checkout intent for catalog and custom-amount Square payments; redirects never prove payment. */
import type { Square } from 'square';
import type { BillingCommandOwner } from '../store';
import { canonical } from '../store';
import type { SquarePayments } from './service';
import { squareWireKey } from './transport';
import { invoiceView, money, paymentView, providerInvalid } from './models';
import { PaymentsError } from '../errors';
import { safeReturnUrl } from '../options';

export interface SquareCheckoutIntent {
  operationId: string; description: string; amount: number; currency: string; quantity?: number;
  itemVariationId?: string; planVariationId?: string; offer?: string; reference?: string;
}
export async function squareCheckout(service: SquarePayments, owner: BillingCommandOwner, key: string, input: SquareCheckoutIntent) {
  if (service.options.acceptingSales === false) throw new PaymentsError('New sales are disabled.', 'PAYMENTS_SALES_DISABLED', 409);
  const saved = await service.parameters(key, 'checkout.create', async () => ({ ...input, quantity: input.quantity ?? 1 }));
  if (saved.currency !== service.currency) throw new PaymentsError('Charge currency does not match the Square location.', 'PAYMENTS_INPUT_INVALID');
  const intent = service.resources.intent(owner, key, saved.operationId, { kind: saved.planVariationId ? 'subscription' : 'checkout', amount: saved.amount, currency: saved.currency,
    quantity: saved.quantity, ...(saved.itemVariationId ? { itemVariationId: saved.itemVariationId } : {}), ...(saved.planVariationId ? { planVariationId: saved.planVariationId } : {}), ...(saved.offer ? { offer: saved.offer } : {}), ...(saved.reference ? { reference: saved.reference } : {}) });
  const response = await service.native.checkout.paymentLinks.create({ idempotencyKey: squareWireKey(key),
    description: saved.description,
    order: { locationId: service.options.locationId, referenceId: intent.reference, pricingOptions: { autoApplyTaxes: false, autoApplyDiscounts: false }, lineItems: [{ name: saved.description, quantity: String(saved.quantity),
      ...(saved.itemVariationId ? { catalogObjectId: saved.itemVariationId } : {}), basePriceMoney: { amount: BigInt(saved.amount / saved.quantity), currency: saved.currency.toUpperCase() as Square.Currency } }] },
    checkoutOptions: { redirectUrl: service.options.successUrl, allowTipping: false, enableCoupon: false, enableLoyalty: false, ...(saved.planVariationId ? { subscriptionPlanId: saved.planVariationId } : {}) },
  });
  const link = response.paymentLink;
  if (!link?.id || !link.orderId || !link.url) return providerInvalid(); safeReturnUrl(link.url);
  const order = (await service.native.orders.get({ orderId: link.orderId })).order;
  if (!order || order.locationId !== service.options.locationId || order.referenceId !== intent.reference) return providerInvalid();
  const total = money(order.totalMoney); if (total.amount !== saved.amount || total.currency !== saved.currency) return providerInvalid();
  service.resources.bind(owner, 'order', link.orderId, order, intent.reference);
  service.resources.bind(owner, 'checkout', link.id, link, intent.reference);
  return { id: link.id, url: link.url, status: 'open' };
}
export async function readSquareCheckout(service: SquarePayments, owner: BillingCommandOwner, id: string) {
  const bound = service.resources.require<Square.PaymentLink>(owner, 'checkout', id);
  const link = (await service.native.checkout.paymentLinks.get({ id })).paymentLink;
  if (!link?.orderId || link.orderId !== bound.data?.orderId) return providerInvalid();
  const order = (await service.ownership.require<Square.Order>(owner, 'order', link.orderId)).data!;
  let paid = 0; const expected = money(order.totalMoney), seen = new Set<string>();
  for (const tender of order.tenders ?? []) if (tender.paymentId) {
    if (seen.has(tender.paymentId)) continue; seen.add(tender.paymentId);
    const payment = (await service.ownership.require<Square.Payment>(owner, 'payment', tender.paymentId)).data!;
    const view = paymentView(payment);
    if (view.total.currency !== expected.currency || payment.orderId !== order.id) return providerInvalid();
    if (view.status === 'succeeded') paid += view.total.amount;
    if (!Number.isSafeInteger(paid)) return providerInvalid();
  }
  let complete = paid >= expected.amount && order.state === 'COMPLETED';
  const intent = bound.reference ? service.resources.getIntent(bound.reference) : null;
  if (intent?.details.kind === 'subscription') {
    const settled = bound.reference ? service.resources.get('settled-checkout', bound.reference) : null;
    complete = !!settled && canonical(settled.owner) === canonical(owner);
    // A historical checkout remains paid after a subscription is canceled or a
    // later cycle fails. That is separate from current entitlement eligibility.
    for (const prior of complete ? [] : service.resources.recent<Square.Invoice>(owner, 'invoice', 100, bound.reference ?? undefined)) {
      const record = await service.ownership.invoice(prior.id), invoice = record?.data;
      if (!invoice || !record || canonical(record.owner) !== canonical(owner)) continue;
      const total = invoiceView(invoice).total;
      if (['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(invoice.status ?? '') && total.currency === expected.currency && total.amount === expected.amount) { complete = true; break; }
    }
  }
  return { id, status: complete ? 'complete' : order.state === 'CANCELED' ? 'expired' : 'open', paymentStatus: complete ? expected.amount === 0 ? 'no_payment_required' : 'paid' : 'unpaid' };
}
