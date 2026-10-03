/**
 * storage-studio-audit.ts
 *
 * Converts Storage Studio domain events into Guardian's append-only audit
 * contract. This module never decides authorization or storage policy.
 */

import type { AuthAuditService } from '../auth/auth-audit-service';
import type { StorageStudioAuthority } from './storage-studio-authority';

export type StorageStudioAuditOutcome = 'succeeded' | 'failed';

/** Narrow audit facade shared by the focused Storage Studio domain services. */
export class StorageStudioAudit {
  constructor(private readonly audit: AuthAuditService | null | undefined) {}

  append(
    authority: StorageStudioAuthority,
    action: string,
    outcome: StorageStudioAuditOutcome,
    driveId: string | null,
    metadata: Record<string, string | number | boolean | null>,
  ): void {
    this.appendWithProvenance(
      authority,
      action,
      outcome,
      driveId,
      metadata,
      'authenticated-request',
    );
  }

  /** Attribute a durable continuation to its original actor without a live session. */
  appendContinuation(
    authority: StorageStudioAuthority,
    action: string,
    outcome: StorageStudioAuditOutcome,
    driveId: string | null,
    metadata: Record<string, string | number | boolean | null>,
  ): void {
    this.appendWithProvenance(
      authority,
      action,
      outcome,
      driveId,
      metadata,
      'system',
    );
  }

  private appendWithProvenance(
    authority: StorageStudioAuthority,
    action: string,
    outcome: StorageStudioAuditOutcome,
    driveId: string | null,
    metadata: Record<string, string | number | boolean | null>,
    provenance: 'authenticated-request' | 'system',
  ): void {
    this.audit?.append({
      action,
      outcome,
      scope: authority.scope.scopeKind === 'tenant'
        ? { kind: 'tenant', tenantId: authority.scope.tenantId }
        : { kind: 'application' },
      actor: {
        userId: authority.actor.userId,
        membershipId: authority.actor.membershipId,
        ...(provenance === 'authenticated-request'
          ? {
              sessionId: authority.actor.sessionId,
              sessionKind: authority.actor.sessionKind,
              clientId: authority.actor.clientId,
            }
          : {}),
        provenance,
      },
      target: {
        type: 'storage-drive',
        ...(driveId ? { id: driveId } : {}),
      },
      metadata,
    });
  }
}
