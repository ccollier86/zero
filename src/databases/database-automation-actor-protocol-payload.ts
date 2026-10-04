/** Request validation for the private database-automation actor operation family. */

import type {
  DatabaseActorAutomationOutboxPayload,
} from './database-automation-actor-protocol-contracts';
import {
  assertDatabaseAutomationActorFields,
  databaseAutomationActorPayloadInvalid,
  databaseAutomationActorRecord,
  parseDatabaseAutomationActorErrorCode,
  parseDatabaseAutomationActorLease,
  parseDatabaseAutomationActorLeaseMs,
  parseDatabaseAutomationActorOpaqueId,
  parseDatabaseAutomationActorRef,
  parseDatabaseAutomationActorTimestamp,
} from './database-automation-actor-protocol-validation';

const CLAIM_FIELDS = new Set([
  'databaseRef',
  'action',
  'leaseOwner',
  'now',
  'leaseMs',
]);
const RENEW_FIELDS = new Set([
  'databaseRef',
  'action',
  'lease',
  'now',
  'leaseMs',
]);
const COMPLETE_FIELDS = new Set([
  'databaseRef',
  'action',
  'lease',
  'now',
]);
const RETRY_FIELDS = new Set([
  'databaseRef',
  'action',
  'lease',
  'errorCode',
  'retryAt',
  'now',
]);
const DEAD_FIELDS = new Set([
  'databaseRef',
  'action',
  'lease',
  'errorCode',
  'now',
]);
const RECOVER_FIELDS = new Set(['databaseRef', 'action', 'now']);
const COUNTS_FIELDS = new Set(['databaseRef', 'action']);

/** Validate, detach, and freeze one private automation-outbox actor request. */
export function validateDatabaseActorAutomationOutboxPayload(
  value: unknown,
): DatabaseActorAutomationOutboxPayload {
  try {
    const record = databaseAutomationActorRecord(value);
    const databaseRef = parseDatabaseAutomationActorRef(record.databaseRef);
    switch (record.action) {
      case 'claim': {
        assertDatabaseAutomationActorFields(record, CLAIM_FIELDS);
        const now = parseDatabaseAutomationActorTimestamp(record.now);
        return Object.freeze({
          databaseRef,
          action: 'claim' as const,
          leaseOwner: parseDatabaseAutomationActorOpaqueId(record.leaseOwner),
          now,
          leaseMs: parseDatabaseAutomationActorLeaseMs(record.leaseMs, now),
        });
      }
      case 'renew': {
        assertDatabaseAutomationActorFields(record, RENEW_FIELDS);
        const lease = parseDatabaseAutomationActorLease(record.lease);
        const now = parseDatabaseAutomationActorTimestamp(record.now);
        return Object.freeze({
          databaseRef,
          action: 'renew' as const,
          lease,
          now,
          leaseMs: parseDatabaseAutomationActorLeaseMs(
            record.leaseMs,
            Math.max(now, lease.updatedAt),
          ),
        });
      }
      case 'complete': {
        assertDatabaseAutomationActorFields(record, COMPLETE_FIELDS);
        return Object.freeze({
          databaseRef,
          action: 'complete' as const,
          lease: parseDatabaseAutomationActorLease(record.lease),
          now: parseDatabaseAutomationActorTimestamp(record.now),
        });
      }
      case 'retry': {
        assertDatabaseAutomationActorFields(record, RETRY_FIELDS);
        const now = parseDatabaseAutomationActorTimestamp(record.now);
        const retryAt = parseDatabaseAutomationActorTimestamp(record.retryAt);
        if (retryAt < now) throw new TypeError('invalid retry chronology');
        return Object.freeze({
          databaseRef,
          action: 'retry' as const,
          lease: parseDatabaseAutomationActorLease(record.lease),
          errorCode: parseDatabaseAutomationActorErrorCode(record.errorCode),
          retryAt,
          now,
        });
      }
      case 'dead': {
        assertDatabaseAutomationActorFields(record, DEAD_FIELDS);
        return Object.freeze({
          databaseRef,
          action: 'dead' as const,
          lease: parseDatabaseAutomationActorLease(record.lease),
          errorCode: parseDatabaseAutomationActorErrorCode(record.errorCode),
          now: parseDatabaseAutomationActorTimestamp(record.now),
        });
      }
      case 'recover-expired': {
        assertDatabaseAutomationActorFields(record, RECOVER_FIELDS);
        return Object.freeze({
          databaseRef,
          action: 'recover-expired' as const,
          now: parseDatabaseAutomationActorTimestamp(record.now),
        });
      }
      case 'counts':
        assertDatabaseAutomationActorFields(record, COUNTS_FIELDS);
        return Object.freeze({ databaseRef, action: 'counts' as const });
      default:
        throw new TypeError('unknown automation action');
    }
  } catch {
    throw databaseAutomationActorPayloadInvalid();
  }
}
