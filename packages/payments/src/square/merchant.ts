/** Subjectless custom-amount Square payments. This capability is only returned to trusted server composition, never the browser billing facade. */
import type { MerchantPayments } from '@zero/framework/payments';
import type { Square } from 'square';
import type { SquarePayments } from './service';
import { merchantInput } from '../merchant-input';
import { snapshotInput, operationId } from '../validation';
import { squareId } from './options';
import { squareWireKey } from './transport';
import { paymentView, providerInvalid } from './models';
import { PaymentsError } from '../errors';
import { squareCheckout, readSquareCheckout } from './checkout';
import { refundSquarePayment } from './scoped';
export function createSquareMerchantCharges(service: SquarePayments): MerchantPayments {
  const owner = { kind: 'merchant' as const, id: service.options.merchantId };
  const payment = async (id: string) => {
    const value = (await service.native.payments.get({ paymentId: squareId(id) })).payment;
    if (!value || value.locationId !== service.options.locationId) throw new PaymentsError('Payment is outside this Square location.', 'PAYMENTS_RESOURCE_FORBIDDEN', 403);
    return value;
  };
  return {
    operations: { read: async id => { operationId(id); service.assertOpen(); return service.store.operation(owner, id, 'merchant'); } },
    create: async request => {
      const input = merchantInput(request, true);
      if (input.paymentToken.toUpperCase() === 'EXTERNAL') throw new PaymentsError('Recording an external payment is not a tokenized charge.', 'PAYMENTS_INPUT_INVALID');
      return service.merchantCommand(input.operationId, { ...input, type: 'merchant.charge' }, async (owner, key) => {
        if (service.options.acceptingSales === false) throw new PaymentsError('New sales are disabled.', 'PAYMENTS_SALES_DISABLED', 409);
        if (input.total.currency !== service.currency) throw new PaymentsError('Charge currency does not match this Square location.', 'PAYMENTS_INPUT_INVALID');
        const prepared = await service.parameters(key, 'merchant.charge', async () => input);
        const intent = service.resources.intent(owner, key, input.operationId, { kind: 'charge', amount: prepared.total.amount, currency: prepared.total.currency, ...(prepared.reference ? { reference: prepared.reference } : {}) });
        const value = (await service.native.payments.create({ idempotencyKey: squareWireKey(key), sourceId: prepared.paymentToken,
          amountMoney: { amount: BigInt(prepared.total.amount), currency: prepared.total.currency.toUpperCase() as Square.Currency }, locationId: service.options.locationId,
          autocomplete: true, referenceId: intent.reference, note: prepared.description, ...(prepared.verificationToken ? { verificationToken: prepared.verificationToken } : {}) })).payment;
        if (!value?.id || value.locationId !== service.options.locationId || value.referenceId !== intent.reference) return providerInvalid();
        const view = paymentView(value); if (view.total.amount !== prepared.total.amount || view.total.currency !== prepared.total.currency) return providerInvalid();
        service.resources.bind(owner, 'payment', value.id, value, intent.reference); return view;
      });
    },
    checkout: async request => { const input = merchantInput(request); return service.merchantCommand(input.operationId, { ...input, type: 'merchant.checkout' }, (owner, key) => squareCheckout(service, owner, key, { operationId: input.operationId, description: input.description, amount: input.total.amount, currency: input.total.currency, ...(input.reference ? { reference: input.reference } : {}) })); },
    read: id => service.merchantRead(async () => paymentView(await payment(id))),
    readCheckout: id => service.merchantRead(() => readSquareCheckout(service, owner, squareId(id))),
    refund: async request => { const input = snapshotInput(request, ['operationId', 'paymentId', 'amount', 'reason']); return service.merchantCommand(input.operationId, { ...input, type: 'merchant.refund' }, async (owner, key) => {
      const original = await payment(input.paymentId);
      // Trusted refunds may include payments created outside Zero. Never steal an existing subject's resource binding.
      if (!service.resources.get('payment', original.id!)) service.resources.bind(owner, 'payment', original.id!, original);
      return refundSquarePayment(service, key, original, input, owner);
    }); },
    clientAction: id => service.merchantRead(async () => { await payment(id); return null; }),
  };
}
