/** Private delivery liveness, deliberately separate from retained user activities. */
import type { ReactiveDB } from '../sync/reactive-db';
import { DatabaseError } from '../databases/database-error';
import { loggingRecord } from './logging-validation';

export const LOGGING_DELIVERY_CONTROL_TABLE = 'logging_delivery_control';
export const LOGGING_ACTOR_PROBE_OPERATION = 'database.logging.delivery-probe';
export const LOGGING_CONTROL_TABLES = Object.freeze({
  [LOGGING_DELIVERY_CONTROL_TABLE]: Object.freeze({
    id: 'text primary key', nonce: 'text not null', checked_at: 'integer not null',
  }),
});

/** A fresh challenge forces a real writer transaction; replay is never fresh proof. */
export function normalizeLoggingDeliveryProbe(value: unknown): Readonly<{ nonce: string }> {
  try {
    const input = loggingRecord(value, ['nonce']);
    if (typeof input.nonce !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.nonce)) throw new Error();
    return Object.freeze({ nonce: input.nonce });
  } catch { throw new DatabaseError('DATABASE_PAYLOAD_INVALID', 'Logging delivery challenge is invalid.', { outcome: 'not-committed' }); }
}

/** Writer-only fixed SQL, under the audit file's FULL-durability transaction; no command receipt or event. */
export function probeLoggingDeliveryDatabase(db: ReactiveDB, value: unknown) {
  const { nonce } = normalizeLoggingDeliveryProbe(value);
  return db.transaction(() => {
    const previous = db.prepare('SELECT nonce FROM logging_delivery_control WHERE id=?').get('writer') as { nonce: string } | null;
    if (previous?.nonce === nonce) throw new DatabaseError('DATABASE_PAYLOAD_INVALID', 'A fresh logging delivery challenge is required.', { outcome: 'not-committed' });
    db.prepare('INSERT INTO logging_delivery_control(id,nonce,checked_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET nonce=excluded.nonce,checked_at=excluded.checked_at').run('writer', nonce, Date.now());
    return { nonce };
  });
}
