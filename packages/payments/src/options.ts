import type Stripe from 'stripe';
import type { AccessRequirement } from '@zero/framework/server';
import type { BillingOffer } from '@zero/framework/payments';
import { invalid } from './errors';

export interface StripeOffer {
  label: string; price: string; kind: 'payment' | 'subscription';
  quantity?: { min?: number; max?: number };
  features?: Record<string, boolean | number>;
}
export interface PaymentsOptions {
  /** Explicit test/live prevents silently crossing environments. No key auto-enables the plugin. */
  mode: 'test' | 'live'; connectionId: string; secretKey?: string;
  /** Exact platform merchant ID. Connected accounts are never admitted by an HTTP parameter. */
  accountId: string;
  webhookSecrets?: readonly string[];
  catalog: Record<string, StripeOffer>;
  policyVersion: string;
  subject?: 'auto' | 'user' | 'organization';
  access?: { read?: AccessRequirement; manage?: AccessRequirement; refund?: AccessRequirement; reconcile?: AccessRequirement };
  acceptingSales?: boolean;
  successUrl: string; cancelUrl: string; portalReturnUrl: string; allowedOrigins: readonly string[];
  basePath?: string; webhookPath?: string;
  timeoutMs?: number; maxNetworkRetries?: number; callbackTimeoutMs?: number;
  /** Default denies grants whose projection is older than this (5 minutes). No implicit billing grace policy. */
  maxProjectionAgeMs?: number;
  /** Trusted transport injection for fixtures/proxies, never projected to the browser. */
  httpClient?: NonNullable<Stripe.StripeConfig['httpClient']>;
  /** Fixtures only, test mode only. Real billing requires a file-backed system database. */
  allowEphemeralTestMode?: boolean;
  /** Outbox callback is at-least-once and receives a stable event ID, not raw event bodies. */
  onChange?: (input: { eventId: string; subject: import('@zero/framework/payments').BillingSubject; snapshot: import('@zero/framework/payments').BillingSnapshot }, context: { signal: AbortSignal }) => Promise<void>;
  /** At-least-once canonical event hook for order fulfillment / Fabric workflows. Deduplicate by eventId. */
  onEvent?: (input: import('@zero/framework/payments').BillingEvent, context: { signal: AbortSignal }) => Promise<void>;
}
export interface ResolvedPaymentsOptions extends PaymentsOptions {
  secretKey: string; webhookSecrets: readonly string[]; basePath: string; webhookPath: string;
  timeoutMs: number; maxNetworkRetries: number; maxProjectionAgeMs: number; callbackTimeoutMs: number;
  offers: ReadonlyMap<string, StripeOffer & { id: string; quantity: { min: number; max: number }; features: Record<string, boolean | number> }>;
}
export function resolvePaymentsOptions(input: PaymentsOptions): ResolvedPaymentsOptions {
  if (!input || !['test', 'live'].includes(input.mode) || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.connectionId) || !/^acct_[a-zA-Z0-9]+$/.test(input.accountId) || !/^[a-zA-Z0-9_.-]{1,80}$/.test(input.policyVersion)) invalid('A mode, connection ID, merchant account ID and policy version are required.');
  const secretKey = input.secretKey ?? Bun.env.STRIPE_SECRET_KEY ?? '';
  if (!new RegExp(`^(?:sk|rk)_${input.mode}_[a-zA-Z0-9_]+$`).test(secretKey)) invalid('A secret/restricted key matching the configured Stripe mode is required.');
  const webhookSecrets = input.webhookSecrets ?? (Bun.env.STRIPE_WEBHOOK_SECRET ? [Bun.env.STRIPE_WEBHOOK_SECRET] : []);
  if (!webhookSecrets.length || webhookSecrets.length > 4 || webhookSecrets.some(value => !/^whsec_[a-zA-Z0-9_]+$/.test(value))) invalid('Configure one to four Stripe webhook signing secrets.');
  if (!Array.isArray(input.allowedOrigins) || !input.allowedOrigins.length || input.allowedOrigins.length > 20) invalid('Explicit allowed return origins are required.');
  const origins = input.allowedOrigins.map(value => { const url = safeReturnUrl(value); if (url.origin !== value) invalid('Return origins must be exact origins, not paths.'); return url.origin; });
  for (const value of [input.successUrl, input.cancelUrl, input.portalReturnUrl]) if (!origins.includes(safeReturnUrl(value).origin)) invalid('A return URL is outside the declared origins.');
  const basePath = input.basePath ?? '/api/_zero/payments', webhookPath = input.webhookPath ?? '/api/webhooks/stripe';
  for (const path of [basePath, webhookPath]) if (!/^\/[a-zA-Z0-9/_-]+$/.test(path) || path.endsWith('/')) invalid('Payment route paths must be absolute normalized paths.');
  if (basePath === webhookPath || webhookPath.startsWith(basePath + '/') || basePath.startsWith(webhookPath + '/')) invalid('Webhook and authenticated API paths must be disjoint.');
  const offers = new Map< string, StripeOffer & { id: string; quantity: { min: number; max: number }; features: Record<string, boolean | number> }>();
  if (!input.catalog || typeof input.catalog !== 'object' || Object.keys(input.catalog).length > 100) invalid('A bounded server-owned offer catalog is required.');
  const prices = new Set<string>(), featureTypes = new Map<string, string>();
  for (const [id, offer] of Object.entries(input.catalog)) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !offer || !/^price_[a-zA-Z0-9]+$/.test(offer.price) || !['payment', 'subscription'].includes(offer.kind) || typeof offer.label !== 'string' || !offer.label.trim() || offer.label.length > 160 || prices.has(offer.price)) invalid('Offer IDs/prices must be unique, bounded and valid.');
    prices.add(offer.price); const min = offer.quantity?.min ?? 1, max = offer.quantity?.max ?? 1;
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min || max > 100000) invalid('Offer quantity bounds are invalid.');
    const features = offer.features ?? {};
    if (Object.keys(features).length > 100 || Object.entries(features).some(([key, value]) => !/^[a-zA-Z0-9_.-]{1,100}$/.test(key) || !(typeof value === 'boolean' || Number.isSafeInteger(value) && (value as number) >= 0))) invalid('Offer features must be declared boolean or nonnegative integer grants.');
    for (const [key, value] of Object.entries(features)) {
      if (featureTypes.has(key) && featureTypes.get(key) !== typeof value) invalid('An entitlement key must have one consistent type across offers.');
      featureTypes.set(key, typeof value);
    }
    offers.set(id, Object.freeze({ ...offer, id, features: Object.freeze({ ...features }), quantity: Object.freeze({ min, max }) }));
  }
  const timeoutMs = input.timeoutMs ?? 30000, maxNetworkRetries = input.maxNetworkRetries ?? 1, maxProjectionAgeMs = input.maxProjectionAgeMs ?? 300000, callbackTimeoutMs = input.callbackTimeoutMs ?? 15000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000 || !Number.isInteger(maxNetworkRetries) || maxNetworkRetries < 0 || maxNetworkRetries > 2 || !Number.isSafeInteger(maxProjectionAgeMs) || maxProjectionAgeMs < 1000 || maxProjectionAgeMs > 86400000) invalid('Payment timeout, retry or projection-age bounds are invalid.');
  if (input.allowEphemeralTestMode && input.mode !== 'test') invalid('Ephemeral billing persistence is only available to explicit test fixtures.');
  if (!Number.isInteger(callbackTimeoutMs) || callbackTimeoutMs < 100 || callbackTimeoutMs > 60000) invalid('Callback timeout must be 100–60000ms.');
  return Object.freeze({ ...input, access: input.access ? structuredClone(input.access) : undefined, secretKey, webhookSecrets: Object.freeze([...webhookSecrets]), offers, basePath, webhookPath, allowedOrigins: Object.freeze(origins), timeoutMs, maxNetworkRetries, maxProjectionAgeMs, callbackTimeoutMs });
}
export function safeReturnUrl(value: string): URL {
  let url: URL; try { url = new URL(value); } catch { return invalid('Return URLs must be absolute.'); }
  if (url.username || url.password || url.hash || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) invalid('Use HTTPS return URLs (HTTP is only permitted on loopback).');
  return url;
}
export function publicOffers(options: ResolvedPaymentsOptions): BillingOffer[] { return [...options.offers.values()].map(offer => ({ id: offer.id, label: offer.label, kind: offer.kind, quantity: { ...offer.quantity }, features: { ...offer.features } })); }
