/** Closed current-subject facade. Every resource read is checked against its durable customer binding. */
import type Stripe from 'stripe';
import type { BillingPageQuery, BillingSubject, PaymentsAuthority, ScopedPayments, SubscriptionChange } from '@zero/framework/payments';
import type { StripePayments } from './service';
import { billingSubject, guard } from './authority';
import { PaymentsError, invalid } from './errors';
import { assertResource, invoiceView, paymentView, refundView, subscriptionView } from './projections';
import { publicOffers } from './options';
import { operationId, pageInput, resourceId, snapshotInput } from './validation';

export function createScopedPayments(service: StripePayments, authority: PaymentsAuthority): ScopedPayments {
  const options = service.options, stripe = service.native;
  const requireCustomer = (subject: BillingSubject) => service.requireCustomer(subject);
  const sale = () => { if (options.acceptingSales === false) throw new PaymentsError('New sales are currently disabled.', 'PAYMENTS_SALES_DISABLED', 409); };
  const offerFor = (id: string, quantity?: number, kind?: 'payment' | 'subscription') => {
    const offer = options.offers.get(id), count = quantity ?? offer?.quantity.min;
    if (!offer || kind && offer.kind !== kind || !Number.isInteger(count) || count! < offer.quantity.min || count! > offer.quantity.max) return invalid('Offer or quantity is not available.');
    return { offer, quantity: count! };
  };
  const priceFor = async (id: string, quantity?: number, kind?: 'payment' | 'subscription') => {
    const value = offerFor(id, quantity, kind);
    await service.verifyMerchant();
    const price = await stripe.prices.retrieve(value.offer.price);
    assertResource(price, null, options);
    if (!price.active || !!price.recurring !== (value.offer.kind === 'subscription')) throw new PaymentsError('Offer price is inactive or has the wrong billing type.', 'PAYMENTS_OFFER_UNAVAILABLE', 409);
    return { ...value, price };
  };
  const subscription = async (subject: BillingSubject, id: string) => {
    resourceId(id, 'sub'); await service.verifyMerchant();
    const value = await stripe.subscriptions.retrieve(id); assertResource(value, requireCustomer(subject), options); return value;
  };
  const invoice = async (subject: BillingSubject, id: string) => {
    resourceId(id, 'in'); await service.verifyMerchant();
    const value = await stripe.invoices.retrieve(id); assertResource(value, requireCustomer(subject), options); return value;
  };
  const payment = async (subject: BillingSubject, id: string) => {
    resourceId(id, 'pi'); await service.verifyMerchant();
    const value = await stripe.paymentIntents.retrieve(id, { expand: ['latest_charge'] }); assertResource(value, requireCustomer(subject), options); return value;
  };
  const prepareChange = async (subject: BillingSubject, input: Omit<SubscriptionChange, 'operationId' | 'paymentBehavior'>) => {
    if (!['create_prorations', 'always_invoice', 'none'].includes(input.proration) || input.prorationDate !== undefined && (!Number.isInteger(input.prorationDate) || input.prorationDate < 0 || input.prorationDate > Math.floor(Date.now() / 1000))) invalid('Choose an explicit proration policy and a valid preview timestamp.');
    const value = await subscription(subject, input.subscriptionId), { offer, quantity } = await priceFor(input.offer, input.quantity, 'subscription');
    if (value.items.has_more || value.items.data.length !== 1) throw new PaymentsError('Self-service changes require a single-item subscription. Use an explicit merchant workflow for bundles.', 'PAYMENTS_SUBSCRIPTION_COMPLEX', 409);
    if (!['active', 'trialing', 'past_due'].includes(value.status)) throw new PaymentsError('This subscription cannot be changed in its current state.', 'PAYMENTS_SUBSCRIPTION_STATE', 409);
    return { value, items: [{ id: value.items.data[0]!.id, price: offer.price, quantity }] };
  };
  const facade: ScopedPayments = {
    status() { service.assertOpen(); billingSubject(authority, options, 'read'); return service.status(); },
    catalog: () => service.read(authority, 'read', async () => {
      const result = [];
      for (const item of publicOffers(options)) { await authority.assertCurrentAuthority(); const { price } = await priceFor(item.id); result.push({ ...item, unitAmount: price.unit_amount, currency: price.currency, ...(price.recurring ? { interval: price.recurring.interval } : {}) }); }
      return result;
    }),
    snapshot: () => service.read(authority, 'read', subject => service.snapshot(subject)),
    operations: { read(id) { operationId(id); return service.read(authority, 'read', subject => service.store.operation(subject, id)); } },
    customers: { ensure(request) {
      const input = snapshotInput(request, ['operationId']);
      return service.command(authority, 'manage', input.operationId, { type: 'customer.ensure' }, async subject => ({ id: await service.ensureCustomer(subject, () => guard(authority, options, 'manage')) }));
    } },
    checkout: {
      create(request) {
        const input = snapshotInput(request, ['operationId', 'offer', 'quantity']);
        return service.command(authority, 'manage', input.operationId, { ...input, type: 'checkout.create' }, async (subject, key) => {
          sale();
          const params = await service.parameters<Stripe.Checkout.SessionCreateParams>(key, 'checkout.create', async () => {
            const selected = offerFor(input.offer, input.quantity);
            await priceFor(input.offer, input.quantity); const customer = await service.ensureCustomer(subject, () => guard(authority, options, 'manage'));
            const metadata = { zero_connection: options.connectionId, zero_offer: selected.offer.id, zero_policy: options.policyVersion };
            return { customer, mode: selected.offer.kind, line_items: [{ price: selected.offer.price, quantity: selected.quantity }], success_url: options.successUrl, cancel_url: options.cancelUrl, metadata,
              ...(selected.offer.kind === 'subscription' ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }) };
          });
          const customer = requireCustomer(subject);
          if (params.customer !== customer) throw new PaymentsError('Checkout customer binding changed during replay.', 'PAYMENTS_BINDING_CONFLICT', 409);
          await guard(authority, options, 'manage');
          const session = await stripe.checkout.sessions.create(params, { idempotencyKey: key });
          assertResource(session, customer, options);
          return { id: session.id, url: session.url, status: session.status };
        });
      },
      read(id) { resourceId(id, 'cs'); return service.read(authority, 'read', async subject => {
        await service.verifyMerchant(); const value = await stripe.checkout.sessions.retrieve(id); assertResource(value, requireCustomer(subject), options);
        return { id: value.id, status: value.status, paymentStatus: value.payment_status };
      }); },
    },
    portal: { create(request) {
      const input = snapshotInput(request, ['operationId']);
      return service.command(authority, 'manage', input.operationId, { type: 'portal.create' }, async (subject, key) => {
        const params = await service.parameters<Stripe.BillingPortal.SessionCreateParams>(key, 'portal.create', async () => ({ customer: requireCustomer(subject), return_url: options.portalReturnUrl }));
        if (params.customer !== requireCustomer(subject)) throw new PaymentsError('Portal customer binding changed during replay.', 'PAYMENTS_BINDING_CONFLICT', 409);
        const value = await stripe.billingPortal.sessions.create(params, { idempotencyKey: key }); return { url: value.url };
      });
    } },
    subscriptions: {
      list: () => service.read(authority, 'read', subject => service.snapshot(subject).subscriptions),
      preview(request) {
        const input = snapshotInput(request, ['subscriptionId', 'offer', 'quantity', 'proration', 'prorationDate']);
        return service.read(authority, 'manage', async subject => {
          const { items } = await prepareChange(subject, input), prorationDate = input.prorationDate ?? Math.floor(Date.now() / 1000);
          const value = await stripe.invoices.createPreview({ customer: requireCustomer(subject), subscription: input.subscriptionId, subscription_details: { items, proration_behavior: input.proration, ...(input.proration !== 'none' ? { proration_date: prorationDate } : {}) } });
          assertResource(value, requireCustomer(subject), options);
          return { total: { amount: value.total, currency: value.currency }, amountDue: { amount: value.amount_due, currency: value.currency }, prorationDate };
        });
      },
      change(request) {
        const input = snapshotInput(request, ['operationId', 'subscriptionId', 'offer', 'quantity', 'proration', 'paymentBehavior', 'prorationDate']);
        if (!['pending_if_incomplete', 'error_if_incomplete'].includes(input.paymentBehavior)) invalid('Choose an explicit subscription payment behavior.');
        return service.command(authority, 'manage', input.operationId, { ...input, type: 'subscription.change' }, async (subject, key) => {
          sale();
          const params = await service.parameters<Stripe.SubscriptionUpdateParams>(key, 'subscription.change', async () => {
            const { items } = await prepareChange(subject, input);
            return { items, proration_behavior: input.proration, payment_behavior: input.paymentBehavior, ...(input.proration !== 'none' && input.prorationDate !== undefined ? { proration_date: input.prorationDate } : {}) };
          });
          await subscription(subject, input.subscriptionId); await guard(authority, options, 'manage');
          const value = await stripe.subscriptions.update(input.subscriptionId, params, { idempotencyKey: key });
          assertResource(value, requireCustomer(subject), options); service.enqueue(requireCustomer(subject)); return subscriptionView(value, options);
        });
      },
      cancel(request) {
        const input = snapshotInput(request, ['operationId', 'subscriptionId', 'timing']);
        if (!['immediate', 'period-end'].includes(input.timing)) invalid('Choose immediate or period-end cancellation.');
        return service.command(authority, 'manage', input.operationId, { ...input, type: 'subscription.cancel' }, async (subject, key) => {
          const current = await subscription(subject, input.subscriptionId); await guard(authority, options, 'manage');
          const value = current.status === 'canceled' ? current : input.timing === 'immediate'
            ? await stripe.subscriptions.cancel(input.subscriptionId, { prorate: false, invoice_now: false })
            : await stripe.subscriptions.update(input.subscriptionId, { cancel_at_period_end: true }, { idempotencyKey: key });
          assertResource(value, requireCustomer(subject), options); service.enqueue(requireCustomer(subject)); return subscriptionView(value, options);
        });
      },
      resume(request) {
        const input = snapshotInput(request, ['operationId', 'subscriptionId']);
        return service.command(authority, 'manage', input.operationId, { ...input, type: 'subscription.resume' }, async (subject, key) => {
          const current = await subscription(subject, input.subscriptionId);
          const params = await service.parameters<Stripe.SubscriptionUpdateParams>(key, 'subscription.resume', async () => {
            if (!['active', 'trialing'].includes(current.status)) throw new PaymentsError('Only scheduled cancellations on active/trialing subscriptions can be resumed here.', 'PAYMENTS_SUBSCRIPTION_STATE', 409);
            return { cancel_at_period_end: false };
          });
          await guard(authority, options, 'manage');
          const value = await stripe.subscriptions.update(input.subscriptionId, params, { idempotencyKey: key });
          assertResource(value, requireCustomer(subject), options); service.enqueue(requireCustomer(subject)); return subscriptionView(value, options);
        });
      },
    },
    invoices: {
      list(request: BillingPageQuery = {}) {
        const query = snapshotInput(request, ['limit', 'after']), page = pageInput(query);
        return service.read(authority, 'read', async subject => {
          await service.verifyMerchant(); if (query.after) await invoice(subject, query.after);
          const value = await stripe.invoices.list({ customer: requireCustomer(subject), ...page }); value.data.forEach(row => assertResource(row, requireCustomer(subject), options));
          return { items: value.data.map(invoiceView), ...(value.has_more && value.data.length ? { next: value.data.at(-1)!.id } : {}) };
        });
      },
      read: id => service.read(authority, 'read', async subject => invoiceView(await invoice(subject, id))),
      document: id => service.read(authority, 'read', async subject => { const value = await invoice(subject, id); return { hostedUrl: value.hosted_invoice_url ?? null, pdfUrl: value.invoice_pdf ?? null }; }),
    },
    payments: { list(request: BillingPageQuery = {}) {
      const query = snapshotInput(request, ['limit', 'after']), page = pageInput(query);
      return service.read(authority, 'read', async subject => {
        await service.verifyMerchant(); if (query.after) await payment(subject, query.after);
        const value = await stripe.paymentIntents.list({ customer: requireCustomer(subject), ...page, expand: ['data.latest_charge'] }); value.data.forEach(row => assertResource(row, requireCustomer(subject), options));
        return { items: value.data.map(paymentView), ...(value.has_more && value.data.length ? { next: value.data.at(-1)!.id } : {}) };
      });
    } },
    refunds: {
      create(request) {
        const input = snapshotInput(request, ['operationId', 'paymentId', 'amount', 'reason']); resourceId(input.paymentId, 'pi');
        if (input.amount !== undefined && (!Number.isSafeInteger(input.amount) || input.amount < 1) || input.reason !== undefined && !['requested_by_customer', 'duplicate', 'fraudulent'].includes(input.reason)) invalid('Refund amount/reason is invalid. Amounts are integer minor currency units.');
        return service.command(authority, 'refund', input.operationId, { ...input, type: 'refund.create' }, async (subject, key) => {
          const current = await payment(subject, input.paymentId);
          const params = await service.parameters<Stripe.RefundCreateParams>(key, 'refund.create', async () => {
            const view = paymentView(current), remaining = current.amount_received - view.refunded;
            if (current.status !== 'succeeded' || remaining <= 0 || input.amount !== undefined && input.amount > remaining) throw new PaymentsError('Refund exceeds the refundable payment balance.', 'PAYMENTS_REFUND_INVALID', 409);
            return { payment_intent: input.paymentId, ...(input.amount !== undefined ? { amount: input.amount } : {}), ...(input.reason ? { reason: input.reason } : {}) };
          });
          await guard(authority, options, 'refund');
          const value = await stripe.refunds.create(params, { idempotencyKey: key });
          if (value.payment_intent !== input.paymentId && (value.payment_intent as Stripe.PaymentIntent | null)?.id !== input.paymentId) throw new PaymentsError('Refund payment did not match its command.', 'PAYMENTS_RESOURCE_FORBIDDEN', 403);
          service.enqueue(requireCustomer(subject)); return refundView(value);
        });
      },
      list(request) {
        const input = snapshotInput(request, ['paymentId', 'limit', 'after']), page = pageInput(input);
        return service.read(authority, 'read', async subject => {
          await payment(subject, input.paymentId);
          if (input.after) { resourceId(input.after, 're'); const prior = await stripe.refunds.retrieve(input.after); if (refundView(prior).paymentId !== input.paymentId) throw new PaymentsError('Refund cursor is outside this payment.', 'PAYMENTS_RESOURCE_FORBIDDEN', 403); }
          const value = await stripe.refunds.list({ payment_intent: input.paymentId, ...page });
          if (value.data.some(row => refundView(row).paymentId !== input.paymentId)) throw new PaymentsError('Refund is outside this payment.', 'PAYMENTS_RESOURCE_FORBIDDEN', 403);
          return { items: value.data.map(refundView), ...(value.has_more && value.data.length ? { next: value.data.at(-1)!.id } : {}) };
        });
      },
    },
    entitlements: { read: () => service.read(authority, 'read', subject => service.snapshot(subject).entitlements) },
    reconcile: () => service.read(authority, 'reconcile', async subject => service.reconcileCustomer(requireCustomer(subject))),
    watch: input => service.watch(authority, input?.signal),
  };
  for (const value of Object.values(facade)) if (value && typeof value === 'object') Object.freeze(value);
  return Object.freeze(facade);
}
