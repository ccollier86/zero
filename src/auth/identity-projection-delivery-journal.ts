import type { ReactiveDB } from '../sync/reactive-db';
import { identityProjectionError } from './identity-projection-error';
import {
  assertClaimedIdentityProjectionDelivery,
  assertCompletedIdentityProjectionDelivery,
  assertIdentityProjectionReceiptMatches,
  mapIdentityProjectionDelivery,
  sameIdentityProjectionDelivery,
  safeIdentityProjectionErrorCode,
  type IdentityProjectionOutboxRow,
} from './identity-projection-outbox-records';
import { IDENTITY_PROJECTION_OUTBOX_TABLE } from './identity-projection-schema';
import type {
  IdentityAnchor,
  IdentityProjectionDelivery,
  IdentityProjectionReceipt,
} from './identity-projection-types';

/** Durable ordered deliveries and generation-fenced worker leases. */
export class IdentityProjectionDeliveryJournal {
  constructor(private readonly db: ReactiveDB) {}

  findByDedupeKey(
    targetId: string,
    dedupeKey: string,
  ): IdentityProjectionDelivery | null {
    const row = this.db.prepare(`
      SELECT * FROM ${IDENTITY_PROJECTION_OUTBOX_TABLE}
      WHERE target_id = ? AND dedupe_key = ?
    `).get(targetId, dedupeKey) as IdentityProjectionOutboxRow | null;
    return row ? mapIdentityProjectionDelivery(row) : null;
  }

  insert(input: Readonly<{
    targetId: string;
    sequence: number;
    eventId: string;
    dedupeKey: string;
    anchor: IdentityAnchor;
    now: number;
  }>): IdentityProjectionDelivery {
    this.db.prepare(`
      INSERT INTO ${IDENTITY_PROJECTION_OUTBOX_TABLE} (
        target_id, sequence, event_id, dedupe_key, anchor_kind,
        user_id, membership_id, tenant_id, status, attempts,
        available_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
    `).run(
      input.targetId,
      input.sequence,
      input.eventId,
      input.dedupeKey,
      input.anchor.kind,
      input.anchor.userId,
      input.anchor.kind === 'membership' ? input.anchor.membershipId : null,
      input.anchor.kind === 'membership' ? input.anchor.tenantId : null,
      input.now,
      input.now,
      input.now,
    );
    return this.require(input.targetId, input.sequence);
  }

  listCompletedAfter(
    targetId: string,
    sequence: number,
    limit: number,
  ): IdentityProjectionDelivery[] {
    return (this.db.prepare(`
      SELECT * FROM ${IDENTITY_PROJECTION_OUTBOX_TABLE}
      WHERE target_id = ? AND sequence > ? AND status = 'completed'
      ORDER BY sequence ASC LIMIT ?
    `).all(targetId, sequence, limit) as IdentityProjectionOutboxRow[])
      .map(mapIdentityProjectionDelivery);
  }

  claimNext(
    targetId: string,
    workerId: string,
    now: number,
    leaseExpiresAt: number,
  ): IdentityProjectionDelivery | null {
    let row = this.firstIncomplete(targetId);
    if (!row) return null;
    if (row.status === 'quarantined') {
      throw identityProjectionError('IDENTITY_PROJECTION_QUARANTINED');
    }
    if (row.status === 'processing' && row.lease_expires_at! > now) return null;
    if (row.status === 'processing') {
      const recovered = this.db.prepare(`
        UPDATE ${IDENTITY_PROJECTION_OUTBOX_TABLE}
        SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
            updated_at = ?
        WHERE target_id = ? AND sequence = ? AND status = 'processing'
          AND attempts = ? AND lease_expires_at <= ?
      `).run(now, targetId, row.sequence, row.attempts, now);
      if (recovered.changes !== 1) return null;
      row = this.requireRow(targetId, row.sequence);
    }
    const claimed = this.db.prepare(`
      UPDATE ${IDENTITY_PROJECTION_OUTBOX_TABLE}
      SET status = 'processing', attempts = attempts + 1,
          lease_owner = ?, lease_expires_at = ?, updated_at = ?
      WHERE target_id = ? AND sequence = ? AND status = 'pending'
        AND attempts = ? AND available_at <= ?
    `).run(
      workerId,
      leaseExpiresAt,
      now,
      targetId,
      row.sequence,
      row.attempts,
      now,
    );
    return claimed.changes === 1 ? this.require(targetId, row.sequence) : null;
  }

  acknowledge(
    delivery: IdentityProjectionDelivery,
    receipt: IdentityProjectionReceipt,
    now: number,
  ): void {
    if (delivery.status === 'completed') {
      assertCompletedIdentityProjectionDelivery(delivery);
      assertIdentityProjectionReceiptMatches(delivery, receipt);
      const current = this.require(delivery.targetId, delivery.sequence);
      if (current.status !== 'completed'
        || !sameIdentityProjectionDelivery(current, delivery)) {
        throw identityProjectionError('IDENTITY_PROJECTION_LEASE_LOST');
      }
      return;
    }

    assertClaimedIdentityProjectionDelivery(delivery);
    assertIdentityProjectionReceiptMatches(delivery, receipt);
    const changed = this.db.prepare(`
      UPDATE ${IDENTITY_PROJECTION_OUTBOX_TABLE}
      SET status = 'completed', lease_owner = NULL, lease_expires_at = NULL,
          completed_at = ?, updated_at = ?, last_error_code = NULL
      WHERE target_id = ? AND sequence = ? AND event_id = ?
        AND status = 'processing' AND lease_owner = ? AND attempts = ?
    `).run(
      now,
      now,
      delivery.targetId,
      delivery.sequence,
      delivery.eventId,
      delivery.leaseOwner,
      delivery.attempts,
    );
    if (changed.changes !== 1) {
      throw identityProjectionError('IDENTITY_PROJECTION_LEASE_LOST');
    }
  }

  release(
    delivery: IdentityProjectionDelivery,
    retryAt: number,
    errorCode: string,
    now: number,
  ): void {
    assertClaimedIdentityProjectionDelivery(delivery);
    const changed = this.db.prepare(`
      UPDATE ${IDENTITY_PROJECTION_OUTBOX_TABLE}
      SET status = 'pending', available_at = ?, lease_owner = NULL,
          lease_expires_at = NULL, last_error_code = ?, updated_at = ?
      WHERE target_id = ? AND sequence = ? AND event_id = ?
        AND status = 'processing' AND lease_owner = ? AND attempts = ?
    `).run(
      retryAt,
      safeIdentityProjectionErrorCode(errorCode),
      now,
      delivery.targetId,
      delivery.sequence,
      delivery.eventId,
      delivery.leaseOwner,
      delivery.attempts,
    );
    if (changed.changes !== 1) {
      throw identityProjectionError('IDENTITY_PROJECTION_LEASE_LOST');
    }
  }

  quarantine(
    delivery: IdentityProjectionDelivery,
    errorCode: string,
    now: number,
  ): void {
    const code = safeIdentityProjectionErrorCode(errorCode);
    const changed = delivery.status === 'completed'
      ? this.quarantineCompleted(delivery, code, now)
      : this.quarantineClaim(delivery, code, now);
    if (changed !== 1) {
      throw identityProjectionError('IDENTITY_PROJECTION_LEASE_LOST');
    }
  }

  recoverExpired(now: number): number {
    return this.db.prepare(`
      UPDATE ${IDENTITY_PROJECTION_OUTBOX_TABLE}
      SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
          available_at = ?, updated_at = ?
      WHERE status = 'processing' AND lease_expires_at <= ?
    `).run(now, now, now).changes;
  }

  require(targetId: string, sequence: number): IdentityProjectionDelivery {
    return mapIdentityProjectionDelivery(this.requireRow(targetId, sequence));
  }

  private firstIncomplete(targetId: string): IdentityProjectionOutboxRow | null {
    return this.db.prepare(`
      SELECT * FROM ${IDENTITY_PROJECTION_OUTBOX_TABLE}
      WHERE target_id = ? AND status <> 'completed'
      ORDER BY sequence ASC LIMIT 1
    `).get(targetId) as IdentityProjectionOutboxRow | null;
  }

  private requireRow(
    targetId: string,
    sequence: number,
  ): IdentityProjectionOutboxRow {
    const row = this.db.prepare(`
      SELECT * FROM ${IDENTITY_PROJECTION_OUTBOX_TABLE}
      WHERE target_id = ? AND sequence = ?
    `).get(targetId, sequence) as IdentityProjectionOutboxRow | null;
    if (!row) throw identityProjectionError('IDENTITY_PROJECTION_NOT_READY');
    return row;
  }

  private quarantineClaim(
    delivery: IdentityProjectionDelivery,
    code: string,
    now: number,
  ): number {
    assertClaimedIdentityProjectionDelivery(delivery);
    return this.db.prepare(`
      UPDATE ${IDENTITY_PROJECTION_OUTBOX_TABLE}
      SET status = 'quarantined', lease_owner = NULL,
          lease_expires_at = NULL, completed_at = NULL,
          last_error_code = ?, updated_at = ?
      WHERE target_id = ? AND sequence = ? AND event_id = ?
        AND status = 'processing' AND lease_owner = ? AND attempts = ?
    `).run(
      code,
      now,
      delivery.targetId,
      delivery.sequence,
      delivery.eventId,
      delivery.leaseOwner,
      delivery.attempts,
    ).changes;
  }

  private quarantineCompleted(
    delivery: IdentityProjectionDelivery,
    code: string,
    now: number,
  ): number {
    assertCompletedIdentityProjectionDelivery(delivery);
    return this.db.prepare(`
      UPDATE ${IDENTITY_PROJECTION_OUTBOX_TABLE}
      SET status = 'quarantined', completed_at = NULL,
          last_error_code = ?, updated_at = ?
      WHERE target_id = ? AND sequence = ? AND event_id = ?
        AND status = 'completed' AND attempts = ?
    `).run(
      code,
      now,
      delivery.targetId,
      delivery.sequence,
      delivery.eventId,
      delivery.attempts,
    ).changes;
  }
}
