import type { ReactiveDB } from '../sync/reactive-db';
import { identityProjectionError } from './identity-projection-error';
import {
  defineIdentityAnchorTables,
  IDENTITY_PROJECTION_RECEIPTS_TABLE,
  IDENTITY_PROJECTION_STATE_TABLE,
} from './identity-projection-schema';
import type {
  IdentityAnchorState,
  IdentityProjectionDelivery,
  IdentityProjectionReceipt,
  IdentityProjectionTarget,
} from './identity-projection-types';
import {
  identityAnchorFingerprint,
  requireIdentityProjectionId,
  validateIdentityAnchor,
} from './identity-projection-validation';

interface StateRow {
  installation_id: string;
  target_id: string;
  status: string;
  watermark: number;
  quarantine_code: string | null;
  updated_at: number;
}

interface ReceiptRow {
  event_id: string;
  target_id: string;
  sequence: number;
  anchor_fingerprint: string;
  applied_at: number;
}

type ApplyTransactionResult =
  | { kind: 'applied'; receipt: IdentityProjectionReceipt }
  | { kind: 'conflict' };

export interface IdentityAnchorStoreOptions {
  now?: () => number;
  /** @internal Actor bindings preinstall/validate anchors before publication. */
  schemaInitialized?: boolean;
}

/**
 * Target-local ID anchor owner. The store deliberately has no Guardian read
 * APIs: an anchor proves only referential existence and never live authority.
 */
export class IdentityAnchorStore implements IdentityProjectionTarget {
  private readonly installationId: string;
  private readonly targetId: string;
  private readonly now: () => number;

  constructor(
    private readonly db: ReactiveDB,
    input: { installationId: string; targetId: string },
    options: IdentityAnchorStoreOptions = {},
  ) {
    this.installationId = requireIdentityProjectionId(
      input.installationId,
      'installationId',
    );
    this.targetId = requireIdentityProjectionId(input.targetId, 'targetId');
    this.now = options.now ?? Date.now;
    if (!options.schemaInitialized) defineIdentityAnchorTables(db);
    this.initializeBinding();
  }

  inspect(): IdentityAnchorState {
    return mapState(this.requireState());
  }

  apply(delivery: IdentityProjectionDelivery): IdentityProjectionReceipt {
    assertDeliveryShape(delivery);
    if (delivery.targetId !== this.targetId) {
      throw identityProjectionError('IDENTITY_PROJECTION_TARGET_MISMATCH');
    }
    const anchor = validateIdentityAnchor(delivery.anchor);
    const fingerprint = identityAnchorFingerprint(anchor);
    const now = this.now();
    const result = this.db.transaction<ApplyTransactionResult>(() => {
      const state = this.requireUsableState();
      const existingReceipt = this.db.prepare(`
        SELECT event_id, target_id, sequence, anchor_fingerprint, applied_at
        FROM ${IDENTITY_PROJECTION_RECEIPTS_TABLE} WHERE event_id = ?
      `).get(delivery.eventId) as ReceiptRow | null;
      if (existingReceipt) {
        if (existingReceipt.target_id !== this.targetId
          || existingReceipt.sequence !== delivery.sequence
          || existingReceipt.anchor_fingerprint !== fingerprint
          || !this.anchorMatches(anchor)) {
          this.quarantineInCurrentTransaction('IDENTITY_PROJECTION_CONFLICT', now);
          return { kind: 'conflict' };
        }
        return {
          kind: 'applied',
          receipt: mapReceipt(existingReceipt, true),
        };
      }
      if (delivery.sequence <= state.watermark) {
        this.quarantineInCurrentTransaction('IDENTITY_PROJECTION_CONFLICT', now);
        return { kind: 'conflict' };
      }
      if (delivery.sequence !== state.watermark + 1) {
        throw identityProjectionError('IDENTITY_PROJECTION_NOT_READY');
      }
      if (!this.applyAnchorInCurrentTransaction(anchor)) {
        this.quarantineInCurrentTransaction('IDENTITY_PROJECTION_CONFLICT', now);
        return { kind: 'conflict' };
      }
      this.db.prepare(`
        INSERT INTO ${IDENTITY_PROJECTION_RECEIPTS_TABLE} (
          event_id, target_id, sequence, anchor_fingerprint, applied_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        delivery.eventId,
        this.targetId,
        delivery.sequence,
        fingerprint,
        now,
      );
      this.db.prepare(`
        UPDATE ${IDENTITY_PROJECTION_STATE_TABLE}
        SET watermark = ?, updated_at = ? WHERE singleton = 1
      `).run(delivery.sequence, now);
      return {
        kind: 'applied',
        receipt: Object.freeze({
          eventId: delivery.eventId,
          targetId: this.targetId,
          sequence: delivery.sequence,
          anchorFingerprint: fingerprint,
          appliedAt: now,
          duplicate: false,
        }),
      };
    });
    if (result.kind === 'conflict') {
      throw identityProjectionError('IDENTITY_PROJECTION_CONFLICT');
    }
    return result.receipt;
  }

  markReady(): void {
    const now = this.now();
    this.db.transaction(() => {
      this.requireUsableState();
      this.db.prepare(`
        UPDATE ${IDENTITY_PROJECTION_STATE_TABLE}
        SET status = 'ready', quarantine_code = NULL, updated_at = ?
        WHERE singleton = 1
      `).run(now);
    });
  }

  private initializeBinding(): void {
    const now = this.now();
    this.db.transaction(() => {
      const existing = this.stateRow();
      if (!existing) {
        this.db.prepare(`
          INSERT INTO ${IDENTITY_PROJECTION_STATE_TABLE} (
            singleton, installation_id, target_id, status,
            watermark, quarantine_code, updated_at
          ) VALUES (1, ?, ?, 'provisioning', 0, NULL, ?)
        `).run(this.installationId, this.targetId, now);
        return;
      }
      if (existing.installation_id !== this.installationId
        || existing.target_id !== this.targetId) {
        throw identityProjectionError('IDENTITY_PROJECTION_TARGET_MISMATCH');
      }
    });
  }

  private applyAnchorInCurrentTransaction(
    anchor: ReturnType<typeof validateIdentityAnchor>,
  ): boolean {
    if (anchor.kind === 'user') {
      this.db.prepare('INSERT OR IGNORE INTO users (user_id) VALUES (?)')
        .run(anchor.userId);
      return Boolean(this.db.prepare('SELECT 1 FROM users WHERE user_id = ?')
        .get(anchor.userId));
    }

    const byMembership = this.db.prepare(`
      SELECT tenant_id, user_id FROM tenant_memberships WHERE membership_id = ?
    `).get(anchor.membershipId) as { tenant_id: string; user_id: string } | null;
    if (byMembership) {
      return byMembership.tenant_id === anchor.tenantId
        && byMembership.user_id === anchor.userId;
    }
    const byRelationship = this.db.prepare(`
      SELECT membership_id FROM tenant_memberships
      WHERE tenant_id = ? AND user_id = ?
    `).get(anchor.tenantId, anchor.userId) as { membership_id: string } | null;
    if (byRelationship) return byRelationship.membership_id === anchor.membershipId;
    this.db.prepare('INSERT OR IGNORE INTO users (user_id) VALUES (?)')
      .run(anchor.userId);
    this.db.prepare(`
      INSERT INTO tenant_memberships (membership_id, tenant_id, user_id)
      VALUES (?, ?, ?)
    `).run(anchor.membershipId, anchor.tenantId, anchor.userId);
    return true;
  }

  private anchorMatches(
    anchor: ReturnType<typeof validateIdentityAnchor>,
  ): boolean {
    if (anchor.kind === 'user') {
      return Boolean(this.db.prepare('SELECT 1 FROM users WHERE user_id = ?')
        .get(anchor.userId));
    }
    const row = this.db.prepare(`
      SELECT tenant_id, user_id FROM tenant_memberships WHERE membership_id = ?
    `).get(anchor.membershipId) as { tenant_id: string; user_id: string } | null;
    return row?.tenant_id === anchor.tenantId && row.user_id === anchor.userId;
  }

  private stateRow(): StateRow | null {
    return this.db.prepare(`
      SELECT installation_id, target_id, status, watermark,
             quarantine_code, updated_at
      FROM ${IDENTITY_PROJECTION_STATE_TABLE} WHERE singleton = 1
    `).get() as StateRow | null;
  }

  private requireState(): StateRow {
    const state = this.stateRow();
    if (!state) throw identityProjectionError('IDENTITY_PROJECTION_NOT_READY');
    if (state.installation_id !== this.installationId
      || state.target_id !== this.targetId) {
      throw identityProjectionError('IDENTITY_PROJECTION_TARGET_MISMATCH');
    }
    return state;
  }

  private requireUsableState(): StateRow {
    const state = this.requireState();
    if (state.status === 'quarantined') {
      throw identityProjectionError('IDENTITY_PROJECTION_QUARANTINED');
    }
    return state;
  }

  private quarantineInCurrentTransaction(code: string, now: number): void {
    this.db.prepare(`
      UPDATE ${IDENTITY_PROJECTION_STATE_TABLE}
      SET status = 'quarantined', quarantine_code = ?, updated_at = ?
      WHERE singleton = 1
    `).run(code, now);
  }
}

function assertDeliveryShape(delivery: IdentityProjectionDelivery): void {
  requireIdentityProjectionId(delivery.eventId, 'eventId');
  requireIdentityProjectionId(delivery.targetId, 'targetId');
  if (!Number.isSafeInteger(delivery.sequence) || delivery.sequence < 1) {
    throw identityProjectionError('IDENTITY_PROJECTION_SCHEMA_INVALID');
  }
}

function mapState(row: StateRow): IdentityAnchorState {
  return Object.freeze({
    installationId: row.installation_id,
    targetId: row.target_id,
    status: row.status as IdentityAnchorState['status'],
    watermark: row.watermark,
    quarantineCode: row.quarantine_code,
    updatedAt: row.updated_at,
  });
}

function mapReceipt(row: ReceiptRow, duplicate: boolean): IdentityProjectionReceipt {
  return Object.freeze({
    eventId: row.event_id,
    targetId: row.target_id,
    sequence: row.sequence,
    anchorFingerprint: row.anchor_fingerprint,
    appliedAt: row.applied_at,
    duplicate,
  });
}
