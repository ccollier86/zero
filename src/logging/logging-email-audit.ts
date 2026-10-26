/** Lazy managed EmailService instrumentation, including auth sends created before logging composition. */
import type { EmailSendAudit } from '../email/email-send-audit';
import type { LoggingRuntime } from './logging-runtime';
import { loggingDigest } from './logging-hash';
import { prepareManagedServiceAudit } from './logging-service-audit';

export function createManagedEmailSendAudit(getLogging: () => LoggingRuntime | null): EmailSendAudit {
  return Object.freeze({ prepare(providerId: string) {
    const prepare = prepareManagedServiceAudit(getLogging(), 'communications', 'email.provider', { providerRef: loggingDigest(providerId) });
    if (!prepare) return undefined;
    const span = prepare();
    return Object.freeze({ admit: span.admit,
      finish(outcome: 'accepted' | 'rejected' | 'unknown', counts?: { acceptedCount: number; rejectedCount: number }) {
        const metadata: Record<string, number> = {};
        if (counts && Number.isSafeInteger(counts.acceptedCount) && counts.acceptedCount >= 0 && Number.isSafeInteger(counts.rejectedCount) && counts.rejectedCount >= 0) {
          metadata.acceptedCount = counts.acceptedCount; metadata.rejectedCount = counts.rejectedCount;
        }
        return span.finish({ stage: outcome, outcome: outcome === 'accepted' ? 'succeeded' : outcome === 'rejected' ? 'failed' : 'unknown',
          evidence: outcome === 'accepted' ? 'provider-confirmed' : outcome === 'rejected' ? 'server-confirmed' : 'incomplete', metadata });
      },
    });
  } });
}
