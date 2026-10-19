/** Conservative mutation detection for private actor SQL and its triggers. */
import type { DatabaseActorWriterBinding } from './database-actor-binding';

/** Tracked Sync sequence does not include private projection/outbox writes. */
export function databaseActorTotalChanges(binding: DatabaseActorWriterBinding): number | null {
  // File/WAL already owns incremental durability; no extra no-op probes there.
  if (binding.placement.mode !== 'hot') return null;
  const statement = binding.runtime.db.prepare('SELECT total_changes() AS total');
  try {
    const value = (statement.get() as { total: unknown }).total;
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  } finally {
    statement.finalize();
  }
}
