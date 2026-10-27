/** Closed actor rejection provenance survives Fabric's sanitized failures without carrying message text. */
import { AuthError } from '../auth/types';
import { DatabaseError } from '../databases/database-error';
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
export const MESSAGING_CODES = ['MESSAGING_INPUT_INVALID', 'MESSAGING_FORBIDDEN', 'MESSAGING_NOT_FOUND', 'MESSAGING_REVISION_CONFLICT', 'MESSAGING_CAPACITY',
  'MESSAGING_CONTACT_REQUIRED', 'MESSAGING_BLOCKED', 'MESSAGING_INTENT_CONFLICT', 'MESSAGING_OWNER_CONFLICT', 'MESSAGING_ARCHIVED', 'MESSAGING_ATTACHMENT_UNAVAILABLE',
  'MESSAGING_OWNER_INVALID', 'MESSAGING_STAGE_CONFLICT', 'MESSAGING_MEMBERSHIP_REQUIRED'] as const;
export function messagingCommand(_context: DatabaseWriteCommandContext, run: () => unknown): unknown {
  try { return { ok: true, value: run() }; }
  catch (error) {
    if (error instanceof AuthError) {
      const index = MESSAGING_CODES.indexOf(error.code as typeof MESSAGING_CODES[number]);
      if (index >= 0) throw new DatabaseError('DATABASE_CONFLICT', 'The messaging operation was rejected.', { outcome: 'not-committed', retryable: false, details: { domainCode: index + 1 } });
    }
    throw error;
  }
}
export function readMessagingActorRejection(error: unknown): AuthError | null {
  if (!(error instanceof DatabaseError) || error.code !== 'DATABASE_CONFLICT' || error.outcome !== 'not-committed') return null;
  const index = error.details.domainCode;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 1 || index > MESSAGING_CODES.length) return null;
  const code = MESSAGING_CODES[index - 1]!;
  return new AuthError('The messaging operation was not accepted.', code, code === 'MESSAGING_NOT_FOUND' ? 404 : code === 'MESSAGING_CAPACITY' ? 429 : code === 'MESSAGING_INPUT_INVALID' || code === 'MESSAGING_ATTACHMENT_UNAVAILABLE' ? 422 : code === 'MESSAGING_FORBIDDEN' || code === 'MESSAGING_MEMBERSHIP_REQUIRED' ? 403 : 409);
}
