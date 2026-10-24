/** Trusted subjectless Stripe charges and hosted checkout. Persist only safe acknowledgements; never persist/stream a client secret or card data. */
import type Stripe from 'stripe';
import type { BillingEvent, MerchantPaymentEvent, MerchantPayments } from '@zero/framework/payments';
import type { StripePayments } from './service';
import { merchantInput } from './merchant-input';
import { snapshotInput, resourceId, operationId } from './validation';
import { assertResource, paymentView, refundView, stripeId } from './projections';
import { PaymentsError, invalid } from './errors';
import { safeReturnUrl } from './options';
import type { PaymentIntentRecord } from './resources';

export function createStripeMerchantCharges(service: StripePayments): MerchantPayments {
  const sale = () => { if (service.options.acceptingSales === false) throw new PaymentsError('New sales are disabled.', 'PAYMENTS_SALES_DISABLED', 409); };
  const payment = async (id: string) => { resourceId(id, 'pi'); const value = await service.native.paymentIntents.retrieve(id, { expand: ['latest_charge'] }); assertResource(value, null, service.options); return value; };
  return {
    operations: { read: async id => { operationId(id); service.assertOpen(); return service.store.operation({ kind: 'merchant', id: service.options.accountId }, id, 'merchant'); } },
    create: async request => {
      const input = merchantInput(request, true); if (!/^pm_[A-Za-z0-9]+$/.test(input.paymentToken) || input.verificationToken !== undefined) invalid('Stripe charges require a PaymentMethod token; Square verification tokens do not apply.');
      return service.merchantCommand(input.operationId, { ...input, type: 'merchant.charge' }, async (owner, key) => {
        sale(); const prepared = await service.parameters(key, 'merchant.charge', async () => input);
        const intent = service.resources.intent(owner, key, input.operationId, { kind: 'charge', amount: prepared.total.amount, currency: prepared.total.currency, ...(prepared.reference ? { reference: prepared.reference } : {}) });
        const value = await service.native.paymentIntents.create({ amount: prepared.total.amount, currency: prepared.total.currency, payment_method: prepared.paymentToken, confirm: true,
          automatic_payment_methods: { enabled: true, allow_redirects: 'never' }, description: prepared.description,
          metadata: { zero_connection: service.options.connectionId, zero_merchant_operation: intent.reference } }, { idempotencyKey: key });
        assertResource(value, null, service.options);
        if (value.amount !== prepared.total.amount || value.currency !== prepared.total.currency) throw new PaymentsError('Stripe changed the captured charge total.', 'PAYMENTS_PROVIDER_RESPONSE_INVALID', 503, 'unknown');
        service.resources.bind(owner, 'payment', value.id, { id: value.id }, intent.reference);
        return paymentView(value);
      });
    },
    checkout: async request => { const input = merchantInput(request); return service.merchantCommand(input.operationId, { ...input, type: 'merchant.checkout' }, async (owner, key) => {
      sale(); const prepared = await service.parameters(key, 'merchant.checkout', async () => input);
      const intent = service.resources.intent(owner, key, input.operationId, { kind: 'checkout', amount: prepared.total.amount, currency: prepared.total.currency, ...(prepared.reference ? { reference: prepared.reference } : {}) });
      const metadata = { zero_connection: service.options.connectionId, zero_merchant_operation: intent.reference };
      const value = await service.native.checkout.sessions.create({ mode: 'payment', success_url: service.options.successUrl, cancel_url: service.options.cancelUrl,
        line_items: [{ quantity: 1, price_data: { currency: prepared.total.currency, unit_amount: prepared.total.amount, product_data: { name: prepared.description } } }], metadata, payment_intent_data: { metadata } }, { idempotencyKey: key });
      assertResource(value, null, service.options); if (value.url) safeReturnUrl(value.url);
      service.resources.bind(owner, 'checkout', value.id, { id: value.id }, intent.reference);
      return { id: value.id, url: value.url, status: value.status };
    }); },
    read: id => service.merchantRead(async () => paymentView(await payment(id))),
    readCheckout: id => service.merchantRead(async () => { resourceId(id, 'cs'); const value = await service.native.checkout.sessions.retrieve(id); assertResource(value, null, service.options); return { id: value.id, status: value.status, paymentStatus: value.payment_status }; }),
    refund: async request => {
      const input = snapshotInput(request, ['operationId', 'paymentId', 'amount', 'reason']); resourceId(input.paymentId, 'pi');
      if (input.reason !== undefined && !['requested_by_customer', 'duplicate', 'fraudulent'].includes(input.reason)) invalid('Invalid refund reason.');
      return service.merchantCommand(input.operationId, { ...input, type: 'merchant.refund' }, async (owner, key) => {
        const prepared = await service.parameters(key, 'merchant.refund', async () => {
          const original = paymentView(await payment(input.paymentId)), amount = input.amount ?? original.total.amount - original.refunded;
          if (!Number.isSafeInteger(amount) || amount < 1 || amount > original.total.amount - original.refunded) invalid('Refund amount exceeds the remaining balance.');
          return { paymentId: input.paymentId, amount, currency: original.total.currency, reason: input.reason };
        });
        const intent = service.resources.intent(owner, key, input.operationId, { kind: 'refund', paymentId: prepared.paymentId, amount: prepared.amount, currency: prepared.currency });
        const value = await service.native.refunds.create({ payment_intent: prepared.paymentId, amount: prepared.amount, ...(prepared.reason ? { reason: prepared.reason } : {}),
          metadata: { zero_connection: service.options.connectionId, zero_merchant_operation: intent.reference } }, { idempotencyKey: key });
        if (stripeId(value.payment_intent) !== prepared.paymentId) throw new PaymentsError('Stripe refund parent changed.', 'PAYMENTS_RESOURCE_FORBIDDEN', 403, 'unknown');
        service.resources.bind(owner, 'refund', value.id, { id: value.id }, intent.reference); return refundView(value);
      });
    },
    clientAction: id => service.merchantRead(async () => { const value = await payment(id); return ['requires_action', 'requires_confirmation', 'requires_payment_method'].includes(value.status) && value.client_secret ? { provider: 'stripe' as const, clientSecret: value.client_secret } : null; }),
  };
}

/** Canonical merchant-only event projection. Signed metadata is only a lookup hint; an admitted local intent and live provider object must agree. */
export async function stripeMerchantEvent(service: StripePayments, event: Stripe.Event): Promise<MerchantPaymentEvent | null> {
  const object = event.data.object as unknown as { id: string; object: string; metadata?: Stripe.Metadata; payment_intent?: string | { id: string }; charge?: string | { id: string } };
  const kind = object.object === 'payment_intent' ? 'payment' : object.object === 'checkout.session' ? 'checkout' : object.object;
  const candidate = object.metadata?.zero_connection === service.options.connectionId && object.metadata.zero_merchant_operation
    ? service.resources.getIntent(object.metadata.zero_merchant_operation) : null;
  const existing = service.resources.get(kind, object.id);
  const parentId = stripeId(object.payment_intent), parentRecord = parentId ? service.resources.get('payment', parentId) : null;
  if (candidate?.owner.kind !== 'merchant' && existing?.owner.kind !== 'merchant' && parentRecord?.owner.kind !== 'merchant') return null;
  let intent: PaymentIntentRecord | null = null, resource: BillingEvent['resource'] | null = null;
  const find = (kind: string, id: string, metadata: Stripe.Metadata | null | undefined) => {
    const existing = service.resources.get(kind, id);
    const reference = existing?.owner.kind === 'merchant' ? existing.reference : metadata?.zero_connection === service.options.connectionId ? metadata.zero_merchant_operation : null;
    const candidate = reference ? service.resources.getIntent(reference) : null;
    return candidate?.owner.kind === 'merchant' ? candidate : null;
  };
  const parent = async (id: string) => {
    const value = await service.native.paymentIntents.retrieve(id, { expand: ['latest_charge'] }); assertResource(value, null, service.options);
    const found = find('payment', value.id, value.metadata);
    if (!found || !['charge', 'checkout'].includes(String(found.details.kind)) || found.details.amount !== value.amount || found.details.currency !== value.currency) return null;
    service.resources.bind(found.owner, 'payment', value.id, { id: value.id }, found.reference); return { value, intent: found };
  };
  if (object.object === 'payment_intent') {
    const resolved = await parent(object.id); if (resolved) { intent = resolved.intent; const value = paymentView(resolved.value); resource = { id: value.id, kind: 'payment_intent', status: value.status, total: value.total, paymentStatus: value.status === 'succeeded' ? 'paid' : 'unpaid' }; }
  } else if (object.object === 'checkout.session') {
    const value = await service.native.checkout.sessions.retrieve(object.id); assertResource(value, null, service.options); intent = find('checkout', value.id, value.metadata);
    if (intent && (intent.details.amount !== value.amount_total || intent.details.currency !== value.currency)) throw new PaymentsError('Checkout total differs from its captured merchant intent.', 'PAYMENTS_RESOURCE_FORBIDDEN', 403);
    if (intent) resource = { id: value.id, kind: 'checkout.session', status: value.status, paymentStatus: value.payment_status, total: { amount: value.amount_total!, currency: value.currency! } };
  } else if (object.object === 'refund') {
    const value = await service.native.refunds.retrieve(object.id), id = stripeId(value.payment_intent); if (!id) return null;
    const refundIntent = find('refund', value.id, value.metadata);
    if (refundIntent?.details.kind === 'refund') {
      assertResource(await service.native.paymentIntents.retrieve(id), null, service.options); intent = refundIntent;
    } else { const resolved = await parent(id); if (!resolved) return null; intent = resolved.intent; }
    if (intent.details.kind === 'refund' && (intent.details.paymentId !== id || intent.details.amount !== value.amount || intent.details.currency !== value.currency)) throw new PaymentsError('Refund differs from its captured merchant intent.', 'PAYMENTS_RESOURCE_FORBIDDEN', 403);
    const projected = refundView(value); resource = { id: value.id, kind: 'refund', status: projected.status, total: projected.total };
  } else if (object.object === 'charge' && stripeId(object.payment_intent)) {
    const value = await service.native.charges.retrieve(object.id); assertResource(value, null, service.options);
    const id = stripeId(value.payment_intent); const resolved = id ? await parent(id) : null;
    if (resolved) { intent = resolved.intent; resource = { id: value.id, kind: 'charge', status: value.status, total: { amount: value.amount, currency: value.currency } }; }
  }
  return intent && resource ? { eventId: event.id, type: event.type, provider: 'stripe', providerCreatedAt: event.created, operationId: intent.operationId,
    ...(typeof intent.details.reference === 'string' ? { reference: intent.details.reference } : {}), resource } : null;
}
