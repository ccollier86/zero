import type Stripe from 'stripe';
import type { BillingInvoice, BillingPayment, BillingRefund, BillingSubscription, BillingSnapshot, BillingSubject } from '@zero/framework/payments';
import type { ResolvedPaymentsOptions } from './options';
import { PaymentsError } from './errors';
import { entitlementGrants, evaluateGrants } from './entitlements';

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
  return evaluateGrants(entitlementGrants(subscriptions, options)).entitlements;
}
export function emptySnapshot(subject: BillingSubject, options: ResolvedPaymentsOptions): BillingSnapshot { return { subject, provider: 'stripe', mode: options.mode, revision: 0, customer: null, subscriptions: [], invoices: [], payments: [], entitlements: {}, reconciledAt: null, stale: true, policyVersion: options.policyVersion, entitlementsValidUntil: null }; }
