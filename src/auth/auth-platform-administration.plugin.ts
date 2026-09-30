/** Protected administration-organization and customer-tenant control plane. */

import { Elysia, t } from 'elysia';
import { parseTokenTTL } from '../tokens/token-utils';
import type { AccountEmailService } from './account-email-service';
import type { AuthEmailOutbox } from './auth-email-outbox';
import { authAuditRequestFromRequest } from './auth-audit-service';
import {
  captureAuthApplicationMutationAuthority,
  type AssertAuthApplicationMutationAuthority,
} from './auth-application-mutation-authority';
import { createRequestAuthorizationAccess } from './authorization-access';
import type { AuthorizationKernel, AuthorizationScopeSnapshot } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import { extractAuthContext } from './auth-context';
import { EMAIL_MAX_LENGTH, EMAIL_PATTERN_SOURCE } from './auth-email-identity';
import type { AuthPlatformTenantAdministrationService } from './auth-platform-tenant-administration-service';
import { applyAuthPrivateNoStore } from './auth-response-cache';
import type { AuthTenantAdministrationService } from './auth-tenant-administration-service';
import {
  captureAuthTenantMutationAuthority,
  type AssertAuthTenantMutationAuthority,
} from './auth-tenant-mutation-authority';
import type { AuthTenantOnboardingService } from './auth-tenant-onboarding-service';
import type { TokenService } from './token-service';
import type { TenancyService } from './tenancy/tenancy-service';
import { AuthError, type AuthContext } from './types';
import type { UserStore } from './user-store';

const idSchema = t.String({
  minLength: 1,
  maxLength: 200,
  pattern: '^[A-Za-z0-9_-]+$',
});
const roleKeySchema = t.String({
  minLength: 1,
  maxLength: 64,
  pattern: '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$',
});
const rolesSchema = t.Array(roleKeySchema, {
  minItems: 1,
  maxItems: 32,
  uniqueItems: true,
});
const platformMemberRolesSchema = t.Array(roleKeySchema, {
  maxItems: 32,
  uniqueItems: true,
});
const emailSchema = t.String({
  minLength: 1,
  maxLength: EMAIL_MAX_LENGTH,
  pattern: `^${EMAIL_PATTERN_SOURCE}$`,
});

export interface AuthPlatformAdministrationPluginConfig {
  getUserStore: () => UserStore | null;
  getTokenService: () => TokenService | null;
  getTenancyService: () => TenancyService | null;
  getAuthorizationKernel: () => AuthorizationKernel;
  getAuthorizationRoleService: () => AuthorizationRoleService | null;
  getTenantAdministrationService: () => AuthTenantAdministrationService | null;
  getTenantOnboardingService: () => AuthTenantOnboardingService | null;
  getPlatformTenantAdministrationService:
    () => AuthPlatformTenantAdministrationService | null;
  getAccountEmailService: () => AccountEmailService | null;
  getAuthEmailOutbox: () => AuthEmailOutbox | null;
}

interface PlatformActor {
  auth: AuthContext;
  tenantScope: AuthorizationScopeSnapshot & {
    scopeKind: 'tenant';
    tenantId: string;
    membershipId: string;
  };
  applicationScope: AuthorizationScopeSnapshot & { scopeKind: 'application' };
  access: ReturnType<typeof createRequestAuthorizationAccess>;
  tenantAdministration: AuthTenantAdministrationService;
  tenantOnboarding: AuthTenantOnboardingService;
  platformTenants: AuthPlatformTenantAdministrationService;
  assertTenantAuthority: AssertAuthTenantMutationAuthority;
  assertApplicationAuthority: AssertAuthApplicationMutationAuthority;
}

export function createAuthPlatformAdministrationPlugin(
  config: AuthPlatformAdministrationPluginConfig,
) {
  return new Elysia({ name: 'auth-platform-administration', prefix: '/platform' })
    .get('/config', async ({ request, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requirePlatformActor(config, request);
      const tenantConfig = actor.tenantAdministration.getConfig({
        tenantId: actor.tenantScope.tenantId,
        membershipId: actor.tenantScope.membershipId,
        scope: actor.tenantScope,
        applicationScope: actor.applicationScope,
        assertCurrentAuthority: actor.assertTenantAuthority,
      });
      actor.assertApplicationAuthority([]);
      const has = (permission: string) => actor.access.hasPermission(permission);
      return Object.freeze({
        authorization: tenantConfig.authorization,
        administration: Object.freeze({
          tenantId: tenantConfig.tenant.tenantId,
          kind: 'administration' as const,
          slug: tenantConfig.tenant.slug,
          name: tenantConfig.tenant.name,
          membershipId: tenantConfig.actor.membershipId,
        }),
        capabilities: Object.freeze({
          canReadMembers: tenantConfig.capabilities.canReadMembers,
          canManageMembers: tenantConfig.capabilities.canManageMembers,
          canManageRoles: tenantConfig.capabilities.canManageRoles,
          canReadInvitations: tenantConfig.capabilities.canReadInvitations,
          canManageInvitations: tenantConfig.capabilities.canManageInvitations,
          canReadTenants: has('application.tenants:read'),
          canReadTenantMembers: has('application.tenants:read')
            && has('application.users:read'),
          canManageTenants: has('application.tenants:manage'),
          canCreateTenants: has('application.tenants:manage')
            && has('application.users:read'),
          canTransferOwnership: tenantConfig.capabilities.canTransferOwnership,
        }),
        roles: tenantConfig.roles,
      });
    })
    .get('/members', async ({ request, query, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requirePlatformActor(config, request);
      actor.access.requirePermission('tenant.members:read');
      return actor.tenantAdministration.listMembers(actor.tenantScope.tenantId, {
        limit: query.limit,
        cursor: query.cursor,
        search: query.search,
        status: query.status,
      }, actor.assertTenantAuthority);
    }, { query: memberListSchema() })
    .post('/members', async ({ request, body }) => {
      const actor = await requirePlatformActor(config, request);
      actor.access.requirePermission('tenant.members:manage');
      const roles = requireAdministrationMemberRoles(body.roles);
      actor.access.requirePermission('tenant.roles:manage');
      return actor.tenantAdministration.addMember({
        tenantId: actor.tenantScope.tenantId,
        email: body.email,
        roleKeys: roles,
        assertCurrentAuthority: actor.assertTenantAuthority,
        auditRequest: authAuditRequestFromRequest(request),
      });
    }, {
      body: t.Object({
        email: emailSchema,
        // Missing/empty role selections are structurally valid JSON but fail
        // the administration semantic contract with its stable domain code.
        roles: t.Optional(platformMemberRolesSchema),
      }, { additionalProperties: false }),
    })
    .patch('/members/:membershipId', async ({ request, params, body }) => {
      const actor = await requirePlatformActor(config, request);
      actor.access.requirePermission('tenant.members:manage');
      if (body.status === undefined && body.roles === undefined) {
        throw new AuthError(
          'Provide a membership status or role change',
          'TENANT_MEMBER_UPDATE_EMPTY',
          422,
        );
      }
      if (body.roles !== undefined) actor.access.requirePermission('tenant.roles:manage');
      return actor.tenantAdministration.updateMember({
        tenantId: actor.tenantScope.tenantId,
        membershipId: params.membershipId,
        status: body.status,
        roleKeys: body.roles,
        expectedRoleRevision: body.expectedRoleRevision,
        assertCurrentAuthority: actor.assertTenantAuthority,
        auditRequest: authAuditRequestFromRequest(request),
      });
    }, {
      params: t.Object({ membershipId: idSchema }, { additionalProperties: false }),
      body: t.Object({
        status: t.Optional(t.Union([t.Literal('active'), t.Literal('suspended')])),
        roles: t.Optional(rolesSchema),
        expectedRoleRevision: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
      }, { additionalProperties: false }),
    })
    .delete('/members/:membershipId', async ({ request, params }) => {
      const actor = await requirePlatformActor(config, request);
      actor.access.requirePermission('tenant.members:manage');
      return actor.tenantAdministration.removeMember({
        tenantId: actor.tenantScope.tenantId,
        membershipId: params.membershipId,
        assertCurrentAuthority: actor.assertTenantAuthority,
        auditRequest: authAuditRequestFromRequest(request),
      });
    }, {
      params: t.Object({ membershipId: idSchema }, { additionalProperties: false }),
    })
    .post('/ownership/transfer', async ({ request, body }) => {
      const actor = await requirePlatformActor(config, request);
      actor.access.requirePermission('tenant.roles:manage');
      return actor.tenantAdministration.transferOwnership({
        tenantId: actor.tenantScope.tenantId,
        targetMembershipId: body.membershipId,
        assertCurrentAuthority: actor.assertTenantAuthority,
        auditRequest: authAuditRequestFromRequest(request),
      });
    }, {
      body: t.Object({ membershipId: idSchema }, { additionalProperties: false }),
    })
    .get('/invitations', async ({ request, query, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requirePlatformActor(config, request);
      actor.access.requirePermission('tenant.invitations:read');
      return actor.tenantOnboarding.listInvitations({
        tenantId: actor.tenantScope.tenantId,
        status: query.status,
        limit: query.limit,
        cursor: query.cursor,
        assertCurrentAuthority: actor.assertTenantAuthority,
      });
    }, {
      query: t.Object({
        status: t.Optional(t.Union([
          t.Literal('pending'),
          t.Literal('accepted'),
          t.Literal('revoked'),
          t.Literal('expired'),
        ])),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
      }, { additionalProperties: false }),
    })
    .post('/invitations', async ({ request, body }) => {
      const actor = await requirePlatformActor(config, request);
      actor.access.requirePermission('tenant.invitations:manage');
      const roles = body.roles;
      actor.access.requirePermission('tenant.roles:manage');
      const delivery = body.delivery
        ?? actor.tenantOnboarding.config.invitations.delivery.default;
      let outbox: AuthEmailOutbox | null = null;
      if (delivery === 'manual') {
        if (!actor.tenantOnboarding.config.invitations.delivery.allowManual) {
          throw new AuthError(
            'Manual tenant invitation delivery is disabled',
            'TENANT_INVITATION_MANUAL_DISABLED',
            403,
          );
        }
      } else {
        if (!actor.tenantOnboarding.config.invitations.delivery.email.enabled) {
          throw new AuthError(
            'Tenant invitation email delivery is disabled',
            'TENANT_INVITATION_EMAIL_DISABLED',
            422,
          );
        }
        const email = config.getAccountEmailService();
        outbox = config.getAuthEmailOutbox();
        if (!email || !outbox) {
          throw new AuthError(
            'Tenant invitation email delivery is unavailable',
            'TENANT_INVITATION_EMAIL_UNAVAILABLE',
            503,
          );
        }
        email.assertReady();
      }
      const created = actor.tenantOnboarding.issueInvitation({
        tenantId: actor.tenantScope.tenantId,
        email: body.email,
        roleKeys: roles,
        ttlMs: body.expiresIn === undefined
          ? undefined
          : parseTokenTTL(body.expiresIn, 'tenant invitation lifetime'),
        assertCurrentAuthority: actor.assertTenantAuthority,
        auditRequest: authAuditRequestFromRequest(request),
        ...(delivery === 'email' ? {
          afterPersist: (issued: {
            invitationId: string;
            recipient: string;
            rawToken: string;
          }) => {
            const queued = outbox!.enqueueInvitation(issued);
            if (queued.result !== 'enqueued') {
              throw new AuthError(
                'Tenant invitation email queue is at capacity',
                'TENANT_INVITATION_EMAIL_CAPACITY',
                503,
              );
            }
          },
        } : {}),
      });
      return delivery === 'manual'
        ? {
            invitation: created.invitation,
            delivery: { mode: 'manual' as const },
            token: created.token,
          }
        : {
            invitation: created.invitation,
            delivery: { mode: 'email' as const, status: 'queued' as const },
          };
    }, {
      body: t.Object({
        email: emailSchema,
        roles: rolesSchema,
        expiresIn: t.Optional(t.String({
          minLength: 2,
          maxLength: 12,
          pattern: '^\\d+[smhd]$',
        })),
        delivery: t.Optional(t.Union([t.Literal('manual'), t.Literal('email')])),
      }, { additionalProperties: false }),
    })
    .delete('/invitations/:invitationId', async ({ request, params }) => {
      const actor = await requirePlatformActor(config, request);
      actor.access.requirePermission('tenant.invitations:manage');
      return {
        invitation: actor.tenantOnboarding.revokeInvitation({
          tenantId: actor.tenantScope.tenantId,
          invitationId: params.invitationId,
          assertCurrentAuthority: actor.assertTenantAuthority,
          auditRequest: authAuditRequestFromRequest(request),
        }),
      };
    }, {
      params: t.Object({ invitationId: idSchema }, { additionalProperties: false }),
    })
    .get('/tenants', async ({ request, query, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requirePlatformActor(config, request);
      actor.access.requirePermission('application.tenants:read');
      return actor.platformTenants.listTenants({
        administrationTenantId: actor.tenantScope.tenantId,
        query: {
          status: query.status,
          limit: query.limit,
          cursor: query.cursor,
          search: query.search,
        },
        assertCurrentAuthority: actor.assertApplicationAuthority,
      });
    }, {
      query: t.Object({
        status: t.Optional(t.Union([
          t.Literal('active'),
          t.Literal('suspended'),
          t.Literal('archived'),
        ])),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
        search: t.Optional(t.String({ maxLength: 120 })),
      }, { additionalProperties: false }),
    })
    .post('/tenants', async ({ request, body }) => {
      const actor = await requirePlatformActor(config, request);
      actor.access.requirePermission('application.tenants:manage');
      actor.access.requirePermission('application.users:read');
      return actor.platformTenants.createTenant({
        administrationTenantId: actor.tenantScope.tenantId,
        name: body.name,
        slug: body.slug,
        ownerEmail: body.ownerEmail,
        assertCurrentAuthority: actor.assertApplicationAuthority,
        auditRequest: authAuditRequestFromRequest(request),
      });
    }, {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 120 }),
        slug: t.Optional(t.String({ minLength: 1, maxLength: 63 })),
        ownerEmail: emailSchema,
      }, { additionalProperties: false }),
    })
    .patch('/tenants/:tenantId', async ({ request, params, body }) => {
      const actor = await requirePlatformActor(config, request);
      actor.access.requirePermission('application.tenants:manage');
      return actor.platformTenants.updateTenant({
        administrationTenantId: actor.tenantScope.tenantId,
        tenantId: params.tenantId,
        status: body.status,
        expectedAuthorizationGeneration: body.expectedAuthorizationGeneration,
        assertCurrentAuthority: actor.assertApplicationAuthority,
        auditRequest: authAuditRequestFromRequest(request),
      });
    }, {
      params: t.Object({ tenantId: idSchema }, { additionalProperties: false }),
      body: t.Object({
        status: t.Union([t.Literal('active'), t.Literal('suspended')]),
        expectedAuthorizationGeneration: t.Integer({ minimum: 0 }),
      }, { additionalProperties: false }),
    })
    .get('/tenants/:tenantId/members', async ({ request, params, query, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requirePlatformActor(config, request);
      actor.access.requirePermission('application.tenants:read');
      actor.access.requirePermission('application.users:read');
      return actor.platformTenants.listTenantMembers({
        administrationTenantId: actor.tenantScope.tenantId,
        tenantId: params.tenantId,
        query: {
          limit: query.limit,
          cursor: query.cursor,
          search: query.search,
          status: query.status,
        },
        assertCurrentAuthority: actor.assertApplicationAuthority,
      });
    }, {
      params: t.Object({ tenantId: idSchema }, { additionalProperties: false }),
      query: memberListSchema(),
    });
}

function requireAdministrationMemberRoles(
  roles: readonly string[] | undefined,
): readonly string[] {
  if (roles === undefined || roles.length === 0) {
    throw new AuthError(
      'Administration organization members require a platform administration role',
      'AUTHORIZATION_ADMINISTRATION_ROLE_REQUIRED',
      422,
    );
  }
  return roles;
}

async function requirePlatformActor(
  config: AuthPlatformAdministrationPluginConfig,
  request: Request,
): Promise<PlatformActor> {
  const kernel = config.getAuthorizationKernel();
  if (kernel.tenancy.mode !== 'multi') {
    throw new AuthError(
      'Platform administration is unavailable for this auth profile',
      'PLATFORM_ADMINISTRATION_UNAVAILABLE',
      404,
    );
  }
  const store = config.getUserStore();
  const tokenService = config.getTokenService();
  const tenancy = config.getTenancyService();
  const tenantAdministration = config.getTenantAdministrationService();
  const tenantOnboarding = config.getTenantOnboardingService();
  const platformTenants = config.getPlatformTenantAdministrationService();
  if (!store || !tokenService || !tenancy || !tenantAdministration
    || !tenantOnboarding || !platformTenants) {
    throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  }
  const auth = await extractAuthContext(request, tokenService);
  if (!auth) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
  const roles = config.getAuthorizationRoleService();
  const access = createRequestAuthorizationAccess({
    authContext: auth,
    kernel,
    propertyStore: store,
    roleAssignments: roles,
  });
  const tenantScope = access.requireTenant();
  const applicationScope = access.requireApplicationAuthorization();
  const administration = tenancy.getTenant(tenantScope.tenantId);
  if (!administration || administration.kind !== 'administration'
    || administration.status !== 'active' || auth.tenantKind !== 'administration') {
    throw new AuthError('Forbidden', 'FORBIDDEN', 403);
  }
  return {
    auth,
    tenantScope,
    applicationScope,
    access,
    tenantAdministration,
    tenantOnboarding,
    platformTenants,
    assertTenantAuthority: captureAuthTenantMutationAuthority({
      auth,
      tokenService,
      kernel,
      store,
      roles,
    }),
    assertApplicationAuthority: captureAuthApplicationMutationAuthority({
      auth,
      tokenService,
      kernel,
      store,
      roles,
    }),
  };
}

function memberListSchema() {
  return t.Object({
    limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
    cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
    search: t.Optional(t.String({ maxLength: 120 })),
    status: t.Optional(t.Union([
      t.Literal('active'),
      t.Literal('suspended'),
      t.Literal('removed'),
    ])),
  }, { additionalProperties: false });
}
