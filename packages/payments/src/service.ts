import Stripe from 'stripe';
import type { ReactiveDB } from '@zero/framework/sync';
import { AuthError } from '@zero/framework/auth';
import { OBS_CODES, type PlatformCodeDefinition, type PlatformCodeEmitOptions } from '@zero/framework/observability';
import type { BillingEvent, BillingRevision, BillingSnapshot, BillingSubject, MerchantPayments, PaymentsAuthority, PaymentsBackend, PaymentsReadiness, ScopedPayments } from '@zero/framework/payments';
import { billingSubject, guard, type BillingAction } from './authority';
import { PaymentsError, safeProviderError, safeReadError } from './errors';
import { PaymentExecutionBoundary, type PaymentExecution } from './execution';
import { resolvePaymentsOptions, type PaymentsOptions, type ResolvedPaymentsOptions } from './options';
import { assertResource, emptySnapshot, invoiceView, paymentView, stripeId, subscriptionView } from './projections';
import { entitlementGrants, evaluateGrants, publicSnapshot, type StoredBillingSnapshot } from './entitlements';
import { PaymentsStore, canonical, hash, PAYMENTS_VIEW_TABLE, subjectKey, type BillingCommandOwner } from './store';
import { PaymentsResources } from './resources';
import { createStripeMerchantCharges, stripeMerchantEvent } from './stripe-merchant';
import { createScopedPayments } from './scoped';
import { operationId, resourceId, snapshotInput } from './validation';
import type { PaymentsJobPage, PaymentsJobQuery } from './jobs';

/** Server-only owner. No raw SDK, queue operations or subject selectors reach request projections. */
export class StripePayments implements PaymentsBackend {
  readonly provider = 'stripe' as const;
  readonly resources: PaymentsResources;
  readonly charges: MerchantPayments;
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
  private readonly executions = new PaymentExecutionBoundary();
  readonly jobs = {
    list: (query?: PaymentsJobQuery): PaymentsJobPage => { this.assertOpen(); return this.store.listJobs(query); },
    retry: (id: string): boolean => { this.assertOpen(); if (!/^[a-zA-Z0-9_-]{1,256}$/.test(id)) throw new PaymentsError('Invalid billing job ID.', 'PAYMENTS_INPUT_INVALID'); const retried = this.store.replay(id); if (retried) this.wake(); return retried; },
  };

  constructor(db: ReactiveDB, input: PaymentsOptions, private readonly runtime: { emitCode?: (definition: PlatformCodeDefinition, options?: PlatformCodeEmitOptions) => unknown } = {}) {
    this.options = resolvePaymentsOptions(input);
    const sql = db.getSQLiteService();
    if (sql?.mode !== 'file' && !(this.options.mode === 'test' && this.options.allowEphemeralTestMode)) throw new PaymentsError('Payments require a file-backed system database for durable receipts and webhook acknowledgement.', 'PAYMENTS_DURABILITY_REQUIRED', 503);
    const synchronous = db.prepare('PRAGMA synchronous').get() as { synchronous: number };
    if (synchronous.synchronous < 2 && !(this.options.mode === 'test' && this.options.allowEphemeralTestMode)) throw new PaymentsError('Payments require synchronous FULL (or EXTRA) on the file-backed system database before acknowledging financial receipts.', 'PAYMENTS_DURABILITY_REQUIRED', 503);
    this.store = new PaymentsStore(db, this.options.connectionId, canonical({ provider: 'stripe', mode: this.options.mode, account: this.options.accountId }));
    this.native = new Stripe(this.options.secretKey, { apiVersion: Stripe.API_VERSION, timeout: this.options.timeoutMs, maxNetworkRetries: this.options.maxNetworkRetries, httpClient: this.executions.transport(this.options.httpClient ?? Stripe.createFetchHttpClient()), appInfo: { name: 'Zero Payments', version: '0.2.0' } });
    this.resources = new PaymentsResources(db, this.options.connectionId); this.charges = createStripeMerchantCharges(this);
  }
  status(): PaymentsReadiness {
    return { enabled: !this.stopped, provider: 'stripe', mode: this.options.mode, acceptingSales: !this.stopped && this.options.acceptingSales !== false, apiVersion: Stripe.API_VERSION, webhookPath: this.options.webhookPath,
      operations: ['customers', 'operations', 'catalog', 'checkout', 'portal', 'subscriptions', 'invoice-preview', 'invoices', 'payments', 'refunds', 'entitlements', 'webhooks', 'reconcile', 'watch', 'merchant-charges'],
      capabilities: { hostedCheckout: true, customerPortal: true, subscriptionPreview: true, subscriptionChange: 'immediate-proration', cancellation: ['period-end', 'immediate'], invoicePdf: true } };
  }
  forAuthority(authority: PaymentsAuthority): ScopedPayments { return createScopedPayments(this, authority); }
  assertOpen(): void { if (this.stopped) throw new PaymentsError('Payments service is stopping.', 'PAYMENTS_UNAVAILABLE', 503, 'none', true); }
  private async tracked<T>(run: () => Promise<T>): Promise<T> {
    this.assertOpen(); const task = run(); this.requests.add(task);
    try { return await task; } finally { this.requests.delete(task); }
  }
  async verifyMerchant(): Promise<void> {
    this.assertOpen();
    if (!this.merchant) this.merchant = this.native.accounts.retrieveCurrent().then(account => {
      if (account.id !== this.options.accountId) throw new PaymentsError('Stripe key does not belong to the configured merchant.', 'PAYMENTS_MERCHANT_MISMATCH', 503);
    }).catch(error => { this.merchant = null; throw safeReadError(error); });
    await this.merchant;
  }
  async read<T>(authority: PaymentsAuthority, action: BillingAction, fn: (subject: BillingSubject) => Promise<T> | T): Promise<T> {
    return this.tracked(async () => {
      const subject = await guard(authority, this.options, action);
      let result: T; try { result = await fn(subject); } catch (error) { if (error instanceof PaymentsError || error instanceof AuthError) throw error; throw safeReadError(error); }
      await guard(authority, this.options, action); return result;
    });
  }
  async command<T>(authority: PaymentsAuthority, action: BillingAction, id: string, payload: unknown, run: (subject: BillingSubject, key: string) => Promise<T>): Promise<T> {
    operationId(id);
    return this.read(authority, action, async subject => {
      await this.verifyMerchant();
      // Recheck after merchant/network admission, immediately before the durable command reservation.
      await guard(authority, this.options, action);
      return this.execute(subject, `user:${id}`, payload, key => run(subject, key), () => {
        if (authority.signal?.aborted) throw new PaymentsError('Payment request was cancelled.', 'PAYMENTS_REQUEST_CANCELLED', 499, 'none', true);
        if (subjectKey(billingSubject(authority, this.options, action)) !== subjectKey(subject)) throw new PaymentsError('Billing scope changed during the operation.', 'PAYMENTS_SCOPE_REQUIRED', 403, 'none', true);
      });
    });
  }
  /** Freeze exact outbound parameters before the provider call, not just a business-input digest. */
  async parameters<T>(key: string, kind: string, prepare: () => Promise<T>): Promise<T> {
    const stored = this.store.providerRequest<T>(key, kind);
    return stored ?? this.store.saveProviderRequest(key, kind, await prepare());
  }
  /** Trusted capability only: no billing customer/catalog/user is required for a merchant charge. */
  merchantCommand<T>(id: string, payload: unknown, run: (owner: BillingCommandOwner, key: string) => Promise<T>): Promise<T> {
    operationId(id); return this.tracked(async () => { await this.verifyMerchant(); const owner = { kind: 'merchant' as const, id: this.options.accountId }; return this.execute(owner, 'merchant:' + id, payload, key => run(owner, key)); });
  }
  merchantRead<T>(run: () => Promise<T>): Promise<T> { return this.tracked(async () => { await this.verifyMerchant(); try { return await run(); } catch (error) { throw safeReadError(error); } }); }
  private async execute<T>(subject: BillingCommandOwner, id: string, payload: unknown, run: (key: string) => Promise<T>, assertAuthority = this.executions.active?.assertAuthority): Promise<T> {
    const ticket = this.store.reserve(subject, id, payload);
    if ('replay' in ticket) return ticket.replay as T;
    const heartbeat = setInterval(() => { try { this.store.renewCommand(subject, id, ticket.fence); } catch { /* The final receipt fence remains mandatory even after a lost heartbeat. */ } }, 30000); heartbeat.unref?.();
    const execution: PaymentExecution = { key: ticket.key, assertAuthority, attempted: false, accepted: false, assertCurrent: () => this.store.assertCommand(subject, id, ticket.fence) };
    let value: T;
    try { value = await this.executions.run(execution, () => run(ticket.key)); }
    catch (error) {
      const cause = execution.blocked ?? error;
      const mapped = execution.accepted || execution.blocked && execution.attempted
        ? new PaymentsError('The provider may have accepted this operation. Reconcile it using the original operation ID.', 'PAYMENTS_OUTCOME_UNKNOWN', 409, 'unknown')
        : cause instanceof AuthError ? new PaymentsError('Billing authority changed before provider admission.', 'PAYMENTS_AUTHORITY_CHANGED', 403, 'none', true) : safeProviderError(cause);
      try { this.store.finish(subject, id, ticket.fence, null, mapped); }
      catch { this.observe(OBS_CODES.PAYMENTS_COMMAND_UNKNOWN, { operationDigest: hash(canonical([subject, id])), reason: 'PAYMENTS_RECEIPT_UNAVAILABLE' }); throw new PaymentsError('The operation outcome could not be recorded. Reconcile the original operation ID.', 'PAYMENTS_OUTCOME_UNKNOWN', 409, 'unknown'); }
      if (mapped.outcome === 'unknown') this.observe(OBS_CODES.PAYMENTS_COMMAND_UNKNOWN, { operationDigest: hash(canonical([subject, id])), reason: mapped.code });
      throw mapped;
    }
    finally { clearInterval(heartbeat); }
    // Save the accepted provider outcome even if the caller was revoked while Stripe was running.
    // Caller authority is checked again by read(), after the durable receipt, never before it.
    try { this.store.finish(subject, id, ticket.fence, value); }
    catch { this.observe(OBS_CODES.PAYMENTS_COMMAND_UNKNOWN, { operationDigest: hash(canonical([subject, id])), reason: 'PAYMENTS_RECEIPT_UNAVAILABLE' }); throw new PaymentsError('The provider result could not be durably recorded. Reconcile the original operation.', 'PAYMENTS_OUTCOME_UNKNOWN', 409, 'unknown'); }
    return value;
  }
  async ensureCustomer(subject: BillingSubject, beforeCreate?: () => Promise<unknown>): Promise<string> {
    return this.tracked(() => this.createCustomer(subject, beforeCreate));
  }
  private async createCustomer(subject: BillingSubject, beforeCreate?: () => Promise<unknown>): Promise<string> {
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
  async adoptCustomer(input: BillingSubject, id: string): Promise<void> {
    const subject = snapshotInput(input, ['kind', 'id', 'tenantId']);
    if (!['user', 'organization'].includes(subject.kind) || typeof subject.id !== 'string' || !subject.id || subject.id.length > 256 || subject.tenantId !== undefined && (subject.kind !== 'user' || typeof subject.tenantId !== 'string' || !subject.tenantId || subject.tenantId.length > 256)) throw new PaymentsError('Invalid trusted billing subject.', 'PAYMENTS_INPUT_INVALID', 400);
    return this.tracked(() => this.bindCustomer(subject, id));
  }
  private async bindCustomer(subject: BillingSubject, id: string): Promise<void> {
    resourceId(id, 'cus'); await this.verifyMerchant();
    const customer = await this.native.customers.retrieve(id);
    if (customer.deleted) throw new PaymentsError('Deleted customers cannot be adopted.', 'PAYMENTS_CUSTOMER_DELETED', 409);
    assertResource(customer, null, this.options); this.store.bind(subject, id); this.enqueue(id);
  }
  enqueue(customer: string): void { this.store.admit(`reconcile-${crypto.randomUUID()}`, 'reconcile', '{}', customer); this.wake(); }
  snapshot(subject: BillingSubject): BillingSnapshot {
    const view: StoredBillingSnapshot = this.store.view(subject) ?? emptySnapshot(subject, this.options);
    const reconciled = view.reconciledAt ? Date.parse(view.reconciledAt) : NaN;
    const legacyExpired = !('_grants' in view) && view.entitlementsValidUntil !== null && Date.now() / 1000 >= view.entitlementsValidUntil;
    const stale = !Number.isFinite(reconciled) || Date.now() - reconciled > this.options.maxProjectionAgeMs || view.policyVersion !== this.options.policyVersion || legacyExpired;
    const grants = '_grants' in view && view._grants ? evaluateGrants(view._grants) : { entitlements: view.entitlements, validUntil: view.entitlementsValidUntil };
    const entitlements = stale ? {} : grants.entitlements;
    return { ...publicSnapshot(view), stale, entitlements, entitlementsValidUntil: grants.validUntil, version: hash(canonical([view.revision, stale, entitlements, view.policyVersion])) };
  }
  async reconcileCustomer(customerId: string): Promise<BillingSnapshot> {
    return this.tracked(() => this.reconcileProjection(customerId));
  }
  private async reconcileProjection(customerId: string): Promise<BillingSnapshot> {
    await this.verifyMerchant();
    const subject = this.store.owner(customerId);
    if (!subject) throw new PaymentsError('Customer is not bound to a Zero billing subject. Adopt it explicitly before replay.', 'PAYMENTS_CUSTOMER_UNBOUND', 409);
    const lock = this.store.lock(`customer:${customerId}`);
    if (!lock) throw new PaymentsError('Another worker is reconciling this customer.', 'PAYMENTS_RECONCILE_BUSY', 409);
    try {
      const customer = await this.native.customers.retrieve(customerId); this.store.renew(lock);
      if (customer.deleted) {
        this.store.writeView(subject, { ...emptySnapshot(subject, this.options), _grants: [], reconciledAt: new Date().toISOString(), stale: false, error: 'PAYMENTS_CUSTOMER_DELETED' }, lock, !!this.options.onChange);
        return this.snapshot(subject);
      }
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
      let totalItems = 0;
      for (const sub of subscriptions) {
        if (sub.items.has_more) {
          const items: Stripe.SubscriptionItem[] = []; let after: string | undefined;
          for (let page = 0; page < 10; page++) {
            const result = await this.native.subscriptionItems.list({ subscription: sub.id, limit: 100, ...(after ? { starting_after: after } : {}) }); this.store.renew(lock);
            if (result.data.some(item => item.subscription !== sub.id)) throw new PaymentsError('Subscription item is outside its subscription.', 'PAYMENTS_RESOURCE_FORBIDDEN', 403);
            items.push(...result.data);
            if (!result.has_more) break;
            if (page === 9 || !result.data.length) throw new PaymentsError('Subscription item reconciliation exceeded its page budget.', 'PAYMENTS_RECONCILE_LIMIT', 503);
            after = result.data.at(-1)!.id;
          }
          sub.items = { ...sub.items, data: items, has_more: false };
        }
        totalItems += sub.items.data.length;
        if (totalItems > 10000) throw new PaymentsError('Billing reconciliation exceeded its aggregate item budget.', 'PAYMENTS_RECONCILE_LIMIT', 503);
      }
      const evidence = entitlementGrants(subscriptions, this.options), grants = evaluateGrants(evidence);
      const refreshMs = Math.min(this.options.maxProjectionAgeMs / 2, grants.validUntil === null ? Infinity : Math.max(1000, grants.validUntil * 1000 - Date.now()));
      this.store.writeView(subject, { subject, provider: 'stripe', mode: this.options.mode, revision: 0, customer: { id: customer.id, ...(customer.email ? { email: customer.email } : {}), ...(customer.name ? { name: customer.name } : {}) }, subscriptions: subscriptions.map(value => subscriptionView(value, this.options)), invoices: invoices.data.map(invoiceView), payments: payments.data.map(paymentView), entitlements: grants.entitlements, _grants: evidence, reconciledAt: new Date().toISOString(), stale: false, policyVersion: this.options.policyVersion, entitlementsValidUntil: grants.validUntil }, lock, !!this.options.onChange, refreshMs);
      return this.snapshot(subject);
    } finally { this.store.release(lock); }
  }
  /** Verified v1 snapshot billing events only. Provider payload stays in private system storage. */
  async acceptWebhook(payload: string, signature: string): Promise<{ received: true; supported: boolean }> {
    if (typeof payload !== 'string' || Buffer.byteLength(payload, 'utf8') > 512 * 1024) throw new PaymentsError('Webhook body is too large.', 'PAYMENTS_WEBHOOK_TOO_LARGE', 413);
    if (typeof signature !== 'string' || signature.length > 8192) throw new PaymentsError('Stripe signature is invalid.', 'PAYMENTS_WEBHOOK_SIGNATURE_INVALID', 400);
    return this.tracked(() => this.verifyWebhook(payload, signature));
  }
  private async verifyWebhook(payload: string, signature: string): Promise<{ received: true; supported: boolean }> {
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
    // Delivery bookkeeping may legitimately differ between retries of the same event.
    const { pending_webhooks: _pending, ...immutableEvent } = event;
    this.store.admit(event.id, 'webhook', canonical(immutableEvent), customer);
    this.wake(); return { received: true, supported: true };
  }
  /** One worker per runtime; durable claims/resource fences coordinate replicas. */
  async drain(limit = 25): Promise<void> {
    this.assertOpen();
    if (this.running) return this.running;
    this.running = this.executions.outside(async () => {
      this.store.queueRefreshes(this.options.maxProjectionAgeMs / 2);
      for (let i = 0; i < limit && !this.stopped; i++) {
        const row = this.store.claim(); if (!row) break;
        const heartbeat = setInterval(() => { try { this.store.renewInbox(row); } catch { /* Final claim/resource fences still apply. */ } }, 30000); heartbeat.unref?.();
        try {
          if (row.kind === 'notify') {
            this.store.assertInbox(row);
            const value = JSON.parse(row.payload); if (this.options.onChange) await this.callback(signal => this.options.onChange!({ eventId: row.id, ...value }, { signal }));
          } else {
            const event = row.kind === 'webhook' ? JSON.parse(row.payload) as Stripe.Event : null;
            const merchant = event ? await stripeMerchantEvent(this, event) : null;
            if (merchant && this.options.onMerchantEvent) {
              this.store.assertInbox(row); await this.callback(signal => this.options.onMerchantEvent!(merchant, { signal }));
            }
            const customer = row.customer ?? (event ? await this.customerForEvent(event) : null);
            if (customer && (!merchant || this.store.owner(customer))) {
              await this.reconcileCustomer(customer);
              if (row.kind === 'webhook' && this.options.onEvent) {
                const canonical = await this.canonicalEvent(event!, customer);
                this.store.assertInbox(row);
                await this.callback(signal => this.options.onEvent!(canonical, { signal }));
              }
            }
          }
          // Events without a customer (for example an unassociated PaymentIntent) cannot select a subject.
          this.store.complete(row);
        } catch (error) {
          const reason = error instanceof PaymentsError ? error.code : 'PAYMENTS_PROCESSING_FAILED'; this.store.fail(row, reason);
          this.observe(row.attempts >= 12 ? OBS_CODES.PAYMENTS_JOB_QUARANTINED : OBS_CODES.PAYMENTS_JOB_RETRY, { jobId: row.id, kind: row.kind, attempt: row.attempts, reason });
        }
        finally { clearInterval(heartbeat); }
      }
    }).finally(() => { this.running = null; });
    return this.running;
  }
  private async callback(run: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.resolve().then(() => run(controller.signal)), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new PaymentsError('Billing integration callback timed out.', 'PAYMENTS_CALLBACK_TIMEOUT', 503)); controller.abort(); }, this.options.callbackTimeoutMs);
      })]);
    } finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
  private observe(code: PlatformCodeDefinition, metadata: Record<string, unknown>): void {
    try { const result = this.runtime.emitCode?.(code, { metadata: { connectionId: this.options.connectionId, ...metadata } }); if (result && typeof (result as Promise<unknown>).then === 'function') void Promise.resolve(result).catch(() => {}); } catch { /* Diagnostic failure never changes a financial receipt. */ }
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
    this.timer = setTimeout(() => { this.timer = null; void this.drain().catch(() => this.observe(OBS_CODES.PAYMENTS_WORKER_FAILED, {})).finally(() => this.schedule()); }, 0); this.timer.unref?.();
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
  async *watch(authority: PaymentsAuthority, signal?: AbortSignal): AsyncIterable<BillingRevision> {
    this.assertOpen();
    const subject = await guard(authority, this.options, 'read'); let wake: (() => void) | null = null, dirty = false, cleaned = false;
    this.assertOpen();
    const unsubscribe = this.store.db.onChange(change => {
      if (change.table === PAYMENTS_VIEW_TABLE && change.row?.connection === this.options.connectionId && change.row?.subject === subjectKey(subject)) { dirty = true; wake?.(); }
    });
    const abort = () => {
      if (!cleaned) { cleaned = true; unsubscribe(); this.streamWakers.delete(abort); signal?.removeEventListener('abort', abort); authority.signal?.removeEventListener('abort', abort); }
      wake?.();
    };
    this.streamWakers.add(abort); signal?.addEventListener('abort', abort); authority.signal?.addEventListener('abort', abort);
    try {
      while (!this.stopped && !signal?.aborted && !authority.signal?.aborted) {
        dirty = false;
        await guard(authority, this.options, 'read');
        if (this.stopped || signal?.aborted || authority.signal?.aborted) break;
        const snapshot = this.snapshot(subject);
        yield { revision: snapshot.revision, version: snapshot.version };
        if (dirty) continue;
        await new Promise<void>(resolve => {
          const deadline = snapshot.entitlementsValidUntil === null ? Infinity : Math.max(1, snapshot.entitlementsValidUntil * 1000 - Date.now());
          const timer = setTimeout(done, Math.min(15000, deadline));
          function done() { clearTimeout(timer); wake = null; resolve(); }
          wake = done;
          if (signal?.aborted || authority.signal?.aborted || this.stopped) done();
        });
      }
    } finally { abort(); }
  }
}
