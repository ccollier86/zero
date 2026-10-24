/** Synthetic evidence only; no environment, real identity, application or provider data. */
import { captureLoggingEvent } from '../logging-validation';
import type { LoggingContext, LoggingEventInput } from '../logging-contracts';

export function loggingContext(tenantId: string | null = 'tenant-a'): LoggingContext {
  return { sourceId: 'fixture-source', origin: 'backend', scope: tenantId === null ? { kind: 'application', tenantId: null } : { kind: 'tenant', tenantId },
    actor: { kind: 'user', id: 'fixture-user', sessionId: 'fixture-session', initiatorId: null },
    requestId: 'fixture-request', correlationId: null, policyVersion: 'fixture-policy-1' };
}
export function loggingEvent(id = 'event-1', tenantId: string | null = 'tenant-a', override: Partial<LoggingEventInput> = {}) {
  return captureLoggingEvent(loggingContext(tenantId), {
    id, family: 'records', action: 'record.read', outcome: 'succeeded', evidence: 'server-confirmed', occurredAt: 1700000000000,
    target: { type: 'record', id: 'record-1' }, ...override,
  });
}
