/** Read-only qualification of the receiver's permanent receipt schema. No opportunistic DDL, ledger rewriting or data deletion. */
import type { ReactiveDB } from '../sync/reactive-db';
import { AuthError } from '../auth/types';
const table = 'CREATE TABLE _notification_effect_receipts (id TEXT PRIMARY KEY,scope_id TEXT NOT NULL,request_hash TEXT NOT NULL,notification_id TEXT,created_at INTEGER NOT NULL)';
const triggers = {
  notification_effect_receipt_no_update: "CREATE TRIGGER notification_effect_receipt_no_update BEFORE UPDATE ON _notification_effect_receipts BEGIN SELECT RAISE(ABORT,'notification effect receipts are immutable'); END",
  notification_effect_receipt_no_delete: "CREATE TRIGGER notification_effect_receipt_no_delete BEFORE DELETE ON _notification_effect_receipts BEGIN SELECT RAISE(ABORT,'notification effect receipts are immutable'); END",
};
const admitted = new WeakMap<object, number>();
/** Recheck after schema changes, including dropped/replaced triggers; activation never silently creates missing receipts. */
export function assertNotificationEffectSchema(db: ReactiveDB): void {
  const version = (db.prepare('PRAGMA schema_version').get() as { schema_version: number }).schema_version, domain = db.getTransactionDomain();
  if (admitted.get(domain) === version) return;
  const normalize = (value: string) => value.replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '').replace(/\s+/g, ' ').trim();
  const inspect = (name: string, type: string, expected: string) => {
    const row = db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(name) as { type: string; sql: string } | null;
    if (!row || row.type !== type || !row.sql || normalize(row.sql) !== normalize(expected)) throw new AuthError('Native notification effects require their reviewed SYSTEM migration and immutable receipt controls.', 'NOTIFICATION_NOT_READY', 503);
  };
  inspect('_notification_effect_receipts', 'table', table);
  for (const [name, sql] of Object.entries(triggers)) inspect(name, 'trigger', sql);
  admitted.set(domain, version);
}
