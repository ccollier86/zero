/** Square implementation of the unchanged current-subject payments facade. Provider/customer selectors and arbitrary amounts are not accepted here. */
import type { Square } from 'square';
import type { BillingPageQuery, RefundRequest, ScopedPayments, SubscriptionChange, PaymentsAuthority } from '@zero/framework/payments';
import type { SquarePayments } from './service';
import { snapshotInput, operationId } from '../validation';
import { billingSubject, guard } from '../authority';
import { PaymentsError, invalid } from '../errors';
import { squareId } from './options';
import { squareOffer } from './catalog';
import { squareCheckout, readSquareCheckout, type SquareCheckoutIntent } from './checkout';
import { invoiceView, money, paymentView, providerInvalid, refundView, subscriptionView } from './models';
import { squareWireKey } from './transport';

export const unsupported = (feature: string): never => { throw new PaymentsError(`Square does not provide the requested ${feature} semantics. Check status().capabilities.`, 'PAYMENTS_CAPABILITY_UNSUPPORTED', 501); };
export function createScopedSquarePayments(service: SquarePayments, authority: PaymentsAuthority): ScopedPayments {
  const customer = (subject: import('@zero/framework/payments').BillingSubject) => { const id = service.store.customer(subject); if (!id) throw new PaymentsError('Create a billing customer first.', 'PAYMENTS_CUSTOMER_UNBOUND', 409); return id; };
  const page = <T, V>(subject: import('@zero/framework/payments').BillingSubject, kind: string, query: BillingPageQuery, map: (value: T) => V) => {
    const result = service.resources.page<T>(subject, kind, query); return { items: result.items.map(row => map(row.data!)), ...(result.next ? { next: result.next } : {}) };
  };
  return {
    status: () => { service.assertOpen(); guardSync(); return service.status(); },
    catalog: () => service.read(authority, 'read', async () => { const offers = []; for (const id of service.options.offers.keys()) offers.push((await squareOffer(service, id)).projection); return offers; }),
    snapshot: () => service.read(authority, 'read', subject => service.snapshot(subject)),
    operations: { read: id => { operationId(id); return service.read(authority, 'read', subject => service.store.operation(subject, id)); } },
    customers: { ensure: request => { const input = snapshotInput(request, ['operationId']); return service.command(authority, 'manage', input.operationId, { type: 'customer.ensure' }, async subject => ({ id: await service.ensureCustomer(subject) })); } },
    checkout: {
      create: request => { const input = snapshotInput(request, ['operationId', 'offer', 'quantity']); return service.command(authority, 'manage', input.operationId, { ...input, type: 'checkout.create' }, async (subject, key) => {
        if (service.options.acceptingSales === false) throw new PaymentsError('New sales are disabled.', 'PAYMENTS_SALES_DISABLED', 409);
        await service.ensureCustomer(subject);
        const saved = service.store.providerRequest<SquareCheckoutIntent>(key, 'checkout.create');
        if (saved) { await guard(authority, service.options, 'manage'); return squareCheckout(service, subject, key, saved); }
        const selected = await squareOffer(service, input.offer, input.quantity);
        await guard(authority, service.options, 'manage');
        return squareCheckout(service, subject, key, { operationId: input.operationId, description: selected.offer.label, amount: selected.price.amount * selected.quantity, currency: selected.price.currency, quantity: selected.quantity,
          offer: selected.offer.id, ...(selected.offer.kind === 'payment' ? { itemVariationId: selected.offer.itemVariationId } : { planVariationId: selected.offer.planVariationId }) });
      }); },
      read: id => service.read(authority, 'read', async subject => { squareId(id); await service.verifyMerchant(); return readSquareCheckout(service, subject, id); }),
    },
    portal: { create: request => { const input = snapshotInput(request, ['operationId']); return service.command(authority, 'manage', input.operationId, { type: 'portal.create' }, async () => { if (!service.options.portalUrl) return unsupported('hosted customer portal'); return { url: service.options.portalUrl }; }); } },
    subscriptions: {
      list: () => service.read(authority, 'read', subject => service.snapshot(subject).subscriptions),
      preview: request => { snapshotInput(request, ['subscriptionId', 'offer', 'quantity', 'proration', 'prorationDate']); return service.read(authority, 'manage', () => unsupported('Stripe-style proration/invoice preview')); },
      change: request => { const input = snapshotInput(request, ['operationId', 'subscriptionId', 'offer', 'quantity', 'proration', 'paymentBehavior', 'prorationDate']);
        return service.command(authority, 'manage', input.operationId, { ...input, type: 'subscription.change' }, (subject, key) => service.withResource('subscription:' + squareId(input.subscriptionId), async () => {
          if (service.options.acceptingSales === false) throw new PaymentsError('New sales are disabled.', 'PAYMENTS_SALES_DISABLED', 409);
          if (input.proration !== 'none' || input.paymentBehavior !== 'error_if_incomplete' || input.prorationDate !== undefined) return unsupported('immediate/prorated subscription change');
          const desired = await service.parameters(key, 'subscription.change', async () => {
            const selected = await squareOffer(service, input.offer, input.quantity); if (selected.offer.kind !== 'subscription') invalid('Choose a subscription offer.');
            return { planVariationId: selected.offer.planVariationId };
          });
          const current = (await service.ownership.require<Square.Subscription>(subject, 'subscription', squareId(input.subscriptionId))).data!;
          if (current.status !== 'ACTIVE') throw new PaymentsError('Only active subscriptions can change plans.', 'PAYMENTS_SUBSCRIPTION_STATE', 409);
          const pending = current.actions?.filter(action => action.type === 'SWAP_PLAN') ?? [];
          if (current.planVariationId !== desired.planVariationId && !pending.some(action => action.newPlanVariationId === desired.planVariationId)) {
            if (pending.length) throw new PaymentsError('Another plan change is pending.', 'PAYMENTS_SUBSCRIPTION_STATE', 409);
            await guard(authority, service.options, 'manage'); await service.native.subscriptions.swapPlan({ subscriptionId: current.id!, newPlanVariationId: desired.planVariationId });
          }
          const updated = (await service.ownership.require<Square.Subscription>(subject, 'subscription', current.id!)).data!;
          service.enqueue(customer(subject)); return subscriptionView(updated, service.options, service.timezone);
        })); },
      cancel: request => { const input = snapshotInput(request, ['operationId', 'subscriptionId', 'timing']); return service.command(authority, 'manage', input.operationId, { ...input, type: 'subscription.cancel' }, subject => service.withResource('subscription:' + squareId(input.subscriptionId), async () => {
        if (!['period-end', 'immediate'].includes(input.timing)) invalid('Cancellation timing must be period-end or immediate.');
        if (input.timing === 'immediate') return unsupported('immediate cancellation');
        const current = (await service.ownership.require<Square.Subscription>(subject, 'subscription', squareId(input.subscriptionId))).data!;
        if (current.status !== 'CANCELED' && !current.canceledDate && !current.actions?.some(action => action.type === 'CANCEL')) { await guard(authority, service.options, 'manage'); await service.native.subscriptions.cancel({ subscriptionId: current.id! }); }
        const updated = (await service.ownership.require<Square.Subscription>(subject, 'subscription', current.id!)).data!; service.enqueue(customer(subject)); return subscriptionView(updated, service.options, service.timezone);
      })); },
      resume: request => { const input = snapshotInput(request, ['operationId', 'subscriptionId']); return service.command(authority, 'manage', input.operationId, { ...input, type: 'subscription.resume' }, (subject, key) => service.withResource('subscription:' + squareId(input.subscriptionId), async () => {
        const current = (await service.ownership.require<Square.Subscription>(subject, 'subscription', squareId(input.subscriptionId))).data!;
        if (current.status !== 'ACTIVE') throw new PaymentsError('Resume removes scheduled cancellation; it does not resurrect canceled subscriptions.', 'PAYMENTS_SUBSCRIPTION_STATE', 409);
        const captured = await service.parameters(key, 'subscription.resume', async () => {
          const actions = current.actions?.filter(action => action.type === 'CANCEL') ?? [];
          if (actions.length !== 1 || !actions[0]?.id) throw new PaymentsError('This subscription has no single scheduled cancellation.', 'PAYMENTS_SUBSCRIPTION_STATE', 409);
          return { actionId: actions[0].id };
        });
        if (current.actions?.some(action => action.id === captured.actionId)) { await guard(authority, service.options, 'manage'); await service.native.subscriptions.deleteAction({ subscriptionId: current.id!, actionId: captured.actionId }); }
        const updated = (await service.ownership.require<Square.Subscription>(subject, 'subscription', current.id!)).data!; service.enqueue(customer(subject)); return subscriptionView(updated, service.options, service.timezone);
      })); },
    },
    invoices: {
      list: (request = {}) => { const query = snapshotInput(request, ['limit', 'after']); return service.read(authority, 'read', subject => page<Square.Invoice, ReturnType<typeof invoiceView>>(subject, 'invoice', query, invoiceView)); },
      read: id => service.read(authority, 'read', async subject => { await service.verifyMerchant(); return invoiceView((await service.ownership.require<Square.Invoice>(subject, 'invoice', squareId(id))).data!); }),
      document: id => service.read(authority, 'read', async subject => { await service.verifyMerchant(); const invoice = (await service.ownership.require<Square.Invoice>(subject, 'invoice', squareId(id))).data!; return { hostedUrl: invoice.publicUrl ?? null, pdfUrl: null }; }),
    },
    payments: { list: (request = {}) => { const query = snapshotInput(request, ['limit', 'after']); return service.read(authority, 'read', subject => page<Square.Payment, ReturnType<typeof paymentView>>(subject, 'payment', query, paymentView)); } },
    refunds: {
      create: request => { const input = snapshotInput(request, ['operationId', 'paymentId', 'amount', 'reason']); return service.command(authority, 'refund', input.operationId, { ...input, type: 'refund.create' }, async (subject, key) => {
        const payment = (await service.ownership.require<Square.Payment>(subject, 'payment', squareId(input.paymentId))).data!;
        return refundSquarePayment(service, key, payment, input, subject, () => guard(authority, service.options, 'refund'));
      }); },
      list: request => { const input = snapshotInput(request, ['paymentId', 'limit', 'after']); return service.read(authority, 'read', async subject => {
        await service.verifyMerchant(); const payment = (await service.ownership.require<Square.Payment>(subject, 'payment', squareId(input.paymentId))).data!;
        for (const id of payment.refundIds ?? []) await service.ownership.refund(id);
        return page<Square.PaymentRefund, ReturnType<typeof refundView>>(subject, 'refund-of:' + input.paymentId, input, refundView);
      }); },
    },
    entitlements: { read: () => service.read(authority, 'read', subject => service.snapshot(subject).entitlements) },
    reconcile: () => service.read(authority, 'reconcile', subject => service.reconcileCustomer(customer(subject))),
    watch: options => service.watch(authority, options?.signal),
  };
  function guardSync() { billingSubject(authority, service.options, 'read'); }
}
export async function refundSquarePayment(service: SquarePayments, key: string, payment: Square.Payment, input: RefundRequest,
  owner: import('../store').BillingCommandOwner, assertAuthority?: () => Promise<unknown>) {
  if (input.reason !== undefined && !['requested_by_customer', 'duplicate', 'fraudulent'].includes(input.reason)) invalid('Invalid refund reason.');
  const parameters = await service.parameters(key, 'refund.create', async () => {
    const original = paymentView(payment), amount = input.amount ?? original.total.amount - original.refunded;
    if (original.status !== 'succeeded') throw new PaymentsError('The payment has not been captured and is not refundable.', 'PAYMENTS_REFUND_INVALID', 409);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > original.total.amount - original.refunded) invalid('Refund amount exceeds the remaining payment balance.');
    return { amount, currency: original.total.currency, paymentId: input.paymentId, reason: input.reason };
  });
  const intent = service.resources.intent(owner, key, input.operationId, { kind: 'refund', paymentId: parameters.paymentId, amount: parameters.amount, currency: parameters.currency });
  await assertAuthority?.();
  const refund = (await service.native.refunds.refundPayment({ idempotencyKey: squareWireKey(key), paymentId: parameters.paymentId, amountMoney: { amount: BigInt(parameters.amount), currency: parameters.currency.toUpperCase() as Square.Currency }, ...(parameters.reason ? { reason: parameters.reason } : {}) })).refund;
  if (!refund?.id || refund.paymentId !== input.paymentId) return providerInvalid();
  const projected = refundView(refund); if (projected.total.amount !== parameters.amount || projected.total.currency !== parameters.currency) return providerInvalid();
  // A trusted merchant can refund a subject-bound payment without reassigning it.
  const resourceOwner = service.resources.get('payment', input.paymentId)?.owner ?? owner;
  service.resources.bind(resourceOwner, 'refund', refund.id, refund, intent.reference); service.resources.bind(resourceOwner, 'refund-of:' + input.paymentId, refund.id, refund, intent.reference);
  if (owner.kind !== 'merchant') { const customerId = service.store.customer(owner); if (customerId) service.enqueue(customerId); }
  return projected;
}
