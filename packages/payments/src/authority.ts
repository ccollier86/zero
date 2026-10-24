import type { BillingSubject, PaymentsAuthority } from '@zero/framework/payments';
import type { ResolvedPaymentsOptions } from './options';
import { PaymentsError } from './errors';

export type BillingAction = 'read' | 'manage' | 'refund' | 'reconcile';
export type PaymentsPolicy = Pick<ResolvedPaymentsOptions, 'subject' | 'access'>;
/** Resolve from Guardian's live request boundary, never an input customer/organization ID. */
export function billingSubject(authority: PaymentsAuthority, options: PaymentsPolicy, action: BillingAction): BillingSubject {
  authority.assertCurrentAuthoritySync();
  const user = authority.access.requireUser();
  const tenantId = authority.scope.scopeKind === 'tenant' ? authority.access.requireTenant().tenantId : undefined;
  const organization = options.subject === 'organization' || options.subject !== 'user' && !!tenantId;
  if (organization && !tenantId) throw new PaymentsError('Organization billing requires a validated tenant session.', 'PAYMENTS_SCOPE_REQUIRED', 403);
  if (tenantId && tenantId !== authority.scope.tenantId) throw new PaymentsError('Billing scope is no longer current.', 'PAYMENTS_SCOPE_REQUIRED', 403);
  const configured = options.access?.[action];
  if (configured !== undefined) authority.access.authorize(configured);
  else if (action === 'refund') authority.access.requirePlatformAdmin();
  else if (organization && !authority.access.requireTenant().roles.some(role => role === 'owner' || role === 'admin')) throw new PaymentsError('Forbidden billing action for this organization role.', 'PAYMENTS_FORBIDDEN', 403);
  // The data scope and authorization scope must agree even for customized permission policies.
  return organization ? { kind: 'organization', id: tenantId! } : { kind: 'user', id: user.userId, ...(tenantId ? { tenantId } : {}) };
}
export async function guard(authority: PaymentsAuthority, options: PaymentsPolicy, action: BillingAction): Promise<BillingSubject> {
  if (authority.signal?.aborted) throw new PaymentsError('Payment request was cancelled.', 'PAYMENTS_REQUEST_CANCELLED', 499);
  await authority.assertCurrentAuthority();
  return billingSubject(authority, options, action);
}
