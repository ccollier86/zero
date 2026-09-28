/** Browser-safe contracts for the durable auth/control-plane audit trail. */

export type {
  AuthAuditActorProvenance,
  AuthAuditEvent,
  AuthAuditExport,
  AuthAuditMetadata,
  AuthAuditMetadataValue,
  AuthAuditOutcome,
  AuthAuditPage,
  AuthAuditQuery,
  AuthAuditScopeKind,
} from '../../auth/auth-audit-types';

import type {
  AuthAuditExport,
  AuthAuditPage,
  AuthAuditQuery,
} from '../../auth/auth-audit-types';

export type AuthAuditReadScope = 'platform' | 'tenant';

export interface AuthAuditPruneResult {
  deleted: number;
  hasMore: boolean;
}

export interface AuthAuditSdkSurface {
  list(scope: AuthAuditReadScope, query?: AuthAuditQuery): Promise<AuthAuditPage>;
  export(scope: AuthAuditReadScope, query?: AuthAuditQuery): Promise<AuthAuditExport>;
  /** Platform-admin-only explicit retention pass. */
  prune(): Promise<AuthAuditPruneResult>;
}
