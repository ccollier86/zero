/** Canonical resource proofs for Square. Hosted checkout customer IDs are not account/user identity and are never auto-adopted. */
import type { Square, SquareClient } from 'square';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PaymentsStore, BillingCommandOwner } from '../store';
import { canonical } from '../store';
import type { PaymentsResources, PaymentResource } from '../resources';
import type { ResolvedSquareOptions } from './options';
import { squareId } from './options';
import { invoiceView, money, providerInvalid } from './models';
import { PaymentsError } from '../errors';
export class SquareOwnership {
  private readonly discoveringOrders = new AsyncLocalStorage<ReadonlySet<string>>();
  constructor(readonly native: SquareClient, readonly store: PaymentsStore, readonly resources: PaymentsResources, readonly options: ResolvedSquareOptions) {}
  private location(id: string | null | undefined): void { if (id !== this.options.locationId) throw new PaymentsError('Square resource is outside the configured location.', 'PAYMENTS_RESOURCE_FORBIDDEN', 403); }
  private save<T>(kind: string, id: string, owner: BillingCommandOwner, value: T, reference?: string | null): PaymentResource<T> {
    return this.resources.bind(owner, kind, id, value, reference ?? null);
  }
  /** Only explicit trusted adoption can import unrelated legacy resources by provider customer. Buyer contact selection is never identity. */
  private adopted(customerId: string | null | undefined) { return customerId ? this.resources.get('adopted-customer', customerId)?.owner : undefined; }
  async order(id: string): Promise<PaymentResource<Square.Order> | null> {
    const value = (await this.native.orders.get({ orderId: squareId(id) })).order; if (value?.id !== id) return providerInvalid(); this.location(value.locationId);
    const prior = this.resources.get<Square.Order>('order', id);
    let owner = prior?.owner, reference = prior?.reference;
    if (!owner && value.referenceId) {
      const intent = this.resources.getIntent(value.referenceId);
      if (intent) {
        if (!value.lineItems?.length || value.lineItems.length !== 1) return providerInvalid();
        const line = value.lineItems[0]!, amount = money(value.totalMoney), expected = intent.details;
        if (expected.amount !== amount.amount || expected.currency !== amount.currency || expected.itemVariationId && line.catalogObjectId !== expected.itemVariationId || expected.quantity !== undefined && line.quantity !== String(expected.quantity)) return providerInvalid();
        owner = intent.owner; reference = intent.reference;
      }
    }
    if (!owner && value.customerId) {
      const invoice = await this.invoiceForOrder(value.customerId, id); owner = invoice?.owner; reference = invoice?.reference;
    }
    owner ??= this.adopted(value.customerId);
    return owner ? this.save('order', id, owner, value, reference) : null;
  }
  async payment(id: string): Promise<PaymentResource<Square.Payment> | null> {
    const value = (await this.native.payments.get({ paymentId: squareId(id) })).payment; if (value?.id !== id) return providerInvalid(); this.location(value.locationId);
    const prior = this.resources.get<Square.Payment>('payment', id);
    let owner = prior?.owner, reference = prior?.reference;
    if (!owner && value.referenceId) {
      const intent = this.resources.getIntent(value.referenceId), total = money(value.totalMoney ?? value.amountMoney);
      if (intent && intent.details.kind === 'charge') {
        if (total.amount !== intent.details.amount || total.currency !== intent.details.currency) return providerInvalid();
        owner = intent.owner; reference = intent.reference;
      }
    }
    if (!owner && value.orderId) { const order = await this.order(value.orderId); owner = order?.owner; reference = order?.reference; }
    if (!owner && value.customerId && value.orderId) {
      const invoice = await this.invoiceForOrder(value.customerId, value.orderId); owner = invoice?.owner; reference = invoice?.reference;
    }
    owner ??= this.adopted(value.customerId);
    if (!owner) return null;
    const row = this.save('payment', id, owner, value, reference);
    if ((value.refundIds?.length ?? 0) > 1000) return providerInvalid();
    return row;
  }
  async subscription(id: string): Promise<PaymentResource<Square.Subscription> | null> {
    const value = (await this.native.subscriptions.get({ subscriptionId: squareId(id), include: 'actions' })).subscription; if (value?.id !== id) return providerInvalid();
    return this.acceptSubscription(value);
  }
  async acceptSubscription(value: Square.Subscription): Promise<PaymentResource<Square.Subscription> | null> {
    if (!value.id) return providerInvalid(); const id = value.id; this.location(value.locationId);
    const prior = this.resources.get<Square.Subscription>('subscription', id);
    let owner = prior?.owner, reference = prior?.reference;
    // Square also returns a legacy top-level template field for some STATIC
    // checkout subscriptions. SDK 46 passes it through without camel-casing.
    const legacy = value as Square.Subscription & { order_template_id?: unknown; orderTemplateId?: unknown };
    const templates = [...new Set([...(value.phases ?? []).map(phase => phase.orderTemplateId), legacy.order_template_id, legacy.orderTemplateId])].filter((id): id is string => typeof id === 'string' && !!id);
    if (!owner) for (const template of templates) {
      const order = await this.order(template), intent = order?.reference ? this.resources.getIntent(order.reference) : null;
      if (order && intent?.details.kind === 'subscription' && intent.details.planVariationId === value.planVariationId) { owner = order.owner; reference = order.reference; break; }
    }
    owner ??= this.adopted(value.customerId);
    if (!owner || owner.kind === 'merchant') return null;
    const row = this.save('subscription', id, owner, value, reference);
    if ((value.invoiceIds?.length ?? 0) > 1000) throw new PaymentsError('Subscription invoice history exceeded its bound.', 'PAYMENTS_RECONCILE_LIMIT', 503);
    if (value.invoiceIds?.[0]) this.resources.bind(owner, 'invoice', value.invoiceIds[0], null, reference);
    return row;
  }
  async discoverSubscriptions(customerId: string): Promise<PaymentResource<Square.Subscription>[]> {
    let cursor: string | undefined;
    const owned: PaymentResource<Square.Subscription>[] = [];
    for (let page = 0; page < 10; page++) {
      const response = await this.native.subscriptions.search({ query: { filter: { customerIds: [squareId(customerId)], locationIds: [this.options.locationId] } }, include: ['actions'], limit: 100, ...(cursor ? { cursor } : {}) });
      for (const item of response.subscriptions ?? []) { if (!item.id || item.customerId !== customerId) return providerInvalid(); const row = await this.acceptSubscription(item); if (row) owned.push(row); }
      if (!response.cursor) return owned; if (response.cursor === cursor) return providerInvalid(); cursor = response.cursor;
    }
    throw new PaymentsError('Subscription discovery exceeded its bounded page limit.', 'PAYMENTS_RECONCILE_LIMIT', 503);
  }
  async invoice(id: string): Promise<PaymentResource<Square.Invoice> | null> {
    const value = (await this.native.invoices.get({ invoiceId: squareId(id) })).invoice; if (value?.id !== id) return providerInvalid(); return this.acceptInvoice(value);
  }
  async acceptInvoice(value: Square.Invoice): Promise<PaymentResource<Square.Invoice> | null> {
    if (!value.id) return providerInvalid(); const id = value.id; this.location(value.locationId);
    let prior = this.resources.get<Square.Invoice>('invoice', id), owner = prior?.owner;
    if (!owner && value.primaryRecipient?.customerId) {
      // Canonical subscription phases prove the original checkout intent. An
      // identical buyer email/customer profile never grants access by itself.
      for (const sub of await this.discoverSubscriptions(value.primaryRecipient.customerId)) if (sub.data?.invoiceIds?.includes(id)) this.resources.bind(sub.owner, 'invoice', id, null, sub.reference);
      prior = this.resources.get('invoice', id); owner = prior?.owner;
    }
    let reference = prior?.reference;
    if (!owner && value.orderId) { const order = await this.order(value.orderId); owner = order?.owner; reference ??= order?.reference; }
    owner ??= this.adopted(value.primaryRecipient?.customerId);
    if (!owner || owner.kind === 'merchant') return null;
    const row = this.save('invoice', id, owner, value, reference);
    const intent = row.reference ? this.resources.getIntent(row.reference) : null;
    if (intent?.details.kind === 'subscription' && value.status === 'PAID') {
      const total = invoiceView(value).total;
      if (total.amount === intent.details.amount && total.currency === intent.details.currency) this.resources.bind(owner, 'settled-checkout', intent.reference, { invoiceId: id }, intent.reference);
    }
    if (value.orderId) this.resources.bind(owner, 'order', value.orderId, null, row.reference);
    return row;
  }
  async refund(id: string): Promise<PaymentResource<Square.PaymentRefund> | null> {
    const value = (await this.native.refunds.get({ refundId: squareId(id) })).refund; if (value?.id !== id || !value.paymentId) return providerInvalid();
    if (value.locationId) this.location(value.locationId);
    const payment = await this.payment(value.paymentId); if (!payment) return null;
    const prior = this.resources.get('refund', id);
    const row = this.save('refund', id, payment.owner, value, prior?.reference);
    this.save('refund-of:' + value.paymentId, id, payment.owner, value, row.reference); return row;
  }
  async require<T>(owner: BillingCommandOwner, kind: 'payment' | 'subscription' | 'invoice' | 'order' | 'refund', id: string): Promise<PaymentResource<T>> {
    const row = await this[kind](id) as PaymentResource<T> | null;
    if (!row || canonical(row.owner) !== canonical(owner)) throw new PaymentsError('Square resource is outside this billing subject.', 'PAYMENTS_RESOURCE_FORBIDDEN', 403);
    return row;
  }
  private async invoiceForOrder(customerId: string, orderId: string): Promise<PaymentResource<Square.Invoice> | null> {
    const parent = this.discoveringOrders.getStore(); if (parent?.has(customerId)) return null;
    const path = new Set(parent); path.add(customerId);
    return this.discoveringOrders.run(path, async () => {
      let count = 0;
      for (const sub of await this.discoverSubscriptions(customerId)) for (const id of sub.data?.invoiceIds ?? []) {
        if (++count > 1000) throw new PaymentsError('Payment lineage lookup exceeded its bound.', 'PAYMENTS_RECONCILE_LIMIT', 503);
        const value = (await this.native.invoices.get({ invoiceId: id })).invoice;
        if (value?.id !== id) return providerInvalid();
        if (value?.orderId === orderId) { this.resources.bind(sub.owner, 'invoice', id, null, sub.reference); return this.acceptInvoice(value); }
      }
      return null;
    });
  }
}
