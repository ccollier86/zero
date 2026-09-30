import type { AuthPlatformCodeEmitter } from '../../auth/auth-observability';
import type { IdentityAnchorState } from '../../auth/identity-projection-types';
import {
  IdentityProjectionError,
  identityProjectionError,
} from '../../auth/identity-projection-error';
import type { DatabaseManager } from '../../databases/database-manager';
import { normalizeDatabaseError } from '../../databases/database-error';
import { OBS_CODES } from '../../observability/codes';

/** Best-effort lifecycle scheduling; admission/readiness remains the hard barrier. */
export class IdentityProjectionTenantProvisioner {
  constructor(
    private readonly getDatabaseManager: () => DatabaseManager | null,
    private readonly emitCode: AuthPlatformCodeEmitter,
  ) {}

  async ensure(tenantId: string): Promise<boolean> {
    const manager = this.getDatabaseManager();
    if (!manager) return false;
    await manager.ensureTenantIdentityProjection(tenantId);
    return true;
  }

  async inspect(tenantId: string): Promise<IdentityAnchorState | null> {
    const manager = this.getDatabaseManager();
    if (!manager) return null;
    return await manager.inspectTenantIdentityProjection(tenantId);
  }

  schedule(tenantId: string): void {
    queueMicrotask(() => {
      void this.run(tenantId).catch(() => undefined);
    });
  }

  private async run(tenantId: string): Promise<void> {
    try {
      if (!await this.ensure(tenantId)) {
        throw identityProjectionError('IDENTITY_PROJECTION_NOT_READY');
      }
    } catch (error) {
      this.reportFailure(error);
    }
  }

  private reportFailure(error: unknown): void {
    const failure = backgroundProvisioningFailure(error);
    try {
      this.emitCode(
        failure.retryable
          ? OBS_CODES.AUTH_IDENTITY_PROJECTION_RETRY
          : OBS_CODES.AUTH_IDENTITY_PROJECTION_FAILED,
        {
          metadata: {
            scope: 'tenant',
            code: failure.code,
          },
        },
      );
    } catch {
      // Lifecycle provisioning and observability are both best-effort. Tenant
      // admission/readiness remains the authoritative correctness barrier.
    }
  }
}

interface BackgroundProvisioningFailure {
  readonly code: string;
  readonly retryable: boolean;
}

function backgroundProvisioningFailure(
  error: unknown,
): BackgroundProvisioningFailure {
  try {
    if (error instanceof IdentityProjectionError) {
      return Object.freeze({
        code: error.code,
        retryable: error.retryable,
      });
    }
  } catch {
    // Hostile thrown values fall through to the privacy-safe DB normalizer.
  }
  const databaseError = normalizeDatabaseError(error);
  return Object.freeze({
    code: databaseError.code,
    retryable: databaseError.retryable
      && databaseError.outcome !== 'unknown',
  });
}
