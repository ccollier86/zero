/** Bounded canonical Square reconciliation. Only a complete subscription/paid-invoice set can publish grants; UI views use the shared reactive SYSTEM store. */
import type { Square } from 'square';
import { SquareError } from 'square';
import type { BillingSnapshot, BillingSubject } from '@zero/framework/payments';
import type { SquarePayments } from './service';
import { PaymentsError } from '../errors';
import { evaluateGrants, type EntitlementGrant } from '../entitlements';
import { canonical } from '../store';
import { dayBoundary, invoiceView, paymentView, providerInvalid, subscriptionView } from './models';

export async function batch<T>(values: readonly T[], action: (value: T) => Promise<unknown>, width = 6): Promise<void> {
  for (let offset = 0; offset < values.length; offset += width) await Promise.all(values.slice(offset, offset + width).map(action));
}
export async function reconcileSquareCustomer(service: SquarePayments, customerId: string): Promise<BillingSnapshot> {
  await service.verifyMerchant(); const subject = service.store.owner(customerId);
  if (!subject) throw new PaymentsError('Square customer is not bound to a Zero billing subject.', 'PAYMENTS_CUSTOMER_UNBOUND', 409);
  const lock = service.store.lock('customer:' + customerId); if (!lock) throw new PaymentsError('Square reconciliation is already active.', 'PAYMENTS_RECONCILE_BUSY', 409);
  const heartbeat = setInterval(() => { try { service.store.renew(lock); } catch {} }, 30000); heartbeat.unref?.();
  try {
    let customer: Square.Customer | undefined;
    try { customer = (await service.native.customers.get({ customerId })).customer; }
    catch (error) {
      if (!(error instanceof SquareError) || error.statusCode !== 404) throw error;
      const prior = service.snapshot(subject);
      service.store.renew(lock);
      service.store.writeView(subject, { ...prior, customer: null, entitlements: {}, entitlementsValidUntil: null, _grants: [], stale: false,
        error: 'PAYMENTS_CUSTOMER_DELETED', policyVersion: service.options.policyVersion, reconciledAt: new Date().toISOString() }, lock, !!service.options.onChange, service.options.maxProjectionAgeMs / 2);
      return service.snapshot(subject);
    }
    if (customer?.id !== customerId) return providerInvalid();
    await service.ownership.discoverSubscriptions(customerId);
    // Explicit checkout proofs can own subscriptions whose provider-chosen buyer
    // customer differs from the deliberately separate Zero customer binding.
    const subscriptions = service.resources.all<Square.Subscription>(subject, 'subscription');
    await batch(subscriptions, row => service.ownership.require(subject, 'subscription', row.id));
    const freshInvoices = new Set<string>(), freshOrders = new Set<string>();
    {
      const response = await service.native.invoices.search({ query: { filter: { locationIds: [service.options.locationId], customerIds: [customerId] }, sort: { field: 'INVOICE_SORT_DATE', order: 'DESC' } }, limit: 100 });
      for (const invoice of response.invoices ?? []) {
        if (invoice.primaryRecipient?.customerId !== customerId) return providerInvalid();
        await service.ownership.acceptInvoice(invoice);
        if (invoice.id) freshInvoices.add(invoice.id);
      }
    }
    // Every current subscription's newest invoice is verified even when it is
    // outside the recent-history page. Lifetime history never truncates grants.
    const needed = new Set(service.resources.all<Square.Subscription>(subject, 'subscription').map(row => row.data?.invoiceIds?.[0]).filter((id): id is string => !!id));
    await batch([...needed].filter(id => !freshInvoices.has(id)), id => service.ownership.require(subject, 'invoice', id));
    {
      const response = await service.native.orders.search({ locationIds: [service.options.locationId], query: { filter: { customerFilter: { customerIds: [customerId] } }, sort: { sortField: 'CREATED_AT', sortOrder: 'DESC' } }, limit: 100 });
      for (const order of response.orders ?? []) {
        if (!order.id || order.customerId !== customerId || order.locationId !== service.options.locationId) return providerInvalid();
        const proven = await service.ownership.order(order.id);
        if (proven && canonical(proven.owner) === canonical(subject)) freshOrders.add(order.id);
      }
    }
    const orders = service.resources.recent<Square.Order>(subject, 'order', 100, undefined, true);
    await batch(orders, async row => {
      const current = freshOrders.has(row.id) ? row : await service.ownership.require<Square.Order>(subject, 'order', row.id);
      for (const tender of current.data?.tenders ?? []) if (tender.paymentId) service.resources.bind(subject, 'payment', tender.paymentId, null, current.reference);
    });
    const payments = service.resources.recent<Square.Payment>(subject, 'payment', 100, undefined, true);
    await batch(payments, row => service.ownership.require(subject, 'payment', row.id));
    const latestSubscriptions = service.resources.all<Square.Subscription>(subject, 'subscription').map(row => row.data!).filter(Boolean);
    const invoices = service.resources.recent<Square.Invoice>(subject, 'invoice').map(row => row.data!);
    const invoiceById = new Map([...needed].map(id => [id, service.resources.get<Square.Invoice>('invoice', id)?.data]));
    const grants: EntitlementGrant[] = [];
    for (const subscription of latestSubscriptions) {
      const invoice = subscription.invoiceIds?.[0] ? invoiceById.get(subscription.invoiceIds[0]) : undefined;
      // ACTIVE is not proof of payment; charged_through_date is only the date
      // invoiced. The exact most recent canonical invoice must actually be PAID.
      if (subscription.status !== 'ACTIVE' || invoice?.status !== 'PAID') continue;
      const offer = [...service.options.offers.values()].find(item => item.kind === 'subscription' && item.planVariationId === subscription.planVariationId);
      const end = dayBoundary(subscription.chargedThroughDate, subscription.timezone ?? service.timezone, true), canceled = dayBoundary(subscription.canceledDate, subscription.timezone ?? service.timezone);
      const expiresAt = end === null ? null : canceled === null ? end : Math.min(end, canceled);
      if (!offer || expiresAt === null || expiresAt <= Date.now() / 1000) continue;
      for (const [feature, value] of Object.entries(offer.features)) grants.push({ feature, value, expiresAt });
    }
    const evaluated = evaluateGrants(grants);
    const snapshot = { subject, provider: 'square' as const, mode: service.options.mode, revision: 0,
      customer: { id: customerId, ...(customer.emailAddress ? { email: customer.emailAddress } : {}), ...((customer.givenName || customer.familyName) ? { name: [customer.givenName, customer.familyName].filter(Boolean).join(' ') } : {}) },
      subscriptions: latestSubscriptions.map(value => subscriptionView(value, service.options, service.timezone)),
      invoices: invoices.map(invoiceView).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).slice(0, 20),
      payments: service.resources.recent<Square.Payment>(subject, 'payment', 20).map(row => paymentView(row.data!)),
      entitlements: evaluated.entitlements, _grants: grants, reconciledAt: new Date().toISOString(), stale: false, policyVersion: service.options.policyVersion, entitlementsValidUntil: evaluated.validUntil };
    service.store.renew(lock); service.store.writeView(subject, snapshot, lock, !!service.options.onChange, Math.min(service.options.maxProjectionAgeMs / 2, evaluated.validUntil === null ? Infinity : Math.max(1000, evaluated.validUntil * 1000 - Date.now())));
    return service.snapshot(subject);
  } finally { clearInterval(heartbeat); service.store.release(lock); }
}
