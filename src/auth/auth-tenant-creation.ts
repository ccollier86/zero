import type { AuthTenantSummary } from './auth-tenant-session-types';
import type {
  ResolvedAuthBehaviorConfig,
  UserRecord,
} from './types';
import { AuthError } from './types';
import {
  TenancyError,
  type TenantCreationResult,
} from './tenancy/tenancy-types';

export interface NormalizedTenantCreateFields {
  name: string;
  slug: string;
}

/** Canonical request shaping shared by registration and tenant creation. */
export function normalizeTenantCreateFields(
  nameInput: string | undefined,
  slugInput: string | undefined,
): NormalizedTenantCreateFields {
  const name = nameInput?.trim();
  if (!name) {
    throw new AuthError('Organization name is required', 'TENANT_NAME_REQUIRED', 422);
  }
  const slug = slugInput === undefined
    ? slugifyTenantName(name) || createOpaqueTenantSlug()
    : slugInput.trim();
  if (!slug) {
    throw new AuthError('Organization slug is required', 'TENANT_SLUG_REQUIRED', 422);
  }
  return { name, slug };
}

/** Live post-bootstrap policy check. Bootstrap itself deliberately bypasses this ceiling. */
export function canUserCreateTenant(
  authConfig: ResolvedAuthBehaviorConfig,
  user: Pick<UserRecord, 'role' | 'status'>,
): boolean {
  if (authConfig.tenancy?.mode !== 'multi' || user.status !== 'active') return false;
  const mode = authConfig.tenancy.creation.mode;
  return mode === 'authenticated' || (mode === 'platform-admin' && user.role === 'admin');
}

export function requireUserCanCreateTenant(
  authConfig: ResolvedAuthBehaviorConfig,
  user: Pick<UserRecord, 'role' | 'status'>,
): void {
  if (authConfig.tenancy?.mode !== 'multi') {
    throw new AuthError(
      'Organization creation is unavailable',
      'TENANT_CREATION_UNAVAILABLE',
      404,
    );
  }
  if (authConfig.tenancy.creation.mode === 'disabled') {
    throw new AuthError(
      'Organization creation is disabled',
      'TENANT_CREATION_DISABLED',
      403,
    );
  }
  if (!canUserCreateTenant(authConfig, user)) {
    throw new AuthError(
      'Organization creation requires a platform administrator',
      'TENANT_CREATION_FORBIDDEN',
      403,
    );
  }
}

export function mapTenantCreationError(error: unknown): Error {
  if (!(error instanceof TenancyError)) {
    return error instanceof Error
      ? error
      : new AuthError('Organization setup failed', 'TENANT_SETUP_FAILED', 500);
  }
  switch (error.code) {
    case 'TENANT_SLUG_TAKEN':
      return new AuthError(
        'Organization URL is already in use',
        'TENANT_SLUG_TAKEN',
        409,
      );
    case 'TENANT_INVALID_NAME':
    case 'TENANT_INVALID_SLUG':
      return new AuthError(error.message, error.code, 422);
    default:
      return new AuthError('Organization setup failed', error.code, 409);
  }
}

export function toTenantSummary(created: TenantCreationResult): AuthTenantSummary {
  return {
    tenantId: created.tenant.tenantId,
    slug: created.tenant.slug,
    name: created.tenant.name,
    role: created.ownerMembership.roleKey,
  };
}

export function toRegistrationTenant(created: TenantCreationResult) {
  return {
    ...toTenantSummary(created),
    membershipId: created.ownerMembership.membershipId,
  };
}

function slugifyTenantName(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

function createOpaqueTenantSlug(): string {
  return `org-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
