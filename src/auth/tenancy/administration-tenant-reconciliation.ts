/** Startup reconciliation for the protected multi-tenant control plane. */

import type { AuthAuditService } from '../auth-audit-service';
import type { AuthPlatformCodeEmitter } from '../auth-observability';
import { OBS_CODES } from '../../observability/codes';
import type { TenantRecord } from './tenancy-types';
import type { TenancyService } from './tenancy-service';

export interface AdministrationTenantReconciliationInput {
  tenancy: TenancyService;
  adoptTenantId?: string;
  audit?: AuthAuditService;
  emitCode?: AuthPlatformCodeEmitter;
}

/**
 * Resolve exactly one administration organization before a populated multi-
 * tenant runtime is published. Migration 024 may already have adopted an
 * exact bootstrap-audit candidate. Every other populated installation must
 * name one exact internal tenant ID; startup never guesses from age or slug.
 *
 * Call this inside the installed-profile writer transaction so adoption,
 * audit evidence, role reconciliation, and profile publication commit as one.
 */
export function reconcileAdministrationTenant(
  input: AdministrationTenantReconciliationInput,
): TenantRecord | null {
  const configuredId = input.adoptTenantId?.trim();
  const current = input.tenancy.getAdministrationTenant();
  if (current) {
    if (configuredId && configuredId !== current.tenantId) {
      throw startupError(input,
        `Configured adoptTenantId "${configuredId}" does not match the protected `
          + `administration tenant "${current.tenantId}".`,
        'configured-tenant-mismatch',
      );
    }
    return current;
  }

  const retained = input.tenancy.countTenants();
  if (retained === 0) {
    if (configuredId) {
      throw startupError(input,
        `Configured adoptTenantId "${configuredId}" does not identify an existing tenant.`,
        'configured-tenant-missing',
      );
    }
    // The first bootstrap registration creates the administration tenant
    // atomically with its owner; an empty install is therefore ready.
    return null;
  }

  if (!configuredId) {
    throw startupError(input,
      `This populated multi-tenant installation has ${retained} retained tenant`
        + `${retained === 1 ? '' : 's'} but no protected administration tenant. `
        + 'Set auth.tenancy.administration.adoptTenantId to the exact internal '
        + 'tenant ID that owns platform administration, start once to adopt it '
        + 'atomically, then keep or remove the idempotent setting.',
      'explicit-adoption-required',
      retained,
    );
  }

  const candidate = input.tenancy.getTenant(configuredId);
  if (!candidate) {
    throw startupError(input,
      `Configured adoptTenantId "${configuredId}" does not identify an existing tenant.`,
      'configured-tenant-missing',
    );
  }
  if (candidate.status !== 'active') {
    throw startupError(input,
      `Configured adoptTenantId "${configuredId}" must identify an active tenant.`,
      'configured-tenant-inactive',
    );
  }

  const adopted = input.tenancy.adoptAdministrationTenant(configuredId);
  input.audit?.append({
    action: 'tenant.administration-adopted',
    outcome: 'succeeded',
    scope: { kind: 'tenant', tenantId: adopted.tenantId },
    actor: { provenance: 'system' },
    target: { type: 'tenant', id: adopted.tenantId },
    metadata: { source: 'configured-exact-tenant-id' },
  });
  return adopted;
}

export class AdministrationTenantReconciliationError extends Error {
  readonly code = 'AUTH_ADMINISTRATION_TENANT_RECONCILIATION_FAILED';

  constructor(detail: string) {
    super(`[auth] ${detail}`);
    this.name = 'AdministrationTenantReconciliationError';
  }
}

function startupError(
  input: AdministrationTenantReconciliationInput,
  detail: string,
  reason: string,
  retainedTenants?: number,
): AdministrationTenantReconciliationError {
  const error = new AdministrationTenantReconciliationError(detail);
  input.emitCode?.(OBS_CODES.AUTH_ADMINISTRATION_TENANT_RECONCILIATION_FAILED, {
    error,
    metadata: {
      reason,
      ...(retainedTenants === undefined ? {} : { retainedTenants }),
    },
  });
  return error;
}
