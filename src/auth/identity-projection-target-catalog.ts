import type { ReactiveDB } from '../sync/reactive-db';
import { identityProjectionError } from './identity-projection-error';
import {
  IDENTITY_PROJECTION_INSTALLATION_TABLE,
  IDENTITY_PROJECTION_TARGETS_TABLE,
} from './identity-projection-schema';
import {
  mapIdentityProjectionTargetState,
  pendingIdentityProjectionDeliveryCount,
  safeIdentityProjectionErrorCode,
  type IdentityProjectionTargetRow,
} from './identity-projection-outbox-records';
import type {
  IdentityProjectionTargetScope,
  IdentityProjectionTargetState,
} from './identity-projection-types';
import { requireIdentityProjectionId } from './identity-projection-validation';

/** System-plane installation identity and registered projection target catalog. */
export class IdentityProjectionTargetCatalog {
  constructor(private readonly db: ReactiveDB) {}

  loadOrCreateInstallationId(
    createInstallationId: () => string,
    now: number,
  ): string {
    const existing = this.db.prepare(`
      SELECT installation_id FROM ${IDENTITY_PROJECTION_INSTALLATION_TABLE}
      WHERE singleton = 1
    `).get() as { installation_id: string } | null;
    if (existing) {
      return requireIdentityProjectionId(existing.installation_id, 'installationId');
    }
    const installationId = requireIdentityProjectionId(
      createInstallationId(),
      'installationId',
    );
    this.db.prepare(`
      INSERT INTO ${IDENTITY_PROJECTION_INSTALLATION_TABLE} (
        singleton, installation_id, created_at
      ) VALUES (1, ?, ?)
    `).run(installationId, now);
    return installationId;
  }

  register(
    targetId: string,
    scope: IdentityProjectionTargetScope,
    now: number,
  ): IdentityProjectionTargetState {
    const existing = this.row(targetId);
    if (existing && existing.scope !== scope) {
      throw identityProjectionError('IDENTITY_PROJECTION_TARGET_MISMATCH');
    }
    if (!existing) {
      this.db.prepare(`
        INSERT INTO ${IDENTITY_PROJECTION_TARGETS_TABLE} (
          target_id, scope, status, next_sequence,
          acknowledged_sequence, created_at, updated_at
        ) VALUES (?, ?, 'provisioning', 1, 0, ?, ?)
      `).run(targetId, scope, now, now);
    }
    return this.requireState(targetId);
  }

  getState(targetId: string): IdentityProjectionTargetState | null {
    const row = this.row(targetId);
    return row ? mapIdentityProjectionTargetState(row) : null;
  }

  listStates(): readonly IdentityProjectionTargetState[] {
    return (this.db.prepare(`
      SELECT target_id, scope, status, next_sequence, acknowledged_sequence,
             last_error_code, updated_at
      FROM ${IDENTITY_PROJECTION_TARGETS_TABLE}
      ORDER BY target_id
    `).all() as IdentityProjectionTargetRow[])
      .map(mapIdentityProjectionTargetState);
  }

  requireUsable(targetId: string): IdentityProjectionTargetRow {
    const row = this.row(targetId);
    if (!row) throw identityProjectionError('IDENTITY_PROJECTION_NOT_READY');
    if (row.status === 'quarantined') {
      throw identityProjectionError('IDENTITY_PROJECTION_QUARANTINED');
    }
    // Mapping validates persisted counters and enum values before callers use
    // them to allocate journal sequence numbers.
    mapIdentityProjectionTargetState(row);
    return row;
  }

  requireState(targetId: string): IdentityProjectionTargetState {
    const row = this.row(targetId);
    if (!row) throw identityProjectionError('IDENTITY_PROJECTION_NOT_READY');
    return mapIdentityProjectionTargetState(row);
  }

  reserveSequence(targetId: string, now: number): number {
    const target = this.requireUsable(targetId);
    const sequence = target.next_sequence;
    if (sequence === Number.MAX_SAFE_INTEGER) {
      throw identityProjectionError('IDENTITY_PROJECTION_SCHEMA_INVALID');
    }
    const changed = this.db.prepare(`
      UPDATE ${IDENTITY_PROJECTION_TARGETS_TABLE}
      SET next_sequence = next_sequence + 1, status = 'provisioning',
          last_error_code = NULL, updated_at = ?
      WHERE target_id = ? AND next_sequence = ?
    `).run(now, targetId, sequence);
    if (changed.changes !== 1) {
      throw identityProjectionError('IDENTITY_PROJECTION_CONFLICT');
    }
    return sequence;
  }

  acknowledge(targetId: string, sequence: number, now: number): void {
    const changed = this.db.prepare(`
      UPDATE ${IDENTITY_PROJECTION_TARGETS_TABLE}
      SET acknowledged_sequence = CASE
            WHEN acknowledged_sequence < ? THEN ? ELSE acknowledged_sequence END,
          updated_at = ?, last_error_code = NULL
      WHERE target_id = ? AND next_sequence > ?
    `).run(sequence, sequence, now, targetId, sequence);
    if (changed.changes !== 1) {
      throw identityProjectionError('IDENTITY_PROJECTION_SCHEMA_INVALID');
    }
  }

  markProvisioning(targetId: string, errorCode: string, now: number): void {
    this.db.prepare(`
      UPDATE ${IDENTITY_PROJECTION_TARGETS_TABLE}
      SET status = 'provisioning', last_error_code = ?, updated_at = ?
      WHERE target_id = ? AND status <> 'quarantined'
    `).run(safeIdentityProjectionErrorCode(errorCode), now, targetId);
  }

  quarantine(targetId: string, errorCode: string, now: number): void {
    const changed = this.db.prepare(`
      UPDATE ${IDENTITY_PROJECTION_TARGETS_TABLE}
      SET status = 'quarantined', last_error_code = ?, updated_at = ?
      WHERE target_id = ?
    `).run(safeIdentityProjectionErrorCode(errorCode), now, targetId);
    if (changed.changes !== 1) {
      throw identityProjectionError('IDENTITY_PROJECTION_NOT_READY');
    }
  }

  markReady(targetId: string, now: number): IdentityProjectionTargetState {
    const target = this.requireUsable(targetId);
    if (pendingIdentityProjectionDeliveryCount(target) !== 0) {
      throw identityProjectionError('IDENTITY_PROJECTION_NOT_READY');
    }
    this.db.prepare(`
      UPDATE ${IDENTITY_PROJECTION_TARGETS_TABLE}
      SET status = 'ready', updated_at = ?, last_error_code = NULL
      WHERE target_id = ?
    `).run(now, targetId);
    return this.requireState(targetId);
  }

  private row(targetId: string): IdentityProjectionTargetRow | null {
    return this.db.prepare(`
      SELECT target_id, scope, status, next_sequence, acknowledged_sequence,
             last_error_code, updated_at
      FROM ${IDENTITY_PROJECTION_TARGETS_TABLE} WHERE target_id = ?
    `).get(targetId) as IdentityProjectionTargetRow | null;
  }
}
