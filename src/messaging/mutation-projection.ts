/** A cached commit acknowledgment is not continuing permission to read its retained result body. */
import { DatabaseError } from '../databases/database-error';
/** Re-read private projections under current canonical membership/history, including exact Fabric transport replay. */
export async function projectMessagingCommit<T, Accepted>(accepted: Promise<Accepted>, query: (accepted: Accepted) => Promise<T>): Promise<T> {
  const result = await accepted;
  try { return await query(result); }
  catch { throw new DatabaseError('DATABASE_OUTCOME_UNKNOWN', 'The messaging operation was accepted but its current projection is unavailable; reconcile the original request identity.', { outcome: 'unknown', retryable: false }); }
}
