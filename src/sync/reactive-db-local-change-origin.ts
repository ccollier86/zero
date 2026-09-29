/**
 * reactive-db-local-change-origin.ts
 *
 * Owns process-local Sync transport attribution for ReactiveDB transactions.
 * This metadata is never persisted in `_changes` or exposed through change
 * payloads; ReactiveDB only calls the lifecycle helpers at commit/delivery
 * boundaries.
 */

import type { ReactiveDB } from './reactive-db';

const requestedOrigins = new WeakMap<ReactiveDB, string>();
const committedOrigins = new WeakMap<ReactiveDB, Map<number, string>>();

/** Bind an exact socket origin to the next outer transaction on one database. */
export function withReactiveDBLocalChangeOrigin<T>(
  db: ReactiveDB,
  origin: string,
  operation: () => T,
): T {
  const previous = requestedOrigins.get(db);
  requestedOrigins.set(db, origin);
  try {
    return operation();
  } finally {
    if (previous === undefined) requestedOrigins.delete(db);
    else requestedOrigins.set(db, previous);
  }
}

/** Read process-local attribution while its matching committed row is delivered. */
export function getReactiveDBLocalChangeOrigin(
  db: ReactiveDB,
  sequence: number,
): string | null {
  return committedOrigins.get(db)?.get(sequence) ?? null;
}

/** Consume the one-shot origin requested for the database's next transaction. */
export function takeReactiveDBLocalChangeOrigin(db: ReactiveDB): string | null {
  const origin = requestedOrigins.get(db) ?? null;
  requestedOrigins.delete(db);
  return origin;
}

/** Retain an origin only for the local delivery lifetime of one committed row. */
export function bindReactiveDBLocalChangeOrigin(
  db: ReactiveDB,
  sequence: number,
  origin: string,
): void {
  let origins = committedOrigins.get(db);
  if (!origins) {
    origins = new Map();
    committedOrigins.set(db, origins);
  }
  origins.set(sequence, origin);
}

/** Release attribution after delivery or a rolled-back transaction. */
export function clearReactiveDBLocalChangeOrigin(
  db: ReactiveDB,
  sequence: number,
): void {
  const origins = committedOrigins.get(db);
  if (!origins) return;
  origins.delete(sequence);
  if (origins.size === 0) committedOrigins.delete(db);
}

/** Release retained origins through an externally observed durable sequence. */
export function clearReactiveDBLocalChangeOriginsThrough(
  db: ReactiveDB,
  sequence: number,
): void {
  const origins = committedOrigins.get(db);
  if (!origins) return;
  for (const committedSequence of origins.keys()) {
    if (committedSequence <= sequence) origins.delete(committedSequence);
  }
  if (origins.size === 0) committedOrigins.delete(db);
}

/** Release all requested and committed attribution owned by one database. */
export function clearAllReactiveDBLocalChangeOrigins(db: ReactiveDB): void {
  requestedOrigins.delete(db);
  committedOrigins.delete(db);
}
