/** Optional Stripe integration. Importing/installing this package alone starts nothing. */
import { defineEndpoint, defineRouter, defineZeroPlugin, type ServerRouteServices, type ZeroLifecycleContext, type ZeroRouterDefinition } from '@zero/framework/server';
import { registerPaymentsBackend } from '@zero/framework/payments';
import type { ScopedPayments } from '@zero/framework/payments';
import { StripePayments } from './service';
import { resolvePaymentsOptions, type PaymentsOptions } from './options';
import { PaymentsError } from './errors';
import { paymentEndpoint, paymentErrorResponse, paymentEvents, readWebhookBody } from './http';

export function stripePayments(input: PaymentsOptions): ZeroRouterDefinition {
  const options = resolvePaymentsOptions(input);
  const endpoint = (method: 'GET' | 'POST', path: string, run: (payments: ScopedPayments, context: ZeroLifecycleContext) => unknown) => defineEndpoint({ method, path, auth: 'user', handler: context => paymentEndpoint(() => {
    const payments = context.zero.payments;
    if (!payments) throw new PaymentsError('Payments are not configured for this application.', 'PAYMENTS_UNAVAILABLE', 503);
    return run(payments, context);
  }) });
  return defineRouter({ name: `payments-${options.connectionId}`, routes: [
    defineZeroPlugin({ name: `payments-${options.connectionId}-runtime`, setup: ({ app, zero, emitCode }) => {
      if (!zero.system) throw new PaymentsError('Payments require the Zero system database.', 'PAYMENTS_DURABILITY_REQUIRED', 503);
      for (const policy of Object.values(options.access ?? {})) if (policy !== undefined) zero.auth.authorizationKernel?.compile(policy);
      const service = new StripePayments(zero.system.db, options, { emitCode });
      const unregister = registerPaymentsBackend(zero.db, service);
      app.post(options.webhookPath, async ({ request }) => {
        try {
          const signature = request.headers.get('stripe-signature');
          if (!signature || signature.length > 8192) throw new PaymentsError('Stripe signature is required.', 'PAYMENTS_WEBHOOK_SIGNATURE_INVALID', 400);
          const result = await service.acceptWebhook(await readWebhookBody(request), signature);
          return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
        } catch (error) {
          if (error instanceof PaymentsError) return paymentErrorResponse(error);
          // Never acknowledge a delivery if durable admission failed; Stripe must retry it.
          return paymentErrorResponse(new PaymentsError('Webhook could not be durably accepted.', 'PAYMENTS_WEBHOOK_UNAVAILABLE', 503));
        }
      }, { parse: 'none' });
      app.onStart(() => { service.start(); });
      app.onStop(async () => { unregister(); await service.stop(); });
      return app;
    } }),
    defineRouter({ name: `payments-${options.connectionId}-api`, prefix: options.basePath, auth: 'user', routes: [
      endpoint('GET', '/status', p => p.status()),
      endpoint('GET', '/catalog', p => p.catalog()),
      endpoint('GET', '/snapshot', p => p.snapshot()),
      endpoint('GET', '/operations/:id', (p, c) => p.operations.read((c.params as { id: string }).id)),
      endpoint('POST', '/customers/ensure', (p, c) => p.customers.ensure(c.body as never)),
      endpoint('POST', '/checkout', (p, c) => p.checkout.create(c.body as never)),
      endpoint('GET', '/checkout/:id', (p, c) => p.checkout.read((c.params as { id: string }).id)),
      endpoint('POST', '/portal', (p, c) => p.portal.create(c.body as never)),
      endpoint('GET', '/subscriptions', p => p.subscriptions.list()),
      endpoint('POST', '/subscriptions/preview', (p, c) => p.subscriptions.preview(c.body as never)),
      endpoint('POST', '/subscriptions/change', (p, c) => p.subscriptions.change(c.body as never)),
      endpoint('POST', '/subscriptions/cancel', (p, c) => p.subscriptions.cancel(c.body as never)),
      endpoint('POST', '/subscriptions/resume', (p, c) => p.subscriptions.resume(c.body as never)),
      endpoint('GET', '/invoices', (p, c) => p.invoices.list(page(c.query))),
      endpoint('GET', '/invoices/:id', (p, c) => p.invoices.read((c.params as { id: string }).id)),
      endpoint('GET', '/invoices/:id/document', (p, c) => p.invoices.document((c.params as { id: string }).id)),
      endpoint('GET', '/payments', (p, c) => p.payments.list(page(c.query))),
      endpoint('POST', '/refunds', (p, c) => p.refunds.create(c.body as never)),
      endpoint('GET', '/refunds', (p, c) => { const q = c.query as { paymentId?: string }; return p.refunds.list({ ...page(c.query), paymentId: q.paymentId! }); }),
      endpoint('GET', '/entitlements', p => p.entitlements.read()),
      endpoint('POST', '/reconcile', p => p.reconcile()),
      endpoint('GET', '/events', (p, c) => paymentEvents(p, c.request)),
    ] }),
  ] });
}
function page(value: unknown): { limit?: number; after?: string } {
  const input = value as { limit?: string; after?: string };
  return { ...(input.limit !== undefined ? { limit: /^\d+$/.test(input.limit) ? Number(input.limit) : NaN } : {}), ...(input.after !== undefined ? { after: input.after } : {}) };
}
/** Trusted setup/workflow integration, not a request-level merchant facade. */
export function getStripePayments(zero: Pick<ServerRouteServices, 'payments'>): StripePayments {
  if (!(zero.payments instanceof StripePayments)) throw new PaymentsError('Stripe Payments is not installed in this runtime.', 'PAYMENTS_UNAVAILABLE', 503);
  return zero.payments;
}
export { StripePayments, PaymentsError };
export type { PaymentsOptions, StripeOffer } from './options';
export type { PaymentsJob, PaymentsJobStatus, PaymentsJobQuery, PaymentsJobPage } from './jobs';
export type * from '@zero/framework/payments';
