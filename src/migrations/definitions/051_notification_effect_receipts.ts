/** Permanent SYSTEM receiver receipts are independent of notification deletion and never store message contents. */
import type { Migration } from '../types';
export const migration: Migration = { version: '051', description: 'Permanent duplicate-safe native notification effects', safety: 'safe', up(db) {
  const sql = 'CREATE TABLE _notification_effect_receipts (id TEXT PRIMARY KEY,scope_id TEXT NOT NULL,request_hash TEXT NOT NULL,notification_id TEXT,created_at INTEGER NOT NULL)';
  const prior = db.query('SELECT type,sql FROM sqlite_master WHERE name=?').get('_notification_effect_receipts') as { type: string; sql: string } | null;
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  if (prior && (prior.type !== 'table' || normalize(prior.sql) !== normalize(sql))) throw new Error('Notification effect receipt schema collision');
  if (!prior) db.exec(sql);
  db.exec("CREATE TRIGGER IF NOT EXISTS notification_effect_receipt_no_update BEFORE UPDATE ON _notification_effect_receipts BEGIN SELECT RAISE(ABORT,'notification effect receipts are immutable'); END");
  db.exec("CREATE TRIGGER IF NOT EXISTS notification_effect_receipt_no_delete BEFORE DELETE ON _notification_effect_receipts BEGIN SELECT RAISE(ABORT,'notification effect receipts are immutable'); END");
} };
