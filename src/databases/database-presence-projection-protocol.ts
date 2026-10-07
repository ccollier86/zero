/** Framework-private bounded presence IPC contract; never part of public database mutation operations. */
import { capturePresencePublication, type PresencePublication, type PresenceProjectionReceipt } from '../presence/presence-publication';
import { normalizeDatabaseRef, type DatabaseRef } from './database-file';
import { DatabaseError } from './database-error';

export interface DatabasePresenceProjectionPayload {
  readonly databaseRef: DatabaseRef;
  readonly publication: PresencePublication;
  readonly authorityRevision?: number;
}
/** Detach the full private packet before actor admission. */
export function validateDatabasePresenceProjectionPayload(input: unknown): DatabasePresenceProjectionPayload {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some(key => !['databaseRef', 'publication', 'authorityRevision'].includes(key))
    || record.authorityRevision !== undefined && (!Number.isSafeInteger(record.authorityRevision) || (record.authorityRevision as number) < 0)) throw invalid();
  try { return Object.freeze({ databaseRef: normalizeDatabaseRef(record.databaseRef as string),
    publication: capturePresencePublication(record.publication),
    ...(record.authorityRevision === undefined ? {} : { authorityRevision: record.authorityRevision as number }) }); }
  catch { throw invalid(); }
}
/** A well-formed actor receipt must acknowledge the exact submitted owner/order. */
export function validateDatabasePresenceProjectionReceipt(input: unknown, publication: PresencePublication): PresenceProjectionReceipt {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw protocol();
  const record = input as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'applied,duplicate,ownerEpoch,revision'
    || record.ownerEpoch !== publication.ownerEpoch || record.revision !== publication.revision
    || typeof record.applied !== 'boolean' || typeof record.duplicate !== 'boolean'
    || record.applied && record.duplicate) throw protocol();
  return Object.freeze({ ownerEpoch: publication.ownerEpoch, revision: publication.revision, applied: record.applied, duplicate: record.duplicate });
}
function invalid() { return new DatabaseError('DATABASE_PAYLOAD_INVALID', 'Presence projection payload is invalid.'); }
function protocol() { return new DatabaseError('DATABASE_PROTOCOL_ERROR', 'Presence projection receipt is invalid.', { outcome: 'unknown' }); }
