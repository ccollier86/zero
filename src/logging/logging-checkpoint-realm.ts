/** Append-only checkpoints. These capabilities are bound only to a private logging Fabric database. */
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import { DatabaseError } from '../databases/database-error';
import { loggingCanonical, loggingChoice, loggingId, loggingRecord } from './logging-validation';
import { checkpointDigest, normalizeSignedLoggingCheckpoint } from './logging-checkpoint-signer';
import { loggingDigest } from './logging-hash';
import { LOGGING_CHECKPOINTS_TABLE, LOGGING_STATE_TABLE } from './logging-schema';
import type { SignedLoggingCheckpoint } from './logging-custody-contracts';

function invalid(): never { throw new DatabaseError('DATABASE_PAYLOAD_INVALID', 'Logging checkpoint operation is invalid.', { outcome: 'not-committed' }); }
function readStored(row: Record<string, unknown>): SignedLoggingCheckpoint {
  const cp = normalizeSignedLoggingCheckpoint(JSON.parse(String(row.envelope)));
  if (row.id !== checkpointDigest(cp) || row.digest !== row.id || row.ledger_id !== cp.ledgerId || row.stream !== cp.stream
    || row.ordinal !== cp.ordinal || row.hash !== cp.hash || !Number.isSafeInteger(row.position) || Number(row.position) < 1) invalid();
  return cp;
}

export function readLocalLoggingCheckpoint({ database }: DatabaseReadQueryContext, value: unknown): SignedLoggingCheckpoint | null {
  const r = loggingRecord(value, ['ledgerId', 'stream']), ledger = loggingId(r.ledgerId)!, stream = loggingChoice(r.stream, ['audit', 'operational'] as const);
  const row = database.query<Record<string, unknown>>('SELECT * FROM logging_checkpoints WHERE ledger_id=? AND stream=? ORDER BY position DESC LIMIT 1').get(ledger, stream);
  if (!row) return null;
  return readStored(row);
}

export function appendLocalLoggingCheckpoint({ db }: DatabaseWriteCommandContext, value: unknown): SignedLoggingCheckpoint {
  const r = loggingRecord(value, ['checkpoint', 'expectedDigest']), cp = normalizeSignedLoggingCheckpoint(r.checkpoint);
  const expected = r.expectedDigest;
  if (expected !== null && (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) || cp.previousDigest !== expected) invalid();
  const digest = checkpointDigest(cp), duplicate = db.get(LOGGING_CHECKPOINTS_TABLE, digest);
  if (duplicate) {
    if (loggingCanonical(readStored(duplicate)) !== loggingCanonical(cp)) invalid();
    return cp;
  }
  const previous = expected === null ? null : db.get(LOGGING_CHECKPOINTS_TABLE, expected as string);
  const headId = 'checkpoint:' + loggingDigest([cp.ledgerId, cp.stream]), head = db.get(LOGGING_STATE_TABLE, headId);
  if (expected === null && head || expected !== null && (!previous || !head || head.ordinal !== previous.position
    || previous.ledger_id !== cp.ledgerId || previous.stream !== cp.stream)) invalid();
  if (previous) {
    const prior = readStored(previous);
    if (cp.ordinal < prior.ordinal || cp.ordinal === prior.ordinal && cp.hash !== prior.hash || cp.issuedAt < prior.issuedAt) invalid();
  }
  const position = Number(head?.ordinal ?? 0) + 1; if (!Number.isSafeInteger(position)) invalid();
  db.createStrict(LOGGING_CHECKPOINTS_TABLE, { id: digest, ledger_id: cp.ledgerId, stream: cp.stream, position,
    ordinal: cp.ordinal, hash: cp.hash, digest, envelope: loggingCanonical(cp) });
  if (head) db.update(LOGGING_STATE_TABLE, headId, { ordinal: position });
  else db.createStrict(LOGGING_STATE_TABLE, { id: headId, stream: cp.stream, ordinal: position });
  return cp;
}
