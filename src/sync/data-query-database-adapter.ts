/**
 * Physical database boundary for the managed-table HTTP query endpoint.
 *
 * This adapter owns durable authority fencing, tenant actor acquisition, and
 * database-error sanitization. Route parsing, resource policy, SQL planning,
 * observability, and HTTP response assembly remain in data-query.plugin.ts.
 */

import { readAuthBearerToken } from '../auth/auth-bearer-token';
import type { TokenService } from '../auth/token-service';
import type { AuthContext, AuthTenancyMode } from '../auth/types';
import {
  DatabaseError,
  type DatabaseErrorCode,
} from '../databases/database-error';
import { classifyDatabaseHttpFailure } from '../databases/database-http-error';
import type { DatabaseManager } from '../databases/database-manager';
import type {
  DatabaseFindInput,
  DatabaseFindRows,
} from '../databases/database-operations';
import type { ResourceTenantScope } from '../resources/resource-realm';

export interface DataQueryDatabaseAdapterOptions {
  readonly tenancyMode?: AuthTenancyMode;
  readonly getTokenService?: () => TokenService | null;
  readonly getDatabaseManager?: () => DatabaseManager | null;
  readonly authorityFingerprint: (authContext: AuthContext | null) => string;
}

export interface DataQueryCommitAuthority {
  resolve(): AuthContext | null;
}

export interface DataQueryDatabaseFailure {
  readonly status: number;
  readonly error: string;
  readonly code: string;
  readonly databaseCode: DatabaseErrorCode;
}

export interface DataQueryTenantFindRequest {
  readonly scope: ResourceTenantScope | null | undefined;
  readonly authority: DataQueryCommitAuthority | undefined;
  readonly authorityFingerprint: string | undefined;
  readonly table: string;
  readonly clientInput: DatabaseFindInput;
}

/** App-local adapter for authority-fenced managed-table database reads. */
export class DataQueryDatabaseAdapter {
  constructor(private readonly options: DataQueryDatabaseAdapterOptions) {}

  /** Capture the durable synchronous authority used at database boundaries. */
  captureCommitAuthority(
    authContext: AuthContext | null,
  ): DataQueryCommitAuthority | undefined {
    if (!authContext) return undefined;

    // Legacy standalone verifiers do not expose the durable synchronous
    // authority contract. Preserve that compatibility in single mode only.
    // Multi mode returns a deliberately unavailable resolver so the database
    // boundary fails closed instead of accepting stale request-time context.
    const unavailable = (): DataQueryCommitAuthority | undefined =>
      this.options.tenancyMode === 'multi' ? { resolve: () => null } : undefined;
    if (!authContext.sessionKind) return unavailable();

    const tokens = this.options.getTokenService?.() ?? null;
    if (!tokens
      || typeof tokens.captureAuthContextAuthority !== 'function'
      || typeof tokens.resolveAuthContextAuthority !== 'function') return unavailable();

    const reference = tokens.captureAuthContextAuthority(authContext);
    return {
      resolve: () => reference
        ? tokens.resolveAuthContextAuthority(reference)
        : null,
    };
  }

  /** Re-resolve bearer authority before entering a database read boundary. */
  async isRequestAuthorityCurrent(
    request: Request,
    expectedFingerprint: string,
  ): Promise<boolean> {
    const bearer = readAuthBearerToken(request);
    const tokens = this.options.getTokenService?.() ?? null;
    let current: AuthContext | null = null;
    try {
      if (bearer && tokens) {
        if (typeof tokens.resolveAuthContext === 'function') {
          current = await tokens.resolveAuthContext(bearer);
        } else {
          const payload = await tokens.verifyAccessToken(bearer);
          current = payload
            && typeof payload.email === 'string'
            && typeof payload.role === 'string'
            ? {
                userId: payload.sub,
                email: payload.email,
                role: payload.role,
              }
            : null;
        }
      }
    } catch {
      current = null;
    }
    return this.options.authorityFingerprint(current) === expectedFingerprint;
  }

  /** Synchronously fence SQL commits and actor-result delivery. */
  isAuthorityCurrentAtCommit(
    authority: DataQueryCommitAuthority | undefined,
    expectedFingerprint: string,
  ): boolean {
    if (!authority) return true;
    try {
      return this.options.authorityFingerprint(authority.resolve()) === expectedFingerprint;
    } catch {
      return false;
    }
  }

  /** Execute one read through a capability derived only from verified scope. */
  async findTenant(request: DataQueryTenantFindRequest): Promise<DatabaseFindRows> {
    if (request.scope?.isolation !== 'tenant-database'
      || !request.authority
      || !request.authorityFingerprint) {
      throw new DatabaseError(
        'DATABASE_AUTHORITY_CHANGED',
        'Tenant database authority is unavailable.',
      );
    }

    const manager = this.options.getDatabaseManager?.() ?? null;
    if (!manager) {
      throw new DatabaseError(
        'DATABASE_NOT_READY',
        'Tenant database service is unavailable.',
      );
    }

    const assertCurrentAuthority = (): undefined => {
      if (!this.isAuthorityCurrentAtCommit(
        request.authority,
        request.authorityFingerprint!,
      )) {
        throw new DatabaseError(
          'DATABASE_AUTHORITY_CHANGED',
          'Tenant database authority changed.',
        );
      }
      return undefined;
    };

    // Fail before actor acquisition when the durable resolver is unavailable.
    assertCurrentAuthority();
    const binding = await manager.bindTenant({
      tenantId: request.scope.tenantId,
      assertCurrentAuthoritySync: assertCurrentAuthority,
      assertCurrentReadAuthority: assertCurrentAuthority,
    });
    try {
      const result = await binding.client.find(request.table, request.clientInput);
      return result.value;
    } finally {
      binding.release();
    }
  }

  /** Map internal actor failures to the stable, sanitized data-query contract. */
  classifyFailure(error: unknown): DataQueryDatabaseFailure {
    const classified = classifyDatabaseHttpFailure(error, 'read');
    const common = { databaseCode: classified.databaseCode };
    switch (classified.kind) {
      case 'authority':
        return {
          ...common,
          status: 403,
          error: 'Resource authorization changed during the request',
          code: 'resource-authority-changed',
        };
      case 'invalid':
        return {
          ...common,
          status: 400,
          error: 'Invalid data query',
          code: 'invalid-data-query',
        };
      case 'conflict':
        return {
          ...common,
          status: 409,
          error: 'Data changed during the query; retry the request',
          code: 'data-query-conflict',
        };
      case 'capacity':
        return {
          ...common,
          status: 503,
          error: 'Tenant database capacity is exhausted',
          code: 'database-capacity-exhausted',
        };
      case 'unavailable':
      case 'write-outcome-unknown':
        return {
          ...common,
          status: 503,
          error: 'Tenant database is temporarily unavailable',
          code: 'database-unavailable',
        };
    }
  }
}
