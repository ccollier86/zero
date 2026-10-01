import { describe, expect, test } from 'bun:test';
import {
  parsePlatformAdministrationConfig,
  parsePlatformInvitationIssue,
  parsePlatformInvitationPage,
  parsePlatformInvitationReceipt,
  parsePlatformMemberMutation,
  parsePlatformMemberPage,
  parsePlatformOwnershipTransfer,
  parsePlatformTenantCreate,
  parsePlatformTenantMemberMutation,
  parsePlatformTenantOwnershipTransfer,
  parsePlatformTenantPage,
  parsePlatformTenantUpdate,
} from './auth-platform-administration-parser';
import { AuthPlatformAdministrationTransport } from './auth-platform-administration-transport';
import type {
  AuthPlatformAddMemberParams,
  AuthPlatformIssueInvitationParams,
  AuthPlatformUpdateMemberInput,
  AuthPlatformUpdateMemberParams,
} from './auth-platform-administration-types';
import type { AuthTenantAddMemberParams } from './auth-types';

const platformMemberInput: AuthPlatformAddMemberParams = {
  email: 'operator@example.test',
  roles: ['administrator'],
};
const ordinaryTenantMemberInput: AuthTenantAddMemberParams = {
  email: 'member@example.test',
};
// @ts-expect-error Administration membership never defaults to a customer role.
const missingPlatformRoles: AuthPlatformAddMemberParams = { email: 'invalid@example.test' };
const emptyPlatformRoles: AuthPlatformAddMemberParams = {
  email: 'invalid@example.test',
  // @ts-expect-error An explicit empty platform role set is never valid.
  roles: [],
};
// @ts-expect-error A platform member update must change status or provide roles.
const emptyPlatformUpdate: AuthPlatformUpdateMemberParams = {};
// @ts-expect-error Platform role replacement cannot clear all administration roles.
const clearedPlatformRoles: AuthPlatformUpdateMemberParams = { roles: [] };
// @ts-expect-error Direct role replacement requires a current revision fence.
const missingPlatformRoleRevision: AuthPlatformUpdateMemberParams = {
  roles: ['administrator'],
};
// @ts-expect-error Status plus roles still requires a current revision fence.
const missingCombinedRoleRevision: AuthPlatformUpdateMemberParams = {
  status: 'active',
  roles: ['administrator'],
};
const hookRoleUpdate: AuthPlatformUpdateMemberInput = {
  roles: ['administrator'],
};
// @ts-expect-error Platform invitations always require an explicit role set.
const missingInvitationRoles: AuthPlatformIssueInvitationParams = {
  email: 'invalid@example.test',
};
const emptyInvitationRoles: AuthPlatformIssueInvitationParams = {
  email: 'invalid@example.test',
  // @ts-expect-error Platform invitation roles cannot be empty.
  roles: [],
};

describe('platform administration transport', () => {
  test('keeps platform roles required while ordinary tenant roles remain optional', () => {
    expect(platformMemberInput.roles).toEqual(['administrator']);
    expect(ordinaryTenantMemberInput.roles).toBeUndefined();
    expect(missingPlatformRoles.roles).toBeUndefined();
    expect([...emptyPlatformRoles.roles]).toEqual([]);
    expect(emptyPlatformUpdate as unknown).toEqual({});
    expect([...(clearedPlatformRoles.roles ?? [])]).toEqual([]);
    expect(missingPlatformRoleRevision.roles).toEqual(['administrator']);
    expect(missingCombinedRoleRevision.roles).toEqual(['administrator']);
    expect(hookRoleUpdate.roles).toEqual(['administrator']);
    expect(missingInvitationRoles.roles).toBeUndefined();
    expect([...emptyInvitationRoles.roles]).toEqual([]);
  });

  test('derives administration scope on the server and encodes only target IDs', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const transport = new AuthPlatformAdministrationTransport({
      baseUrl: 'https://zero.test',
      authenticatedFetch: async (url, init) => {
        calls.push({ url, init });
        if (url.includes('/tenants/customer%2Fone/members')) return Response.json(memberPage());
        if (url.includes('/members/member%2Fone')) return Response.json(memberMutation());
        return Response.json({ error: 'unexpected' }, { status: 500 });
      },
      createResponseError: (_response, _body, fallback) => new Error(fallback),
      assertResponseCurrent() {},
      expireSession() {},
    });

    await transport.listTenantMembers('customer/one', { search: 'ada', limit: 25 });
    await transport.updateMember('member/one', {
      roles: ['administrator'],
      expectedRoleRevision: 'tenant:1',
    });

    expect(calls[0]!.url).toBe(
      'https://zero.test/auth/platform/tenants/customer%2Fone/members?search=ada&limit=25',
    );
    expect(calls[0]!.url).not.toContain('administrationTenantId');
    expect(calls[1]!.url).toBe('https://zero.test/auth/platform/members/member%2Fone');
    expect(new Headers(calls[1]!.init?.headers).get('content-type')).toBe('application/json');
  });

  test('expires the local session only after a current self-invalidating receipt', async () => {
    const events: string[] = [];
    const transport = new AuthPlatformAdministrationTransport({
      baseUrl: 'https://zero.test',
      authenticatedFetch: async () => Response.json({
        ...memberMutation(), actorSessionInvalidated: true,
      }),
      createResponseError: (_response, _body, fallback) => new Error(fallback),
      assertResponseCurrent() { events.push('current'); },
      expireSession() { events.push('expire'); },
    });

    await transport.removeMember('member-1');
    expect(events).toEqual(['current', 'current', 'expire']);
  });

  test('targets customer membership routes without expiring the platform actor', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let expirations = 0;
    const transport = new AuthPlatformAdministrationTransport({
      baseUrl: 'https://zero.test',
      authenticatedFetch: async (url, init) => {
        calls.push({ url, init });
        return Response.json(url.endsWith('/ownership/transfer')
          ? customerOwnershipTransfer()
          : memberMutation());
      },
      createResponseError: (_response, _body, fallback) => new Error(fallback),
      assertResponseCurrent() {},
      expireSession() { expirations += 1; },
    });

    await transport.addTenantMember('customer/one', {
      email: 'ada@example.test', roles: ['member'],
    });
    await transport.updateTenantMember('customer/one', 'member/one', {
      roles: ['manager'], expectedRoleRevision: 'tenant:1',
    });
    await transport.removeTenantMember('customer/one', 'member/one');
    const transferred = await transport.transferTenantOwnership(
      'customer/one',
      'member/one',
    );

    expect(calls.map((call) => [call.init?.method, call.url])).toEqual([
      ['POST', 'https://zero.test/auth/platform/tenants/customer%2Fone/members'],
      ['PATCH', 'https://zero.test/auth/platform/tenants/customer%2Fone/members/member%2Fone'],
      ['DELETE', 'https://zero.test/auth/platform/tenants/customer%2Fone/members/member%2Fone'],
      ['POST', 'https://zero.test/auth/platform/tenants/customer%2Fone/ownership/transfer'],
    ]);
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({
      roles: ['manager'], expectedRoleRevision: 'tenant:1',
    });
    expect(transferred.actorSessionInvalidated).toBe(false);
    expect(expirations).toBe(0);
  });
});

describe('platform administration response boundary', () => {
  test('accepts and freezes every canonical response contract', () => {
    const config = parsePlatformAdministrationConfig(platformConfig());
    expect(config.administration.kind).toBe('administration');
    expect(config.capabilities.canManageRoles).toBe(true);
    expect(config.capabilities.canManageTenantMembers).toBe(true);
    expect(config.customerRoles[0]?.key).toBe('member');
    expect(Object.isFrozen(config)).toBe(true);
    expect(parsePlatformMemberPage(memberPage()).members).toHaveLength(1);
    expect(parsePlatformMemberMutation(memberMutation()).member.membershipId).toBe('member-1');
    expect(parsePlatformTenantMemberMutation(memberMutation()).actorSessionInvalidated)
      .toBe(false);
    expect(parsePlatformOwnershipTransfer(ownershipTransfer()).actorSessionInvalidated).toBe(true);
    expect(parsePlatformTenantOwnershipTransfer(customerOwnershipTransfer())
      .actorSessionInvalidated).toBe(false);
    expect(parsePlatformInvitationPage(invitationPage()).invitations).toHaveLength(1);
    expect(parsePlatformInvitationIssue({
      invitation: invitation(), delivery: { mode: 'manual' }, token: 'one-time-token',
    })).toMatchObject({ delivery: { mode: 'manual' }, token: 'one-time-token' });
    expect(parsePlatformInvitationIssue({
      invitation: invitation(), delivery: { mode: 'email', status: 'queued' },
    })).toMatchObject({ delivery: { mode: 'email', status: 'queued' } });
    expect(parsePlatformInvitationReceipt({ invitation: invitation() }).invitation.status)
      .toBe('pending');
    expect(parsePlatformTenantPage(tenantPage('archived')).tenants[0]!.status)
      .toBe('archived');
    expect(parsePlatformTenantCreate({ tenant: tenant(), owner: member() }).owner.roles)
      .toEqual(['owner']);
    expect(parsePlatformTenantUpdate({ tenant: tenant('suspended') }).tenant.status)
      .toBe('suspended');
  });

  test('rejects unknown fields, wrong kinds, invalid page invariants, and oversized arrays', () => {
    expectInvalid(() => parsePlatformAdministrationConfig({ ...platformConfig(), secret: 'no' }));
    expectInvalid(() => parsePlatformAdministrationConfig({
      ...platformConfig(),
      administration: { ...platformConfig().administration, tenantId: 'invalid:id' },
    }));
    expectInvalid(() => parsePlatformAdministrationConfig({
      ...platformConfig(),
      roles: [{ ...role(), permissions: ['Application.*'] }],
    }));
    expectInvalid(() => parsePlatformAdministrationConfig({
      ...platformConfig(),
      administration: { ...platformConfig().administration, kind: 'organization' },
    }));
    const { canManageRoles: _missingRoleCapability, ...missingRoleCapability } =
      platformConfig().capabilities;
    expectInvalid(() => parsePlatformAdministrationConfig({
      ...platformConfig(), capabilities: missingRoleCapability,
    }));
    expectInvalid(() => parsePlatformMemberPage({
      ...memberPage(), page: { ...memberPage().page, count: 0 },
    }));
    expectInvalid(() => parsePlatformMemberPage({
      ...memberPage(),
      page: { ...memberPage().page, hasMore: true, nextCursor: 'x'.repeat(513) },
    }));
    expectInvalid(() => parsePlatformMemberPage({
      members: Array.from({ length: 101 }, () => member()),
      page: { limit: 100, count: 100, hasMore: false, nextCursor: null },
    }));
    expectInvalid(() => parsePlatformMemberMutation({
      ...memberMutation(), actorSessionInvalidated: 'yes',
    }));
    expectInvalid(() => parsePlatformMemberMutation({
      ...memberMutation(), member: { ...member(), roles: ['invalid:role'] },
    }));
    expectInvalid(() => parsePlatformTenantMemberMutation({
      ...memberMutation(), actorSessionInvalidated: true,
    }));
    expectInvalid(() => parsePlatformOwnershipTransfer({
      ...ownershipTransfer(), actorSessionInvalidated: false,
    }));
    expectInvalid(() => parsePlatformTenantOwnershipTransfer(ownershipTransfer()));
    expectInvalid(() => parsePlatformInvitationPage({
      ...invitationPage(),
      invitations: [{ ...invitation(), email: 'not-an-email' }],
    }));
    expectInvalid(() => parsePlatformInvitationPage({
      ...invitationPage(),
      invitations: [{ ...invitation(), email: 'Grace@Example.Test' }],
    }));
    expectInvalid(() => parsePlatformInvitationIssue({
      invitation: invitation(), delivery: { mode: 'manual' }, token: 'token', extra: true,
    }));
    expectInvalid(() => parsePlatformInvitationReceipt({
      invitation: { ...invitation(), roles: ['member', 'member'] },
    }));
    expectInvalid(() => parsePlatformTenantPage({
      ...tenantPage(), tenants: [{ ...tenant(), kind: 'administration' }],
    }));
    expectInvalid(() => parsePlatformTenantPage({
      ...tenantPage(), tenants: [{ ...tenant(), activeMemberCount: 3, memberCount: 2 }],
    }));
    expectInvalid(() => parsePlatformTenantCreate({
      tenant: tenant(), owner: member(), unexpected: true,
    }));
    expectInvalid(() => parsePlatformTenantUpdate({
      tenant: { ...tenant(), status: 'deleted' },
    }));
  });
});

function expectInvalid(operation: () => unknown): void {
  expect(operation).toThrow('invalid platform-administration response');
}

function platformConfig() {
  return {
    authorization: 'advanced',
    administration: {
      tenantId: 'tenant-admin', kind: 'administration', slug: 'administration',
      name: 'Platform administration', membershipId: 'member-1',
    },
    capabilities: {
      canReadMembers: true, canManageMembers: true, canManageRoles: true,
      canReadInvitations: true, canManageInvitations: true,
      canReadTenants: true, canReadTenantMembers: true,
      canManageTenantMembers: true,
      canManageTenants: true, canCreateTenants: true, canTransferOwnership: true,
    },
    roles: [role()],
    customerRoles: [customerRole()],
  };
}

function role() {
  return {
    key: 'administrator', label: 'Administrator', description: 'Platform operator',
    administrationOnly: true, permissions: ['application.tenants:manage'],
    allPermissions: false, system: true, assignable: true, grantable: true,
  };
}

function customerRole() {
  return {
    key: 'member', label: 'Member', description: 'Customer member',
    administrationOnly: false, permissions: ['tenant:read'],
    allPermissions: false, system: false, assignable: true, grantable: true,
  };
}

function member() {
  return {
    membershipId: 'member-1',
    identity: {
      userId: 'user-1', username: 'ada', email: 'ada@example.test',
      firstName: 'Ada', lastName: 'Lovelace',
    },
    status: 'active', roles: ['owner'], roleRevision: 'tenant:1',
    joinedAt: 1, updatedAt: 2,
  };
}

function memberPage() {
  return {
    members: [member()],
    page: { limit: 25, count: 1, hasMore: false, nextCursor: null },
  };
}

function memberMutation() {
  return { member: member(), actorSessionInvalidated: false };
}

function ownershipTransfer() {
  return {
    owner: { ...member(), membershipId: 'member-2' },
    previousOwner: member(),
    actorSessionInvalidated: true,
  };
}

function customerOwnershipTransfer() {
  return {
    ...ownershipTransfer(),
    actorSessionInvalidated: false,
  };
}

function invitation() {
  return {
    invitationId: 'invitation-1', email: 'grace@example.test', roles: ['administrator'],
    status: 'pending', expiresAt: 50, createdAt: 1, updatedAt: 2,
    acceptedAt: null, revokedAt: null,
  };
}

function invitationPage() {
  return {
    invitations: [invitation()],
    page: { limit: 25, count: 1, hasMore: false, nextCursor: null },
  };
}

function tenant(status: 'active' | 'suspended' | 'archived' = 'active') {
  return {
    tenantId: 'tenant-customer', kind: 'organization', slug: 'customer',
    name: 'Customer', status, authorizationGeneration: 4,
    createdAt: 1, updatedAt: 2, suspendedAt: status === 'suspended' ? 2 : null,
    memberCount: 2, activeMemberCount: status === 'active' ? 2 : 0,
  };
}

function tenantPage(status: 'active' | 'suspended' | 'archived' = 'active') {
  return {
    tenants: [tenant(status)],
    page: { limit: 25, count: 1, hasMore: false, nextCursor: null },
  };
}
