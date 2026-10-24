import Stripe from 'stripe';
import type { ReactiveDB } from '@zero/framework/sync';
import { AuthError } from '@zero/framework/auth';
import type { BillingEvent, BillingSnapshot, BillingSubject, PaymentsAuthority, PaymentsBackend, PaymentsReadiness, ScopedPayments } from '@zero/framework/payments';
import { guard, type BillingAction } from './authority';
import { PaymentsError, safeProviderError } from './errors';
import { resolvePaymentsOptions, type PaymentsOptions, type ResolvedPaymentsOptions } from './options';
import { assertResource, deriveEntitlements, entitlementDeadline, emptySnapshot, invoiceView, paymentView, stripeId, subscriptionView } from './projections';
import { PaymentsStore, canonical, hash, PAYMENTS_VIEW_TABLE, subjectKey } from './store';
import { createScopedPayments } from './scoped';
import { operationId, resourceId } from './validation';

/** Server-only owner. No raw SDK, queue operations or subject selectors reach request projections. */
export class StripePayments implements PaymentsBackend {
  readonly options: ResolvedPaymentsOptions;
  readonly store: PaymentsStore;
  /** Trusted escape hatch for Stripe APIs beyond the safe self-service facade. No HTTP proxy. */
  readonly native: Stripe;
  private merchant: Promise<void> | null = null;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private requests = new Set<Promise<unknown>>();
  private streamWakers = new Set<() => void>();

  constructor(db: ReactiveDB, input: PaymentsOptions) {
    this.options = resolvePaymentsOptions(input);
    const sql = db.getSQLiteService();
    if (sql?.mode !== 'file' && !(this.options.mode === 'test' && this.options.allowEphemeralTestMode)) throw new PaymentsError('Payments require a file-backed system database for durable receipts and webhook acknowledgement.', 'PAYMENTS_DURABILITY_REQUIRED', 503);
    const synchronous = db.prepare('PRAGMA synchronous').get() as { synchronous: number };
    if (synchronous.synchronous < 2 && !(this.options.mode === 'test' && this.options.allowEphemeralTestMode)) throw new PaymentsError('Payments require synchronous FULL (or EXTRA) on the file-backed system database before acknowledging financial receipts.', 'PAYMENTS_DURABILITY_REQUIRED', 503);
    this.store = new PaymentsStore(db, this.options.connectionId, canonical({ provider: 'stripe', mode: this.options.mode, account: this.options.accountId }));
    this.native = new Stripe(this.options.secretKey, { apiVersion: Stripe.API_VERSION, timeout: this.options.timeoutMs, maxNetworkRetries: this.options.maxNetworkRetries, httpClient: this.options.httpClient, appInfo: { name: 'Zero Payments', version: '0.1.0' } });
  }
  status(): PaymentsReadiness {
    return { enabled: !this.stopped, provider: 'stripe', mode: this.options.mode, acceptingSales: !this.stopped && this.options.acceptingSales !== false, apiVersion: Stripe.API_VERSION, webhookPath: this.options.webhookPath,
      operations: ['customers', 'operations', 'catalog', 'checkout', 'portal', 'subscriptions', 'invoice-preview', 'invoices', 'payments', 'refunds', 'entitlements', 'webhooks', 'reconcile', 'watch'] };
  }
  forAuthority(authority: PaymentsAuthority): ScopedPayments { return createScopedPayments(this, authority); }
  assertOpen(): void { if (this.stopped) throw new PaymentsError('Payments service is stopping.', 'PAYMENTS_UNAVAILABLE', 503); }
  async verifyMerchant(): Promise<void> {
    this.assertOpen();
    if (!this.merchant) this.merchant = this.native.accounts.retrieveCurrent().then(account => {
      if (account.id !== this.options.accountId) throw new PaymentsError('Stripe key does not belong to the configured merchant.', 'PAYMENTS_MERCHANT_MISMATCH', 503);
    }).catch(error => { this.merchant = null; throw safeProviderError(error); });
    await this.merchant;
  }
  async read<T>(authority: PaymentsAuthority, action: BillingAction, fn: (subject: BillingSubject) => Promise<T> | T): Promise<T> {
    this.assertOpen();
    const task = (async () => {
      const subject = await guard(authority, this.options, action);
      let result: T; try { result = await fn(subject); } catch (error) { if (error instanceof PaymentsError || error instanceof AuthError) throw error; throw safeProviderError(error); }
      await guard(authority, this.options, action); return result;
    })();
    this.requests.add(task);
    try { return await task; } finally { this.requests.delete(task); }
  }
  async command<T>(authority: PaymentsAuthority, action: BillingAction, id: string, payload: unknown, run: (subject: BillingSubject, key: string) => Promise<T>): Promise<T> {
    operationId(id);
    return this.read(authority, action, async subject => {
      await this.verifyMerchant();
      // Recheck after merchant/network admission, immediately before the durable command reservation.
      await guard(authority, this.options, action);
      return this.execute(subject, `user:${id}`, payload, key => run(subject, key));
    });
  }
  /** Freeze exact outbound parameters before the provider call, not just a business-input digest. */
  async parameters<T>(key: string, kind: string, prepare: () => Promise<T>): Promise<T> {
    const stored = this.store.providerRequest<T>(key, kind);
    return stored ?? this.store.saveProviderRequest(key, kind, await prepare());
  }
  private async execute<T>(subject: BillingSubject, id: string, payload: unknown, run: (key: string) => Promise<T>): Promise<T> {
    const ticket = this.store.reserve(subject, id, payload);
    if ('replay' in ticket) return ticket.replay as T;
    const heartbeat = setInterval(() => { try { this.store.renewCommand(subject, id, ticket.fence); } catch { /* The final receipt fence remains mandatory even after a lost heartbeat. */ } }, 30000); heartbeat.unref?.();
    let value: T;
    try { value = await run(ticket.key); }
    catch (error) { const mapped = safeProviderError(error); this.store.finish(subject, id, ticket.fence, null, mapped); if (error instanceof AuthError) throw error; throw mapped; }
    finally { clearInterval(heartbeat); }
    // Save the accepted provider outcome even if the caller was revoked while Stripe was running.
    // Caller authority is checked again by read(), after the durable receipt, never before it.
    this.store.finish(subject, id, ticket.fence, value);
    return value;
  }
  async ensureCustomer(subject: BillingSubject, beforeCreate?: () => Promise<unknown>): Promise<string> {
    this.assertOpen();
    const bound = this.store.customer(subject); if (bound) return bound;
    await this.verifyMerchant();
    const result = await this.execute(subject, 'system:customer-v1', { type: 'customer', subject }, async key => {
      await beforeCreate?.();
      const customer = await this.native.customers.create({ metadata: { zero_connection: this.options.connectionId, zero_subject_digest: hash(subjectKey(subject)) } }, { idempotencyKey: key });
      assertResource(customer, null, this.options);
      return { id: customer.id };
    });
    this.store.bind(subject, result.id); this.enqueue(result.id); return result.id;
  }
  requireCustomer(subject: BillingSubject): string {
    const id = this.store.customer(subject); if (!id) throw new PaymentsError('No billing customer has been created for this subject.', 'PAYMENTS_CUSTOMER_REQUIRED', 409); return id;
  }
  /** Explicit trusted migration path: never auto-adopts customers by email or webhook metadata. */
  async adoptCustomer(subject: BillingSubject, id: string): Promise<void> {
    if (!subject || !['user', 'organization'].includes(subject.kind) || !subject.id || subject.id.length > 256 || subject.tenantId && subject.tenantId.length > 256) throw new PaymentsError('Invalid trusted billing subject.', 'PAYMENTS_INPUT_INVALID', 400);
    resourceId(id, 'cus'); await this.verifyMerchant();
    const customer = await this.native.customers.retrieve(id);
    if (customer.deleted) throw new PaymentsError('Deleted customers cannot be adopted.', 'PAYMENTS_CUSTOMER_DELETED', 409);
    assertResource(customer, null, this.options); this.store.bind(subject, id); this.enqueue(id);
  }
  enqueue(customer: string): void { this.store.admit(`reconcile-${crypto.randomUUID()}`, 'reconcile', '{}', customer); this.wake(); }
  snapshot(subject: BillingSubject): BillingSnapshot {
    const view = this.store.view(subject) ?? emptySnapshot(subject, this.options);
    const stale = !view.reconciledAt || Date.now() - Date.parse(view.reconciledAt) > this.options.maxProjectionAgeMs || view.policyVersion !== this.options.policyVersion || view.entitlementsValidUntil !== null && Date.now() / 1000 >= view.entitlementsValidUntil;
    return { ...view, stale, entitlements: stale ? {} : view.entitlements };
  }
  async reconcileCustomer(customerId: string): Promise<BillingSnapshot> {
    await this.verifyMerchant();
    const subject = this.store.owner(customerId);
    if (!subject) throw new PaymentsError('Customer is not bound to a Zero billing subject. Adopt it explicitly before replay.', 'PAYMENTS_CUSTOMER_UNBOUND', 409);
    const lock = this.store.lock(`customer:${customerId}`);
    if (!lock) throw new PaymentsError('Another worker is reconciling this customer.', 'PAYMENTS_RECONCILE_BUSY', 409);
    try {
      const customer = await this.native.customers.retrieve(customerId); this.store.renew(lock);
      if (customer.deleted) return this.store.writeView(subject, { ...emptySnapshot(subject, this.options), reconciledAt: new Date().toISOString(), stale: false, error: 'PAYMENTS_CUSTOMER_DELETED' }, lock, !!this.options.onChange);
      assertResource(customer, null, this.options);
      // Every active subscription matters to grants. Exhaust a bounded set, or fail closed instead of publishing a partial entitlement set.
      const subscriptions: Stripe.Subscription[] = []; let after: string | undefined;
      for (let page = 0; page < 10; page++) {
        const result = await this.native.subscriptions.list({ customer: customerId, status: 'all', limit: 100, ...(after ? { starting_after: after } : {}), expand: ['data.latest_invoice'] });
        this.store.renew(lock); subscriptions.push(...result.data);
        if (!result.has_more) break;
        if (page === 9 || !result.data.length) throw new PaymentsError('Subscription reconciliation exceeds its bounded page limit. No partial grants were published.', 'PAYMENTS_RECONCILE_LIMIT', 503);
        after = result.data.at(-1)!.id;
      }
      const invoices = await this.native.invoices.list({ customer: customerId, limit: 20 }); this.store.renew(lock);
      const payments = await this.native.paymentIntents.list({ customer: customerId, limit: 20, expand: ['data.latest_charge'] }); this.store.renew(lock);
      [...subscriptions, ...invoices.data, ...payments.data].forEach(value => assertResource(value, customerId, this.options));
      return this.store.writeView(subject, { subject, provider: 'stripe', mode: this.options.mode, revision: 0, customer: { id: customer.id, ...(customer.email ? { email: customer.email } : {}), ...(customer.name ? { name: customer.name } : {}) }, subscriptions: subscriptions.map(value => subscriptionView(value, this.options)), invoices: invoices.data.map(invoiceView), payments: payments.data.map(paymentView), entitlements: deriveEntitlements(subscriptions, this.options), reconciledAt: new Date().toISOString(), stale: false, policyVersion: this.options.policyVersion, entitlementsValidUntil: entitlementDeadline(subscriptions) }, lock, !!this.options.onChange, this.options.maxProjectionAgeMs / 2);
    } finally { this.store.release(lock); }
  }
  /** Verified v1 snapshot billing events only. Provider payload stays in private system storage. */
  async acceptWebhook(payload: string, signature: string): Promise<{ received: true; supported: boolean }> {
    this.assertOpen();
    let event: Stripe.Event | null = null;
    for (const secret of this.options.webhookSecrets) {
      try { event = await this.native.webhooks.constructEventAsync(payload, signature, secret); break; } catch { /* Rotation: try the next configured signing secret, never an unsigned parse. */ }
    }
    if (!event) throw new PaymentsError('Stripe signature is invalid or expired.', 'PAYMENTS_WEBHOOK_SIGNATURE_INVALID', 400);
    if (!/^evt_[a-zA-Z0-9]+$/.test(event.id) || event.livemode !== (this.options.mode === 'live') || event.account && event.account !== this.options.accountId || event.context) throw new PaymentsError('Stripe event belongs to another environment/account.', 'PAYMENTS_WEBHOOK_SCOPE_INVALID', 400);
    if (event.api_version !== Stripe.API_VERSION) throw new PaymentsError(`Webhook endpoint must use API version ${Stripe.API_VERSION}.`, 'PAYMENTS_WEBHOOK_VERSION_INVALID', 400);
    const supported = /^(customer\.(created|updated|deleted|subscription\.[a-z_]+)|checkout\.session\.[a-z_]+|invoice\.[a-z_]+|payment_intent\.[a-z_]+|charge\.[a-z_.]+|refund\.[a-z_]+)$/.test(event.type);
    if (!supported) return { received: true, supported: false };
    const object = event.data?.object as unknown as { id?: string; object?: string; customer?: string | { id: string } | null };
    if (!object || typeof object.id !== 'string') throw new PaymentsError('A v1 snapshot event is required.', 'PAYMENTS_WEBHOOK_FORMAT_INVALID', 400);
    const customer = object.object === 'customer' ? object.id : stripeId(object.customer);
    this.store.admit(event.id, 'webhook', canonical(event), customer);
    this.wake(); return { received: true, supported: true };
  }
  /** One worker per runtime; durable claims/resource fences coordinate replicas. */
  async drain(limit = 25): Promise<void> {
    this.assertOpen();
    if (this.running) return this.running;
    this.running = (async () => {
      this.store.queueRefreshes(this.options.maxProjectionAgeMs / 2);
      for (let i = 0; i < limit && !this.stopped; i++) {
        const row = this.store.claim(); if (!row) break;
        const heartbeat = setInterval(() => { try { this.store.renewInbox(row); } catch { /* Final claim/resource fences still apply. */ } }, 30000); heartbeat.unref?.();
        try {
          if (row.kind === 'notify') {
            const value = JSON.parse(row.payload); if (this.options.onChange) await this.callback(signal => this.options.onChange!({ eventId: row.id, ...value }, { signal }));
          } else {
            const event = row.kind === 'webhook' ? JSON.parse(row.payload) as Stripe.Event : null;
            const customer = row.customer ?? (event ? await this.customerForEvent(event) : null);
            if (customer) {
              await this.reconcileCustomer(customer);
              if (row.kind === 'webhook' && this.options.onEvent) {
                const canonical = await this.canonicalEvent(event!, customer);
                await this.callback(signal => this.options.onEvent!(canonical, { signal }));
              }
            }
          }
          // Events without a customer (for example an unassociated PaymentIntent) cannot select a subject.
          this.store.complete(row);
        } catch (error) { this.store.fail(row, error instanceof PaymentsError ? error.code : 'PAYMENTS_PROCESSING_FAILED'); }
        finally { clearInterval(heartbeat); }
      }
    })().finally(() => { this.running = null; });
    return this.running;
  }
  private async callback(run: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.resolve().then(() => run(controller.signal)), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new PaymentsError('Billing integration callback timed out.', 'PAYMENTS_CALLBACK_TIMEOUT', 503)); }, this.options.callbackTimeoutMs);
      })]);
    } finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
  private async customerForEvent(event: Stripe.Event): Promise<string | null> {
    const object = event.data.object as unknown as { object: string; payment_intent?: string | { id: string }; charge?: string | { id: string } };
    await this.verifyMerchant();
    const payment = stripeId(object.payment_intent), charge = stripeId(object.charge);
    if (payment) {
      const value = await this.native.paymentIntents.retrieve(payment); assertResource(value, null, this.options); return stripeId(value.customer);
    }
    if (charge) {
      const value = await this.native.charges.retrieve(charge); assertResource(value, null, this.options); return stripeId(value.customer);
    }
    return null;
  }
  private async canonicalEvent(event: Stripe.Event, customer: string): Promise<BillingEvent> {
    const subject = this.store.owner(customer)!;
    const object = event.data.object as unknown as { id: string; object: string };
    let resource: BillingEvent['resource'];
    if (object.object === 'checkout.session') {
      const value = await this.native.checkout.sessions.retrieve(object.id); assertResource(value, customer, this.options);
      resource = { id: value.id, kind: object.object, status: value.status, paymentStatus: value.payment_status, ...(value.amount_total !== null && value.currency ? { total: { amount: value.amount_total, currency: value.currency } } : {}), ...(value.metadata?.zero_connection === this.options.connectionId && this.options.offers.has(value.metadata.zero_offer!) ? { offer: value.metadata.zero_offer } : {}) };
    } else if (object.object === 'payment_intent') {
      const value = await this.native.paymentIntents.retrieve(object.id); assertResource(value, customer, this.options);
      resource = { id: value.id, kind: object.object, status: value.status, total: { amount: value.amount_received, currency: value.currency }, ...(value.metadata?.zero_connection === this.options.connectionId && this.options.offers.has(value.metadata.zero_offer!) ? { offer: value.metadata.zero_offer } : {}) };
    } else if (object.object === 'invoice') {
      const value = await this.native.invoices.retrieve(object.id); assertResource(value, customer, this.options);
      resource = { id: value.id, kind: object.object, status: value.status, total: { amount: value.total, currency: value.currency } };
    } else if (object.object === 'subscription') {
      const value = await this.native.subscriptions.retrieve(object.id); assertResource(value, customer, this.options);
      resource = { id: value.id, kind: object.object, status: value.status };
    } else if (object.object === 'refund') {
      const value = await this.native.refunds.retrieve(object.id), paymentId = stripeId(value.payment_intent), charge = stripeId(value.charge);
      if (paymentId) assertResource(await this.native.paymentIntents.retrieve(paymentId), customer, this.options);
      else if (charge) assertResource(await this.native.charges.retrieve(charge), customer, this.options);
      else throw new PaymentsError('Refund has no verifiable payment customer.', 'PAYMENTS_RESOURCE_FORBIDDEN', 403);
      resource = { id: value.id, kind: object.object, status: value.status ?? null, total: { amount: value.amount, currency: value.currency } };
    } else if (object.object === 'charge') {
      const value = await this.native.charges.retrieve(object.id); assertResource(value, customer, this.options);
      resource = { id: value.id, kind: object.object, status: value.status, total: { amount: value.amount, currency: value.currency } };
    } else if (object.object === 'dispute') {
      const value = await this.native.disputes.retrieve(object.id), charge = stripeId(value.charge);
      if (!charge) throw new PaymentsError('Dispute has no verifiable charge.', 'PAYMENTS_RESOURCE_FORBIDDEN', 403);
      assertResource(await this.native.charges.retrieve(charge), customer, this.options);
      resource = { id: value.id, kind: object.object, status: value.status, total: { amount: value.amount, currency: value.currency } };
    } else {
      // Customer updates/deletion have no financial status to infer from an old event snapshot.
      resource = { id: customer, kind: 'customer', status: this.store.view(subject)?.error === 'PAYMENTS_CUSTOMER_DELETED' ? 'deleted' : 'active' };
    }
    return { eventId: event.id, type: event.type, subject, providerCreatedAt: event.created, resource };
  }
  start(): void { this.assertOpen(); this.wake(); }
  private wake(): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.drain().catch(() => {}).finally(() => this.schedule()); }, 0); this.timer.unref?.();
  }
  private schedule(): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.wake(); }, 1000); this.timer.unref?.();
  }
  async stop(): Promise<void> {
    this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null;
    this.streamWakers.forEach(wake => wake());
    await Promise.allSettled([...this.requests, ...(this.running ? [this.running] : [])]);
  }
  async *watch(authority: PaymentsAuthority, signal?: AbortSignal): AsyncIterable<{ revision: number }> {
    const subject = await guard(authority, this.options, 'read'); let wake: (() => void) | null = null, dirty = false;
    const unsubscribe = this.store.db.onChange(change => {
      if (change.table === PAYMENTS_VIEW_TABLE && change.row?.connection === this.options.connectionId && change.row?.subject === subjectKey(subject)) { dirty = true; wake?.(); }
    });
    const abort = () => wake?.(); this.streamWakers.add(abort); signal?.addEventListener('abort', abort); authority.signal?.addEventListener('abort', abort);
    try {
      while (!this.stopped && !signal?.aborted && !authority.signal?.aborted) {
        dirty = false;
        await guard(authority, this.options, 'read');
        yield { revision: this.snapshot(subject).revision };
        if (dirty) continue;
        await new Promise<void>(resolve => {
          const timer = setTimeout(done, 15000);
          function done() { clearTimeout(timer); wake = null; resolve(); }
          wake = done;
          if (signal?.aborted || authority.signal?.aborted || this.stopped) done();
        });
      }
    } finally { unsubscribe(); this.streamWakers.delete(abort); signal?.removeEventListener('abort', abort); authority.signal?.removeEventListener('abort', abort); }
  }
}
