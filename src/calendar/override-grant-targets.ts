/** SYSTEM target eligibility stays in the managed parent, never in the private Calendar actor. */
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import type { CalendarRequestAuthority } from './authority';
import type { CalendarCommandReceipt, CalendarOverrideGrantView } from './contracts';
import type { CalendarParticipantDirectory } from './participants-directory';
import type { CalendarServiceBroker } from './service';
import { CalendarError } from './error';
import { calendarKey } from './validation';

/** Independent current-scope account rule, not appointment-participant configuration or presentation. */
export type CalendarOverrideGrantTargets = Pick<CalendarParticipantDirectory, 'assertBindable'>;

export async function calendarOverrideGrantCommitGuard(input: {
  broker: CalendarServiceBroker; targets?: CalendarOverrideGrantTargets; authority: CalendarRequestAuthority;
  operation: string; body: Record<string, unknown>; key: string; id: string | null; expectedRevision?: number;
}): Promise<() => void> {
  const { broker, targets, authority, operation, body, key, id, expectedRevision } = input;
  if (operation !== 'resource.override-grant') return authority.guard;
  // Reconciliation re-enters the canonical intent/digest/object checks, but must
  // not hide a fact accepted before its target became unavailable.
  const prior = await broker.read<CalendarCommandReceipt | null>(authority.scope, 'calendar.receipt',
    { actor: authority.actor, requestId: key }, authority.guard, authority.signal);
  await authority.confirm(); authority.guard();
  if (prior !== null) return authority.guard;
  const userId = calendarKey(body.userId);
  // Admit independent administration AND ordinary resource management before
  // any target existence probe. A guessed account cannot become an oracle.
  const grant = await broker.read<CalendarOverrideGrantView>(authority.scope, 'calendar.overrideGrant',
    { actor: authority.actor, id, userId }, authority.guard, authority.signal);
  await authority.confirm(); authority.guard();
  if (grant.resourceId !== id || grant.userId !== userId || grant.resourceRevision !== expectedRevision) {
    throw new CalendarError('CALENDAR_REVISION_CONFLICT');
  }
  // Revocation/removal must remain possible even after an account leaves.
  if ((body.categories as readonly unknown[]).length === 0) return authority.guard;
  if (!targets) throw new CalendarError('CALENDAR_NOT_READY');
  const references = Object.freeze([Object.freeze({ kind: 'guardian-user' as const, userId })]);
  const guard = () => {
    authority.guard();
    const result = invokeSynchronousAuthCallback(() => targets.assertBindable(authority.scope, references), {
      component: 'calendar', invariant: 'override-grant-target-is-synchronous',
      message: 'Calendar override grant target admission must not yield.',
    });
    if (result !== undefined) throw new CalendarError('CALENDAR_CONFIG_INVALID');
    authority.guard();
  };
  guard(); return guard;
}
