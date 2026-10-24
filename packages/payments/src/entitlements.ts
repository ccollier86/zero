import type Stripe from 'stripe';
import type { BillingSnapshot } from '@zero/framework/payments';
import type { ResolvedPaymentsOptions } from './options';

/** Private, compact grant evidence: identical feature/value pairs keep their latest valid expiry. */
export interface EntitlementGrant { feature: string; value: boolean | number; expiresAt: number }
export type StoredBillingSnapshot = BillingSnapshot & { _grants?: EntitlementGrant[] };

export function entitlementGrants(subscriptions: Stripe.Subscription[], options: ResolvedPaymentsOptions, now = Date.now() / 1000): EntitlementGrant[] {
  const byPrice = new Map([...options.offers.values()].filter(offer => offer.kind === 'subscription').map(offer => [offer.price, offer]));
  const grants = new Map<string, EntitlementGrant>();
  for (const sub of subscriptions) {
    const invoice = sub.latest_invoice && typeof sub.latest_invoice !== 'string' ? sub.latest_invoice : null;
    const trial = sub.status === 'trialing' && Number.isFinite(sub.trial_end) && sub.trial_end! > now;
    const paid = sub.status === 'active' && invoice && (invoice.status === 'paid' || invoice.status === 'open' && invoice.amount_due === 0);
    if (!trial && !paid) continue;
    for (const item of sub.items.data) {
      const offer = byPrice.get(item.price.id);
      const expiresAt = trial ? Math.min(item.current_period_end, sub.trial_end!) : item.current_period_end;
      if (!offer || !Number.isFinite(expiresAt) || expiresAt <= now || item.quantity !== undefined && item.quantity !== null && item.quantity <= 0) continue;
      for (const [feature, value] of Object.entries(offer.features)) {
        const key = JSON.stringify([feature, value]), previous = grants.get(key);
        if (!previous || previous.expiresAt < expiresAt) grants.set(key, { feature, value, expiresAt });
      }
    }
  }
  return [...grants.values()].sort((a, b) => a.feature.localeCompare(b.feature) || a.expiresAt - b.expiresAt);
}
export function evaluateGrants(grants: readonly EntitlementGrant[], now = Date.now() / 1000): { entitlements: Record<string, boolean | number>; validUntil: number | null } {
  const entitlements: Record<string, boolean | number> = Object.create(null); let validUntil: number | null = null;
  for (const grant of grants) {
    if (!Number.isFinite(grant.expiresAt) || grant.expiresAt <= now) continue;
    if (typeof grant.value === 'boolean') entitlements[grant.feature] = grant.value || entitlements[grant.feature] === true;
    else entitlements[grant.feature] = Math.max(typeof entitlements[grant.feature] === 'number' ? entitlements[grant.feature] as number : 0, grant.value);
    validUntil = validUntil === null ? grant.expiresAt : Math.min(validUntil, grant.expiresAt);
  }
  return { entitlements, validUntil };
}
export function publicSnapshot(snapshot: StoredBillingSnapshot): BillingSnapshot { const { _grants, ...view } = snapshot; return view; }
