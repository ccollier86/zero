import type Stripe from 'stripe';
import type { BillingInvoice, BillingPayment, BillingRefund, BillingSubscription, BillingSnapshot, BillingSubject } from '@zero/framework/payments';
import type { ResolvedPaymentsOptions } from './options';
import { PaymentsError } from './errors';

export const stripeId = (value: string | { id: string } | null | undefined): string | null => typeof value === 'string' ? value : value?.id ?? null;
export function assertResource(value: { livemode?: boolean; customer?: unknown }, customer: string | null, options: ResolvedPaymentsOptions): void {
  if (value.livemode !== (options.mode === 'live') || customer !== null && stripeId(value.customer as any) !== customer) throw new PaymentsError('The provider resource is outside this billing subject/environment.', 'PAYMENTS_RESOURCE_FORBIDDEN', 403);
}
export function subscriptionView(value: Stripe.Subscription, options: ResolvedPaymentsOptions): BillingSubscription {
  const offer = (price: string) => [...options.offers.values()].find(offer => offer.price === price)?.id;
  return { id: value.id, status: value.status, offers: value.items.data.map(item => offer(item.price.id)).filter((id): id is string => !!id),
    quantity: value.items.data.reduce((sum, item) => sum + (item.quantity ?? 1), 0), cancelAtPeriodEnd: value.cancel_at_period_end,
    cancelAt: value.cancel_at, trialEnd: value.trial_end, currentPeriodEnd: Math.max(0, ...value.items.data.map(item => item.current_period_end)) || null };
}
export function invoiceView(value: Stripe.Invoice): BillingInvoice { return { id: value.id, number: value.number, status: value.status, total: { amount: value.total, currency: value.currency }, paid: value.status === 'paid', createdAt: value.created, dueAt: value.due_date }; }
export function paymentView(value: Stripe.PaymentIntent): BillingPayment {
  const charge = value.latest_charge && typeof value.latest_charge !== 'string' ? value.latest_charge : null;
  return { id: value.id, status: value.status, total: { amount: value.amount, currency: value.currency }, refunded: charge?.amount_refunded ?? 0, createdAt: value.created };
}
export function refundView(value: Stripe.Refund): BillingRefund { return { id: value.id, status: value.status ?? null, total: { amount: value.amount, currency: value.currency }, paymentId: stripeId(value.payment_intent) ?? '', createdAt: value.created }; }
export function deriveEntitlements(subscriptions: Stripe.Subscription[], options: ResolvedPaymentsOptions): Record<string, boolean | number> {
  const grants: Record<string, boolean | number> = Object.create(null);
  for (const sub of subscriptions) {
    const invoice = sub.latest_invoice && typeof sub.latest_invoice !== 'string' ? sub.latest_invoice : null;
    // No implicit past-due grace or role mutation. Trialing is an explicit Stripe trial; active requires paid/zero-due evidence.
    if (!(sub.status === 'trialing' && (sub.trial_end ?? 0) > Date.now() / 1000 || sub.status === 'active' && invoice && (invoice.status === 'paid' || invoice.status === 'open' && invoice.amount_due === 0))) continue;
    for (const item of sub.items.data) {
      if (item.current_period_end <= Date.now() / 1000) continue;
      const offer = [...options.offers.values()].find(offer => offer.price === item.price.id); if (!offer) continue;
      for (const [key, value] of Object.entries(offer.features)) {
        if (typeof value === 'boolean') grants[key] = value || grants[key] === true;
        else grants[key] = Math.max(typeof grants[key] === 'number' ? grants[key] as number : 0, value);
      }
    }
  }
  return grants;
}
export function entitlementDeadline(subscriptions: Stripe.Subscription[]): number | null {
  const ends = subscriptions.filter(sub => ['active', 'trialing'].includes(sub.status)).flatMap(sub => [sub.trial_end, ...sub.items.data.map(item => item.current_period_end)]).filter((end): end is number => end !== null && end > Date.now() / 1000);
  return ends.length ? Math.min(...ends) : null;
}
export function emptySnapshot(subject: BillingSubject, options: ResolvedPaymentsOptions): BillingSnapshot { return { subject, provider: 'stripe', mode: options.mode, revision: 0, customer: null, subscriptions: [], invoices: [], payments: [], entitlements: {}, reconciledAt: null, stale: true, policyVersion: options.policyVersion, entitlementsValidUntil: null }; }
