/** Shared durable service-stage owner. Carries trusted attribution, never provider input/output content. */
import type { LoggingRuntime } from './logging-runtime';
import { captureLoggingServiceAttribution } from './logging-attribution';
import { captureLoggingEvent } from './logging-validation';
import type { LoggingContext, LoggingEvidence, LoggingFamily, LoggingOutcome, LoggingScalar } from './logging-contracts';

interface StageResult { readonly stage: string; readonly outcome: LoggingOutcome; readonly evidence: LoggingEvidence; readonly metadata?: Readonly<Record<string, LoggingScalar>> }
export interface ManagedServiceAuditSpan {
  admit(): Promise<void>;
  finish(result: StageResult): Promise<void>;
  assertCurrent(): void;
}

/** Capture before an async SDK/transport handoff; background work is explicitly system-attributed if not scoped. */
export function prepareManagedServiceAudit(logging: LoggingRuntime | null, family: LoggingFamily, action: string,
  metadata: Readonly<Record<string, LoggingScalar>>): (() => ManagedServiceAuditSpan) | undefined {
  if (!logging || !logging.config.policy.capture[family]) return undefined;
  const captured = captureLoggingServiceAttribution(logging), safeMetadata = Object.freeze({ ...metadata });
  const context: LoggingContext = captured?.context ?? {
    sourceId: 'system:zero.' + family, origin: 'system', scope: { kind: 'application', tenantId: null },
    actor: { kind: 'system', id: 'zero.' + family, sessionId: null, initiatorId: null },
    requestId: null, correlationId: null, policyVersion: logging.config.policyVersion,
  };
  // This helper is owned only by managed provider adapters. Confirmation comes
  // from that trusted boundary, not the initiating backend/system actor. Keep
  // the caller's identity, scope and correlation intact; public record() and
  // browser observations must still reject forged provider confirmations.
  const providerContext: LoggingContext = { ...context, origin: 'provider' };
  return () => {
    const id = crypto.randomUUID(); let admitted: Promise<void> | null = null, terminal: Promise<void> | null = null;
    const event = (result: StageResult) => {
      const values = { ...safeMetadata, ...result.metadata };
      return captureLoggingEvent(result.evidence === 'provider-confirmed' ? providerContext : context, { id: id + ':' + result.stage, family, action: action + '.' + result.stage,
        occurredAt: Date.now(), outcome: result.outcome, evidence: result.evidence, target: { type: 'service.invocation', id }, metadata: values }, Object.keys(values));
    };
    return Object.freeze({
      assertCurrent() { captured?.assertCurrent(); },
      admit() {
        if (!admitted) admitted = (async () => {
          captured?.assertCurrent(); await logging.deliver(event({ stage: 'admitted', outcome: 'attempted', evidence: 'server-confirmed' })); captured?.assertCurrent();
        })();
        return admitted;
      },
      finish(result: StageResult) {
        const retained = event(result); // Immutable terminal facts captured before yielding.
        if (!terminal) terminal = (async () => { if (!admitted) throw new Error('Service stage was not admitted.'); await admitted; await logging.deliver(retained); })();
        return terminal;
      },
    });
  };
}
