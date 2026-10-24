/** Verified Square inbox, canonical event routing and at-least-once callbacks. No webhook body can select a user/tenant or directly grant entitlement. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Square } from 'square';
import type { BillingEvent, MerchantPaymentEvent } from '@zero/framework/payments';
import { OBS_CODES } from '@zero/framework/observability';
import type { SquarePayments } from './service';
import { canonical } from '../store';
import { PaymentsError } from '../errors';
import { squareId, SQUARE_API_VERSION } from './options';
import { invoiceView, money, paymentView, refundView, timestamp } from './models';
import type { PaymentResource } from '../resources';

interface SquareEvent { id: string; type: string; merchantId: string; createdAt: number; kind: 'payment' | 'refund' | 'subscription' | 'invoice' | 'customer' | 'order'; resourceId: string }
export class SquareJobs {
  private stopped = false; private timer: ReturnType<typeof setTimeout> | null = null; private running: Promise<void> | null = null;
  private readonly callbacks = new Set<AbortController>();
  constructor(private readonly service: SquarePayments) {}
  async accept(payload: string, signature: string): Promise<{ received: true; supported: boolean }> {
    this.service.assertOpen();
    if (typeof payload !== 'string' || Buffer.byteLength(payload, 'utf8') > 512 * 1024) throw new PaymentsError('Webhook body is too large.', 'PAYMENTS_WEBHOOK_TOO_LARGE', 413);
    if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) throw new PaymentsError('Square signature is invalid.', 'PAYMENTS_WEBHOOK_SIGNATURE_INVALID', 400);
    const bytes = Buffer.from(signature, 'base64'); let valid = false;
    for (const key of this.service.options.webhookSignatureKeys) {
      const expected = createHmac('sha256', key).update(this.service.options.webhookNotificationUrl).update(payload).digest();
      valid = timingSafeEqual(expected, bytes) || valid;
    }
    if (!valid) throw new PaymentsError('Square signature is invalid.', 'PAYMENTS_WEBHOOK_SIGNATURE_INVALID', 400);
    let value: Record<string, any>; try { value = JSON.parse(payload); } catch { throw new PaymentsError('Square event is not JSON.', 'PAYMENTS_WEBHOOK_FORMAT_INVALID', 400); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.merchant_id !== this.service.options.merchantId) throw new PaymentsError('Square event belongs to another merchant.', 'PAYMENTS_WEBHOOK_SCOPE_INVALID', 400);
    if (value.api_version !== undefined && value.api_version !== SQUARE_API_VERSION) throw new PaymentsError('Square webhook version does not match this integration.', 'PAYMENTS_WEBHOOK_VERSION_INVALID', 400);
    if (typeof value.event_id !== 'string' || !/^[A-Za-z0-9_-]{1,192}$/.test(value.event_id) || typeof value.type !== 'string') throw new PaymentsError('Square event identity is invalid.', 'PAYMENTS_WEBHOOK_FORMAT_INVALID', 400);
    const kind = value.type.split('.')[0] as SquareEvent['kind'];
    if (!['payment', 'refund', 'subscription', 'invoice', 'customer', 'order'].includes(kind) || !/^(payment|refund|subscription|invoice|customer|order)\.[a-z_.]+$/.test(value.type)) return { received: true, supported: false };
    const id = value.data?.id ?? value.data?.object?.[kind]?.id;
    let resourceId: string, createdAt: number;
    try { resourceId = squareId(id); createdAt = timestamp(value.created_at); } catch { throw new PaymentsError('Square event resource/time is invalid.', 'PAYMENTS_WEBHOOK_FORMAT_INVALID', 400); }
    const event: SquareEvent = { id: value.event_id, type: value.type, merchantId: value.merchant_id, createdAt, kind, resourceId };
    this.service.store.admit(event.id, 'webhook', canonical(event)); this.wake(); return { received: true, supported: true };
  }
  start() { this.wake(); }
  wake() { if (this.stopped || this.timer) return; this.timer = setTimeout(() => { this.timer = null; void this.drain().catch(() => this.service.observe(OBS_CODES.PAYMENTS_WORKER_FAILED, {})).finally(() => this.schedule()); }, 0); this.timer.unref?.(); }
  private schedule() { if (this.stopped || this.timer) return; this.timer = setTimeout(() => { this.timer = null; this.wake(); }, 1000); this.timer.unref?.(); }
  async stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; this.callbacks.forEach(controller => controller.abort()); if (this.running) await this.running; }
  drain(limit = 25): Promise<void> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return Promise.reject(new PaymentsError('Invalid billing worker limit.', 'PAYMENTS_INPUT_INVALID'));
    if (this.running) return this.running;
    this.running = this.service.transport.outside(async () => {
      this.service.store.queueRefreshes(this.service.options.maxProjectionAgeMs / 2);
      for (let i = 0; i < limit && !this.stopped; i++) {
        const row = this.service.store.claim(); if (!row) break;
        const heartbeat = setInterval(() => { try { this.service.store.renewInbox(row); } catch {} }, 30000); heartbeat.unref?.();
        try {
          if (row.kind === 'notify') {
            this.service.store.assertInbox(row); const value = JSON.parse(row.payload);
            if (this.service.options.onChange) await this.callback(signal => this.service.options.onChange!({ eventId: row.id, ...value }, { signal }));
          } else if (row.kind === 'reconcile') {
            if (row.customer) await this.service.reconcileCustomer(row.customer);
          } else {
            const event = JSON.parse(row.payload) as SquareEvent;
            const resolved = await this.service.transport.bounded(this.service.options.timeoutMs, async () => { await this.service.verifyMerchant(); return this.resolve(event); });
            if (resolved) {
              const { owner, reference } = resolved.record;
              const intent = reference ? this.service.resources.getIntent(reference) : null;
              if (owner.kind !== 'merchant') {
                const customer = this.service.store.customer(owner); if (!customer) throw new PaymentsError('Owned billing resource has no customer binding.', 'PAYMENTS_CUSTOMER_UNBOUND', 409);
                await this.service.reconcileCustomer(customer);
              }
              if (owner.kind === 'merchant' || intent?.owner.kind === 'merchant') {
                if (intent && this.service.options.onMerchantEvent) {
                  const value: MerchantPaymentEvent = { eventId: event.id, type: event.type, provider: 'square', providerCreatedAt: event.createdAt, operationId: intent.operationId,
                    ...(typeof intent.details.reference === 'string' ? { reference: intent.details.reference } : {}), resource: resolved.resource };
                  this.service.store.assertInbox(row); await this.callback(signal => this.service.options.onMerchantEvent!(value, { signal }));
                }
              } else {
                if (this.service.options.onEvent) {
                  const value: BillingEvent = { eventId: event.id, type: event.type, subject: owner, providerCreatedAt: event.createdAt, resource: resolved.resource };
                  this.service.store.assertInbox(row); await this.callback(signal => this.service.options.onEvent!(value, { signal }));
                }
              }
            }
          }
          this.service.store.complete(row);
        } catch (error) {
          const reason = error instanceof PaymentsError ? error.code : 'PAYMENTS_PROCESSING_FAILED'; this.service.store.fail(row, reason);
          this.service.observe(row.attempts >= 12 ? OBS_CODES.PAYMENTS_JOB_QUARANTINED : OBS_CODES.PAYMENTS_JOB_RETRY, { jobId: row.id, kind: row.kind, attempt: row.attempts, reason });
        } finally { clearInterval(heartbeat); }
      }
    }).finally(() => { this.running = null; }); return this.running;
  }
  private async callback(run: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController(); this.callbacks.add(controller); let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([Promise.resolve().then(() => run(controller.signal)), new Promise<never>((_, reject) => {
      const fail = () => reject(new PaymentsError('Billing callback timed out or stopped.', 'PAYMENTS_CALLBACK_TIMEOUT', 503));
      controller.signal.addEventListener('abort', fail, { once: true }); timer = setTimeout(() => controller.abort(), this.service.options.callbackTimeoutMs);
      if (controller.signal.aborted) fail();
    })]); } finally { if (timer) clearTimeout(timer); controller.abort(); this.callbacks.delete(controller); }
  }
  private async resolve(event: SquareEvent): Promise<{ record: PaymentResource; resource: BillingEvent['resource'] } | null> {
    if (event.kind === 'customer') {
      const owner = this.service.store.owner(event.resourceId); if (!owner) return null;
      return { record: { kind: 'customer', id: event.resourceId, owner, reference: null, data: null, created: 0 }, resource: { id: event.resourceId, kind: 'customer', status: event.type === 'customer.deleted' ? 'deleted' : 'active' } };
    }
    const record = await this.service.ownership[event.kind](event.resourceId) as PaymentResource<any> | null;
    if (!record?.data) return null;
    // External refunds can only correlate to the originating payment, never to an invented refund operation.
    if (event.kind === 'refund' && !record.reference && record.data.paymentId) record.reference = this.service.resources.get('payment', record.data.paymentId)?.reference ?? null;
    let resource: BillingEvent['resource'] = { id: record.id, kind: event.kind, status: record.data.status?.toLowerCase() ?? record.data.state?.toLowerCase() ?? null };
    if (event.kind === 'payment') { const view = paymentView(record.data); resource = { id: view.id, kind: 'payment', status: view.status, total: view.total, paymentStatus: view.status === 'succeeded' ? 'paid' : 'unpaid' }; }
    if (event.kind === 'invoice') { const view = invoiceView(record.data); resource = { id: view.id, kind: 'invoice', status: view.status, total: view.total }; }
    if (event.kind === 'refund') { const view = refundView(record.data); resource = { id: view.id, kind: 'refund', status: view.status, total: view.total }; }
    const intent = record.reference ? this.service.resources.getIntent(record.reference) : null;
    if (typeof intent?.details.offer === 'string' && this.service.options.offers.has(intent.details.offer)) resource.offer = intent.details.offer;
    return { record, resource };
  }
}
