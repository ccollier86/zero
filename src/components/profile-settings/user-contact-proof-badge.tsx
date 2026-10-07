'use client';

/** A presentation of admitted server provenance, never a phone formatter or legacy login-gate inference. */
import { Badge } from '../ui/badge';
import type { UserContactProofState } from '../../auth/auth-user-contact-types';
const LABELS: Record<UserContactProofState, string> = {
  absent: 'Not added', unverified: 'Not verified', pending: 'Verification pending',
  'delivery-unavailable': 'Delivery unavailable', 'possession-verified': 'Ownership verified',
  'administratively-attested': 'Admin attested',
};
export function UserContactProofBadge({ state, unsaved = false, expired = false }: { state: UserContactProofState; unsaved?: boolean; expired?: boolean }) {
  return <Badge variant={state === 'delivery-unavailable' && !unsaved ? 'warning' : 'outline'}
    className={!unsaved && state === 'possession-verified' ? 'border-success/30 bg-success/5 text-success' : undefined}
    title={!unsaved && state === 'administratively-attested' ? 'An administrator attested this address; this is not proof of mailbox ownership.' : undefined}>
    {unsaved ? 'Unsaved number' : expired && (state === 'pending' || state === 'delivery-unavailable') ? 'Verification expired' : LABELS[state]}
  </Badge>;
}
