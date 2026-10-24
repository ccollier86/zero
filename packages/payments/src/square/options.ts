/** Server-owned Square configuration. No token auto-enables a provider or changes the configured environment. */
import { compileAccessRequirement } from '@zero/framework/server';
import type { PaymentsOptions } from '../options';
import { safeReturnUrl } from '../options';
import { invalid } from '../errors';

export const SQUARE_API_VERSION = '2026-09-16' as const;
export type SquareOffer = {
  label: string; features?: Record<string, boolean | number>; quantity?: { min?: number; max?: number };
} & ({ kind: 'payment'; itemVariationId: string } | { kind: 'subscription'; planVariationId: string });
export interface SquarePaymentsOptions extends Pick<PaymentsOptions, 'mode' | 'connectionId' | 'policyVersion' | 'subject' | 'access' | 'acceptingSales' | 'successUrl' | 'allowedOrigins' | 'basePath' | 'webhookPath' | 'timeoutMs' | 'maxProjectionAgeMs' | 'callbackTimeoutMs' | 'allowEphemeralTestMode' | 'onChange' | 'onEvent' | 'onMerchantEvent'> {
  merchantId: string; locationId: string; accessToken?: string;
  webhookSignatureKeys?: readonly string[];
  /** Exact externally registered URL, not derived from request Host/proxy headers. */
  webhookNotificationUrl: string;
  catalog: Record<string, SquareOffer>;
  /** Optional existing, authenticated application billing UI; Square has no Stripe-style portal API. */
  portalUrl?: string;
  /** Trusted fixture/proxy transport, never exposed by the browser facade. */
  fetch?: typeof globalThis.fetch;
}
export interface ResolvedSquareOptions extends SquarePaymentsOptions {
  accessToken: string; webhookSignatureKeys: readonly string[]; basePath: string; webhookPath: string;
  timeoutMs: number; maxProjectionAgeMs: number; callbackTimeoutMs: number;
  offers: ReadonlyMap<string, SquareOffer & { id: string; quantity: { min: number; max: number }; features: Record<string, boolean | number> }>;
}
export function squareId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{1,192}$/.test(value)) invalid('Invalid Square resource ID.');
  return value;
}
export function resolveSquareOptions(input: SquarePaymentsOptions): ResolvedSquareOptions {
  if (!input || !['test', 'live'].includes(input.mode) || typeof input.connectionId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(input.connectionId) || typeof input.policyVersion !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(input.policyVersion)) invalid('Square requires an explicit mode, connection ID and policy version.');
  squareId(input.merchantId); squareId(input.locationId);
  if (input.subject !== undefined && !['auto', 'user', 'organization'].includes(input.subject)) invalid('Billing subject must be auto, user or organization.');
  if (input.access !== undefined && (!input.access || typeof input.access !== 'object' || Array.isArray(input.access) || Object.keys(input.access).some(key => !['read', 'manage', 'refund', 'reconcile'].includes(key)))) invalid('Unknown payment access policy.');
  for (const requirement of Object.values(input.access ?? {})) if (requirement !== undefined) compileAccessRequirement(requirement);
  for (const value of [input.acceptingSales, input.allowEphemeralTestMode]) if (value !== undefined && typeof value !== 'boolean') invalid('Payment switches must be booleans.');
  for (const callback of [input.onChange, input.onEvent, input.onMerchantEvent]) if (callback !== undefined && typeof callback !== 'function') invalid('Payment callbacks must be functions.');
  if (input.fetch !== undefined && typeof input.fetch !== 'function') invalid('Square fetch must be a trusted transport function.');
  const accessToken = input.accessToken ?? Bun.env.SQUARE_ACCESS_TOKEN ?? '';
  if (typeof accessToken !== 'string' || accessToken.length < 16 || accessToken.length > 4096 || /\s/.test(accessToken)) invalid('A private Square access token is required.');
  const keys = input.webhookSignatureKeys ?? (Bun.env.SQUARE_WEBHOOK_SIGNATURE_KEY ? [Bun.env.SQUARE_WEBHOOK_SIGNATURE_KEY] : []);
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 4 || keys.some(key => typeof key !== 'string' || key.length < 16 || key.length > 512 || /\s/.test(key))) invalid('Configure one to four Square webhook signature keys.');
  safeReturnUrl(input.webhookNotificationUrl);
  safeReturnUrl(input.successUrl);
  if (!Array.isArray(input.allowedOrigins) || !input.allowedOrigins.length || input.allowedOrigins.length > 20) invalid('Explicit return origins are required.');
  const origins = input.allowedOrigins.map(value => { const url = safeReturnUrl(value); if (url.origin !== value) invalid('Return origins must be exact origins.'); return value; });
  for (const value of [input.successUrl, input.portalUrl].filter((v): v is string => v !== undefined)) if (!origins.includes(safeReturnUrl(value).origin)) invalid('A return URL is outside declared origins.');
  const basePath = input.basePath ?? '/api/_zero/payments', webhookPath = input.webhookPath ?? '/api/webhooks/square';
  for (const path of [basePath, webhookPath]) if (!/^\/[A-Za-z0-9/_-]+$/.test(path) || path.includes('//') || path.endsWith('/')) invalid('Payment paths must be normalized absolute paths.');
  if (basePath === webhookPath || basePath.startsWith(webhookPath + '/') || webhookPath.startsWith(basePath + '/')) invalid('Webhook and authenticated API paths must be disjoint.');
  const timeoutMs = input.timeoutMs ?? 30000, maxProjectionAgeMs = input.maxProjectionAgeMs ?? 300000, callbackTimeoutMs = input.callbackTimeoutMs ?? 15000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000 || !Number.isInteger(maxProjectionAgeMs) || maxProjectionAgeMs < 1000 || maxProjectionAgeMs > 86400000 || !Number.isInteger(callbackTimeoutMs) || callbackTimeoutMs < 100 || callbackTimeoutMs > 60000) invalid('Square timing bounds are invalid.');
  if (input.allowEphemeralTestMode && input.mode !== 'test') invalid('Ephemeral billing is limited to explicit test fixtures.');
  if (!input.catalog || typeof input.catalog !== 'object' || Array.isArray(input.catalog) || Object.keys(input.catalog).length > 100) invalid('A bounded server-owned Square catalog is required (it may be empty for merchant-only charges).');
  const offers = new Map<string, SquareOffer & { id: string; quantity: { min: number; max: number }; features: Record<string, boolean | number> }>(), ids = new Set<string>(), featureTypes = new Map<string, string>();
  for (const [id, offer] of Object.entries(input.catalog)) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !offer || typeof offer.label !== 'string' || !offer.label.trim() || offer.label.length > 160 || !['payment', 'subscription'].includes(offer.kind)) invalid('Square offers must have valid IDs, labels and kinds.');
    const providerId = squareId(offer.kind === 'payment' ? offer.itemVariationId : offer.planVariationId);
    if (ids.has(providerId)) invalid('Square catalog objects must map to one offer each.'); ids.add(providerId);
    const min = offer.quantity?.min ?? 1, max = offer.quantity?.max ?? 1;
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min || max > 100000 || offer.kind === 'subscription' && (min !== 1 || max !== 1)) invalid('Invalid quantity bounds. Square hosted subscriptions have quantity one.');
    const features = offer.features ?? {};
    if (typeof features !== 'object' || Array.isArray(features) || Object.keys(features).length > 100) invalid('Features must be a bounded entitlement map.');
    for (const [key, value] of Object.entries(features)) {
      if (!/^[A-Za-z0-9_.-]{1,100}$/.test(key) || !(typeof value === 'boolean' || Number.isSafeInteger(value) && (value as number) >= 0) || featureTypes.has(key) && featureTypes.get(key) !== typeof value) invalid('Entitlement keys must have consistent boolean or nonnegative-integer values.');
      featureTypes.set(key, typeof value);
    }
    offers.set(id, Object.freeze({ ...offer, id, quantity: Object.freeze({ min, max }), features: Object.freeze({ ...features }) }));
  }
  return Object.freeze({ ...input, catalog: Object.freeze(Object.fromEntries(offers)), access: input.access ? structuredClone(input.access) : undefined, accessToken, webhookSignatureKeys: Object.freeze([...keys]), allowedOrigins: Object.freeze(origins), offers, basePath, webhookPath, timeoutMs, maxProjectionAgeMs, callbackTimeoutMs });
}
