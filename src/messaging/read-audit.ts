/** Content-free semantic read stages. This server-only owner records preparation, not HTTP delivery, visibility or human attention. */
import { AuthError } from '../auth/types';
import type { LoggingRuntime } from '../logging/logging-runtime';
import type { LoggingContext, LoggingOutcome } from '../logging/logging-contracts';
import { captureLoggingEvent } from '../logging/logging-validation';

export type MessagingReadAction = 'directory' | 'assistants' | 'conversations' | 'conversation' | 'history' | 'contacts' | 'support.queue' | 'review.list' | 'review.detail';

/** Audit delivery occurs outside SQLite/authority leases; a successful prepared result is fenced again before release. */
export async function auditMessagingRead<T>(logging: LoggingRuntime | undefined, context: LoggingContext, action: MessagingReadAction,
  conversationId: string | null, check: () => void, operation: () => Promise<T>): Promise<T> {
  if (!logging || !logging.config.policy.capture.communications) { check(); const result = await operation(); check(); return result; }
  const id = 'messaging-read:' + crypto.randomUUID();
  const event = (stage: string, outcome: LoggingOutcome) => captureLoggingEvent(context, {
    id: id + ':' + stage, family: 'communications', action: 'messaging.' + action + '.' + stage,
    evidence: 'server-confirmed', outcome, occurredAt: Date.now(),
    target: conversationId === null ? null : { type: 'messaging.conversation', id: conversationId },
  });
  const failed = async (failure: unknown): Promise<never> => {
    const unknown = failure !== null && typeof failure === 'object' && Object.getOwnPropertyDescriptor(failure, 'outcome')?.value === 'unknown';
    const outcome = unknown ? 'unknown' : failure instanceof AuthError && [401, 403, 404, 409, 428].includes(failure.status) ? 'denied' : 'failed';
    // Never retain an exception message, search query, draft, transcript or provider response.
    await logging.deliver(event(outcome, outcome)); throw failure;
  };
  check(); await logging.deliver(event('admitted', 'attempted'));
  try { check(); await operation(); check(); } catch (failure) { return failed(failure); }
  await logging.deliver(event('prepared', 'succeeded'));
  // Delivery yields to other commits. Re-read the bounded projection under
  // canonical membership/history after that yield; never release the retained
  // pre-delivery body based only on the actor's still-valid global session.
  try { check(); const current = await operation(); check(); return current; } catch (failure) { return failed(failure); }
}
