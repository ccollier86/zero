import type { ReactiveDB } from './reactive-db';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const MIN_UNCERTAINTY_MS = 60 * 60 * 1_000;
const MAX_PER_PRINCIPAL = 2_500;
const MAX_RECEIPTS = 25_000;

/** Bound old receipts without evicting another client's recent uncertainty. */
export function pruneMutationReceipts(
  db: ReactiveDB,
  principal: string,
  pruneGlobal: boolean,
): void {
  const protectedAfter = Date.now() - MIN_UNCERTAINTY_MS;
  db.prepare(`DELETE FROM _sync_mutation_receipts
    WHERE principal = ? AND created_at < ? AND rowid IN (
      SELECT rowid FROM _sync_mutation_receipts WHERE principal = ?
      ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ${MAX_PER_PRINCIPAL}
    )`).run(principal, protectedAfter, principal);
  if (!pruneGlobal) return;
  db.prepare('DELETE FROM _sync_mutation_receipts WHERE created_at < ?')
    .run(Date.now() - RETENTION_MS);
  db.prepare(`DELETE FROM _sync_mutation_receipts
    WHERE created_at < ? AND rowid IN (
      SELECT rowid FROM _sync_mutation_receipts
      ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ${MAX_RECEIPTS}
    )`).run(protectedAfter);
}
