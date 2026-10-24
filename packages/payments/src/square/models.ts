/** Canonical Square-to-Zero projections. Big integers, calendar boundaries and paid entitlement evidence remain explicit. */
import type { Square } from 'square';
import type { BillingInvoice, BillingPayment, BillingRefund, BillingSubscription, Money } from '@zero/framework/payments';
import { PaymentsError } from '../errors';
import type { ResolvedSquareOptions } from './options';
export function providerInvalid(): never { throw new PaymentsError('Square returned incomplete or inconsistent billing state.', 'PAYMENTS_PROVIDER_RESPONSE_INVALID', 503); }
export function integer(value: bigint | number | string | null | undefined): number {
  if (value == null || value === '' || typeof value === 'string' && !/^-?\d+$/.test(value)) return providerInvalid();
  const number = Number(value); if (!Number.isSafeInteger(number)) return providerInvalid(); return number;
}
export function money(value: Square.Money | undefined): Money {
  if (!value || typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency)) return providerInvalid();
  return { amount: integer(value.amount), currency: value.currency.toLowerCase() };
}
export function timestamp(value: string | undefined): number {
  const ms = value ? Date.parse(value) : NaN; if (!Number.isFinite(ms)) return providerInvalid(); return Math.floor(ms / 1000);
}
/** Resolve actual IANA local midnight, including DST. Missing/ambiguous calendar evidence never extends a grant. */
export function dayBoundary(value: string | undefined | null, zone = 'UTC', followingDay = false): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(value + 'T00:00:00Z'); if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) return null;
  const target = parsed + (followingDay ? 86400000 : 0);
  try {
    const format = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    let guess = target;
    for (let i = 0; i < 4; i++) {
      const fields = Object.fromEntries(format.formatToParts(guess).map(part => [part.type, part.value]));
      const local = Date.UTC(+fields.year!, +fields.month! - 1, +fields.day!, +fields.hour!, +fields.minute!, +fields.second!);
      if (local === target) return Math.floor(guess / 1000);
      guess -= local - target;
    }
  } catch { /* Unknown zones or impossible midnight fail closed. */ }
  return null;
}
export function paymentView(value: Square.Payment): BillingPayment {
  if (!value.id || !value.status) return providerInvalid();
  const statuses: Record<string, string> = { COMPLETED: 'succeeded', APPROVED: 'requires_capture', PENDING: 'processing', CANCELED: 'canceled', FAILED: 'failed' };
  return { id: value.id, status: statuses[value.status] ?? value.status.toLowerCase(), total: money(value.totalMoney ?? value.amountMoney), refunded: value.refundedMoney ? integer(value.refundedMoney.amount) : 0, createdAt: timestamp(value.createdAt) };
}
export function refundView(value: Square.PaymentRefund): BillingRefund {
  if (!value.id || !value.paymentId) return providerInvalid();
  return { id: value.id, paymentId: value.paymentId, status: value.status === 'COMPLETED' ? 'succeeded' : value.status?.toLowerCase() ?? null, total: money(value.amountMoney), createdAt: timestamp(value.createdAt) };
}
export function invoiceView(value: Square.Invoice): BillingInvoice {
  if (!value.id || !value.status || !value.paymentRequests?.length) return providerInvalid();
  const amounts = value.paymentRequests.map(request => money(request.computedAmountMoney));
  if (amounts.some(item => item.currency !== amounts[0]!.currency)) return providerInvalid();
  const total = amounts.reduce((sum, item) => sum + item.amount, 0); if (!Number.isSafeInteger(total)) return providerInvalid();
  return { id: value.id, number: value.invoiceNumber ?? null, status: value.status === 'PAID' ? 'paid' : value.status === 'CANCELED' ? 'void' : value.status.toLowerCase(), total: { amount: total, currency: amounts[0]!.currency }, paid: value.status === 'PAID', createdAt: timestamp(value.createdAt), dueAt: dayBoundary(value.paymentRequests[0]?.dueDate, value.timezone) };
}
export function subscriptionView(value: Square.Subscription, options: ResolvedSquareOptions, timezone: string): BillingSubscription {
  if (!value.id || !value.status) return providerInvalid();
  const offer = [...options.offers.values()].find(item => item.kind === 'subscription' && item.planVariationId === value.planVariationId);
  const pending = value.actions?.find(action => action.type === 'SWAP_PLAN');
  const next = pending ? [...options.offers.values()].find(item => item.kind === 'subscription' && item.planVariationId === pending.newPlanVariationId) : null;
  return { id: value.id, status: value.status === 'ACTIVE' ? 'active' : value.status === 'PENDING' ? 'incomplete' : value.status.toLowerCase(), offers: offer ? [offer.id] : [], quantity: 1,
    cancelAtPeriodEnd: Boolean(value.canceledDate || value.actions?.some(action => action.type === 'CANCEL')), cancelAt: dayBoundary(value.canceledDate, value.timezone ?? timezone),
    trialEnd: null, currentPeriodEnd: dayBoundary(value.chargedThroughDate, value.timezone ?? timezone, true),
    ...(pending ? { pendingChange: { offers: next ? [next.id] : [], effectiveAt: dayBoundary(pending.effectiveDate, value.timezone ?? timezone) } } : {}) };
}
