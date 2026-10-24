/** Square runtime owner: Guardian scope, durable commands, shared reactive projections and managed shutdown. Provider work stays outside SQL. */
import type { SquareClient } from 'square';
import type { ReactiveDB } from '@zero/framework/sync';
import { AuthError } from '@zero/framework/auth';
import { OBS_CODES, type PlatformCodeDefinition, type PlatformCodeEmitOptions } from '@zero/framework/observability';
import type { BillingSnapshot, BillingSubject, BillingRevision, MerchantPayments, PaymentsAuthority, PaymentsBackend, PaymentsReadiness, ScopedPayments } from '@zero/framework/payments';
import { billingSubject, guard, type BillingAction } from '../authority';
import { PaymentsStore, canonical, hash, subjectKey, PAYMENTS_VIEW_TABLE, type BillingCommandOwner } from '../store';
import { PaymentsResources } from '../resources';
import { evaluateGrants, publicSnapshot, type StoredBillingSnapshot } from '../entitlements';
import { PaymentsError } from '../errors';
import { operationId, trustedSubject } from '../validation';
import { SquareTransport, squareError, squareWireKey, type SquareExecution } from './transport';
import { resolveSquareOptions, squareId, SQUARE_API_VERSION, type ResolvedSquareOptions, type SquarePaymentsOptions } from './options';
import { SquareOwnership } from './ownership';
import { createScopedSquarePayments } from './scoped';
import { createSquareMerchantCharges } from './merchant';
import { SquareJobs } from './worker';
import { reconcileSquareCustomer } from './reconcile';
import type { PaymentsJobQuery } from '../jobs';
import { providerInvalid } from './models';

export class SquarePayments implements PaymentsBackend {
  readonly provider = 'square' as const;
  readonly options: ResolvedSquareOptions; readonly store: PaymentsStore; readonly resources: PaymentsResources;
  readonly transport: SquareTransport; readonly native: SquareClient; readonly ownership: SquareOwnership;
  readonly charges: MerchantPayments; readonly worker: SquareJobs;
  private merchant: Promise<void> | null = null;
  private stopped = false; private requests = new Set<Promise<unknown>>(); private streamWakers = new Set<() => void>();
  timezone = 'UTC'; currency = '';
  readonly jobs = { list: (query?: PaymentsJobQuery) => { this.assertOpen(); return this.store.listJobs(query); },
    retry: (id: string) => { this.assertOpen(); if (!/^[A-Za-z0-9_-]{1,256}$/.test(id)) throw new PaymentsError('Invalid billing job ID.', 'PAYMENTS_INPUT_INVALID'); const result = this.store.replay(id); if (result) this.worker.wake(); return result; } };
  constructor(db: ReactiveDB, input: SquarePaymentsOptions, private readonly runtime: { emitCode?: (definition: PlatformCodeDefinition, options?: PlatformCodeEmitOptions) => unknown } = {}) {
    this.options = resolveSquareOptions(input);
    const ephemeral = this.options.mode === 'test' && this.options.allowEphemeralTestMode;
    if (!ephemeral && (db.getSQLiteService()?.mode !== 'file' || (db.prepare('PRAGMA synchronous').get() as { synchronous: number }).synchronous < 2)) throw new PaymentsError('Square requires file-backed SYSTEM persistence with synchronous FULL before financial acknowledgements.', 'PAYMENTS_DURABILITY_REQUIRED', 503);
    this.store = new PaymentsStore(db, this.options.connectionId, canonical({ provider: 'square', mode: this.options.mode, merchant: this.options.merchantId, location: this.options.locationId }));
    this.resources = new PaymentsResources(db, this.options.connectionId);
    this.transport = new SquareTransport(this.options, this.resources); this.native = this.transport.native;
    this.ownership = new SquareOwnership(this.native, this.store, this.resources, this.options);
    this.charges = createSquareMerchantCharges(this); this.worker = new SquareJobs(this);
  }
  status(): PaymentsReadiness {
    return { enabled: !this.stopped, provider: 'square', mode: this.options.mode, acceptingSales: !this.stopped && this.options.acceptingSales !== false,
      apiVersion: SQUARE_API_VERSION, webhookPath: this.options.webhookPath,
      operations: ['customers', 'operations', 'catalog', 'checkout', ...(this.options.portalUrl ? ['portal'] : []), 'subscriptions', 'invoices', 'payments', 'refunds', 'entitlements', 'webhooks', 'reconcile', 'watch', 'merchant-charges'],
      capabilities: { hostedCheckout: true, customerPortal: !!this.options.portalUrl, subscriptionPreview: false, subscriptionChange: 'next-period', cancellation: ['period-end'], invoicePdf: false } };
  }
  forAuthority(authority: PaymentsAuthority): ScopedPayments { return createScopedSquarePayments(this, authority); }
  assertOpen(): void { if (this.stopped) throw new PaymentsError('Square payments are stopping.', 'PAYMENTS_UNAVAILABLE', 503, 'none', true); }
  async tracked<T>(run: () => Promise<T>): Promise<T> { this.assertOpen(); const promise = this.transport.bounded(this.options.timeoutMs, run); this.requests.add(promise); try { return await promise; } finally { this.requests.delete(promise); } }
  async verifyMerchant(): Promise<void> {
    this.assertOpen();
    this.merchant ??= (async () => {
      const merchant = (await this.native.merchants.get({ merchantId: this.options.merchantId })).merchant;
      const location = (await this.native.locations.get({ locationId: this.options.locationId })).location;
      if (merchant?.id !== this.options.merchantId || location?.id !== this.options.locationId || location.merchantId !== merchant.id || location.status !== 'ACTIVE') throw new PaymentsError('Square token/location does not match the configured merchant.', 'PAYMENTS_MERCHANT_MISMATCH', 503);
      if (!location.timezone || !location.currency) return providerInvalid();
      new Intl.DateTimeFormat('en', { timeZone: location.timezone }); this.timezone = location.timezone; this.currency = location.currency.toLowerCase();
    })().catch(error => { this.merchant = null; throw squareError(error, true); });
    await this.merchant;
  }
  async read<T>(authority: PaymentsAuthority, action: BillingAction, run: (subject: BillingSubject) => T | Promise<T>): Promise<T> {
    return this.tracked(async () => { const subject = await guard(authority, this.options, action); let value: T;
      try { value = await run(subject); } catch (error) { if (error instanceof AuthError) throw error; throw squareError(error, true); }
      await guard(authority, this.options, action); return value; });
  }
  async command<T>(authority: PaymentsAuthority, action: BillingAction, id: string, input: unknown, run: (subject: BillingSubject, key: string) => Promise<T>): Promise<T> {
    operationId(id);
    return this.read(authority, action, async subject => { await this.verifyMerchant(); await guard(authority, this.options, action);
      return this.execute(subject, 'user:' + id, input, key => run(subject, key), () => {
        this.assertOpen(); if (authority.signal?.aborted) throw new PaymentsError('Payment request was cancelled.', 'PAYMENTS_REQUEST_CANCELLED', 499);
        if (subjectKey(billingSubject(authority, this.options, action)) !== subjectKey(subject)) throw new PaymentsError('Billing scope changed.', 'PAYMENTS_SCOPE_REQUIRED', 403);
      }); });
  }
  /** Explicit trusted merchant capability. No implicit customer, product or application-user association. */
  async merchantCommand<T>(id: string, input: unknown, run: (owner: BillingCommandOwner, key: string) => Promise<T>): Promise<T> {
    operationId(id); return this.tracked(async () => { await this.verifyMerchant(); const owner = { kind: 'merchant' as const, id: this.options.merchantId };
      return this.execute(owner, 'merchant:' + id, input, key => run(owner, key)); });
  }
  async merchantRead<T>(run: () => Promise<T>): Promise<T> { return this.tracked(async () => { await this.verifyMerchant(); try { return await run(); } catch (error) { throw squareError(error, true); } }); }
  async parameters<T>(key: string, kind: string, prepare: () => Promise<T>): Promise<T> { return this.store.providerRequest<T>(key, kind) ?? this.store.saveProviderRequest(key, kind, await prepare()); }
  /** Serialize conflicting resource mutations across processes, fencing the actual SDK send as well as the final result. */
  async withResource<T>(id: string, run: () => Promise<T>): Promise<T> {
    const lock = this.store.lock(id);
    if (!lock) throw new PaymentsError('Another operation is updating this billing resource. Retry the same operation ID.', 'PAYMENTS_RESOURCE_BUSY', 409, 'none', true);
    const assert = () => { try { this.store.assertLock(lock); } catch { throw new PaymentsError('Billing resource execution lost its lease.', 'PAYMENTS_LEASE_LOST', 409, 'none', true); } }, execution = this.transport.active;
    execution?.resourceFences?.add(assert);
    const timer = setInterval(() => { try { this.store.renew(lock); } catch {} }, 30000); timer.unref?.();
    try { const result = await run(); assert(); return result; }
    finally { clearInterval(timer); execution?.resourceFences?.delete(assert); this.store.release(lock); }
  }
  private async execute<T>(owner: BillingCommandOwner, id: string, input: unknown, run: (key: string) => Promise<T>, authority = this.transport.active?.assertAuthority): Promise<T> {
    const ticket = this.store.reserve(owner, id, input); if ('replay' in ticket) return ticket.replay as T;
    const timer = setInterval(() => { try { this.store.renewCommand(owner, id, ticket.fence); } catch {} }, 30000); timer.unref?.();
    const execution: SquareExecution = { key: ticket.key, assertCurrent: () => { this.assertOpen(); this.store.assertCommand(owner, id, ticket.fence); }, assertAuthority: authority, resourceFences: new Set(), attempted: false, accepted: false };
    let result: T;
    try { result = await this.transport.run(execution, () => run(ticket.key)); }
    catch (error) {
      const cause = execution.blocked ?? error;
      const mapped = execution.accepted || execution.blocked && execution.attempted ? new PaymentsError('Square may have accepted this operation. Reconcile its original ID.', 'PAYMENTS_OUTCOME_UNKNOWN', 409, 'unknown')
        : cause instanceof AuthError ? new PaymentsError('Billing authority changed before Square admission.', 'PAYMENTS_AUTHORITY_CHANGED', 403, 'none', true) : squareError(cause);
      try { this.store.finish(owner, id, ticket.fence, null, mapped); } catch { throw new PaymentsError('Square result could not be durably recorded. Reconcile the original ID.', 'PAYMENTS_OUTCOME_UNKNOWN', 409, 'unknown'); }
      if (mapped.outcome === 'unknown') this.observe(OBS_CODES.PAYMENTS_COMMAND_UNKNOWN, { operationDigest: hash(canonical([owner, id])), reason: mapped.code });
      throw mapped;
    } finally { clearInterval(timer); }
    try { this.store.finish(owner, id, ticket.fence, result); } catch { throw new PaymentsError('Square result could not be durably recorded. Reconcile the original ID.', 'PAYMENTS_OUTCOME_UNKNOWN', 409, 'unknown'); }
    return result;
  }
  async ensureCustomer(input: BillingSubject): Promise<string> {
    const subject = trustedSubject(input);
    return this.tracked(async () => {
    const bound = this.store.customer(subject); if (bound) return bound; await this.verifyMerchant();
    const result = await this.execute(subject, 'system:customer-v1', { type: 'customer.ensure', subject }, async key => {
      const customer = (await this.native.customers.create({ idempotencyKey: squareWireKey(key), givenName: 'Zero customer', referenceId: hash(subjectKey(subject)).slice(0, 40) })).customer;
      if (!customer?.id) return providerInvalid(); return { id: customer.id };
    });
    this.store.bind(subject, result.id); this.enqueue(result.id); return result.id;
    });
  }
  async adoptCustomer(input: BillingSubject, customerId: string): Promise<void> { const subject = trustedSubject(input); squareId(customerId); return this.tracked(async () => { await this.verifyMerchant(); const value = (await this.native.customers.get({ customerId })).customer; if (!value?.id || value.id !== customerId) return providerInvalid(); this.store.bind(subject, customerId); this.resources.bind(subject, 'adopted-customer', customerId, {}); this.enqueue(customerId); }); }
  enqueue(customer: string) { this.store.admit('reconcile-' + crypto.randomUUID(), 'reconcile', '{}', customer); this.worker.wake(); }
  snapshot(subject: BillingSubject): BillingSnapshot {
    const stored: StoredBillingSnapshot = this.store.view(subject) ?? { subject, provider: 'square', mode: this.options.mode, revision: 0, customer: null, subscriptions: [], invoices: [], payments: [], entitlements: {}, reconciledAt: null, stale: true, policyVersion: this.options.policyVersion, entitlementsValidUntil: null, _grants: [] };
    const age = stored.reconciledAt ? Date.now() - Date.parse(stored.reconciledAt) : Infinity;
    const stale = !Number.isFinite(age) || age > this.options.maxProjectionAgeMs || stored.policyVersion !== this.options.policyVersion;
    const grants = evaluateGrants(stored._grants ?? []), entitlements = stale ? {} : grants.entitlements;
    return { ...publicSnapshot(stored), stale, entitlements, entitlementsValidUntil: grants.validUntil, version: hash(canonical([stored.revision, stale, entitlements, stored.policyVersion])) };
  }
  reconcileCustomer(customerId: string): Promise<BillingSnapshot> { return this.tracked(() => reconcileSquareCustomer(this, customerId)); }
  acceptWebhook(payload: string, signature: string) { return this.tracked(() => this.worker.accept(payload, signature)); }
  drain(limit = 25) { this.assertOpen(); return this.worker.drain(limit); }
  start() { this.assertOpen(); this.worker.start(); }
  async stop(): Promise<void> { this.stopped = true; this.transport.stop(); this.streamWakers.forEach(wake => wake()); await this.worker.stop(); await Promise.allSettled([...this.requests]); }
  observe(code: PlatformCodeDefinition, metadata: Record<string, unknown>) { try { void Promise.resolve(this.runtime.emitCode?.(code, { metadata: { connectionId: this.options.connectionId, provider: 'square', mode: this.options.mode, ...metadata } })).catch(() => {}); } catch {} }
  async *watch(authority: PaymentsAuthority, signal?: AbortSignal): AsyncIterable<BillingRevision> {
    this.assertOpen(); const subject = await guard(authority, this.options, 'read'); let wake: (() => void) | null = null, dirty = false, cleaned = false;
    this.assertOpen();
    const subscription = this.store.db.onChange(change => { if (change.table === PAYMENTS_VIEW_TABLE && change.row?.connection === this.options.connectionId && change.row?.subject === subjectKey(subject)) { dirty = true; wake?.(); } });
    const abort = () => { if (!cleaned) { cleaned = true; subscription(); this.streamWakers.delete(abort); signal?.removeEventListener('abort', abort); authority.signal?.removeEventListener('abort', abort); } wake?.(); };
    this.streamWakers.add(abort); signal?.addEventListener('abort', abort); authority.signal?.addEventListener('abort', abort);
    try { while (!this.stopped && !signal?.aborted && !authority.signal?.aborted) {
      dirty = false; await guard(authority, this.options, 'read'); if (this.stopped || signal?.aborted || authority.signal?.aborted) break;
      const snapshot = this.snapshot(subject); yield { revision: snapshot.revision, version: snapshot.version }; if (dirty) continue;
      await new Promise<void>(resolve => { const delay = snapshot.entitlementsValidUntil === null ? 15000 : Math.min(15000, Math.max(1, snapshot.entitlementsValidUntil * 1000 - Date.now())); const timer = setTimeout(done, delay);
        function done() { clearTimeout(timer); wake = null; resolve(); } wake = done; if (signal?.aborted || authority.signal?.aborted || this.stopped) done(); });
    } } finally { abort(); }
  }
}
