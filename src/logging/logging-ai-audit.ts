/** Managed AI provider stages. The only persisted provider/model selectors are opaque digests. */
import type { AIExecutionAudit, AIExecutionAuditSpan } from '../ai/ai-execution-audit';
import type { LoggingRuntime } from './logging-runtime';
import { loggingDigest } from './logging-hash';
import { prepareManagedServiceAudit } from './logging-service-audit';

export function createManagedAIExecutionAudit(getLogging: () => LoggingRuntime | null): AIExecutionAudit {
  return Object.freeze({ prepare(descriptor: Parameters<AIExecutionAudit['prepare']>[0]) {
    const metadata = Object.freeze({ capability: descriptor.capability, providerRef: loggingDigest(descriptor.providerId), modelRef: loggingDigest(descriptor.model) });
    const prepare = prepareManagedServiceAudit(getLogging(), 'ai', 'ai.provider', metadata);
    if (!prepare) return undefined;
    return (): AIExecutionAuditSpan => {
      const span = prepare();
      return Object.freeze({
        assertCurrent: span.assertCurrent, admit: span.admit,
        finish(outcome: 'completed' | 'unknown') {
          return span.finish({ stage: outcome, outcome: outcome === 'completed' ? 'succeeded' : 'unknown',
            evidence: outcome === 'completed' ? 'provider-confirmed' : 'incomplete' });
        },
      });
    };
  } });
}
