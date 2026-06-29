/**
 * resource-policy.test.ts
 *
 * Verifies resource policy construction, validation, and evaluation without
 * Elysia route mounting. These tests keep the authorization core independent
 * from later CRUD, data-query, sync, and registry integrations.
 */

import { describe, expect, test } from 'bun:test';

import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import type { ResourcePolicyContext, ResourcePolicyUser } from './resource-policy';
import {
  adminOnly,
  allOf,
  anyOf,
  authenticatedOnly,
  customPolicy,
  evaluateResourcePolicy,
  metadataPolicy,
  ownerPolicy,
  publicReadUserWrite,
  readOnly,
  validateResourcePolicy,
} from './resource-policy';

const authConfig = resolveAuthBehaviorConfig({
  userProperties: {
    department: {
      type: 'enum',
      values: ['support', 'management', 'sales'],
      editableBy: 'admin',
      useInPolicies: true,
    },
    betaTester: {
      type: 'boolean',
      editableBy: 'system',
      useInPolicies: true,
    },
    theme: {
      type: 'enum',
      values: ['light', 'dark'],
      editableBy: 'user',
    },
  },
});

const resource = {
  table: 'tickets',
  primaryKey: 'ticket_id',
};

const user: ResourcePolicyUser = {
  userId: 'u_1',
  email: 'user@test.local',
  role: 'user',
  properties: {
    department: 'support',
    betaTester: 'true',
    theme: 'dark',
  },
};

const admin: ResourcePolicyUser = {
  userId: 'u_admin',
  email: 'admin@test.local',
  role: 'admin',
  properties: {
    department: 'management',
  },
};

describe('resource policy core', () => {
  test('evaluates admin, authenticated, read-only, and public-read-user-write presets', async () => {
    await expectAllowed(adminOnly(), context({ user: admin }));
    await expectDenied(adminOnly(), context({ user }), 'forbidden', 403);
    await expectDenied(adminOnly(), context({ user: null }), 'unauthorized', 401);

    await expectAllowed(authenticatedOnly(), context({ user }));
    await expectDenied(authenticatedOnly(), context({ user: null }), 'unauthorized', 401);

    await expectAllowed(readOnly(), context({ action: 'get', user: null }));
    await expectDenied(readOnly(), context({ action: 'create', user }), 'read-only', 403);

    await expectAllowed(publicReadUserWrite(), context({ action: 'list', user: null }));
    await expectAllowed(publicReadUserWrite(), context({ action: 'update', user }));
    await expectDenied(publicReadUserWrite(), context({ action: 'delete', user: null }), 'unauthorized', 401);
  });

  test('owner policy returns constraints, evaluates rows, and handles create modes', async () => {
    const policy = ownerPolicy({ userField: 'owner_id' });

    const list = await evaluateResourcePolicy(policy, context({ action: 'list', user }));
    expect(list).toMatchObject({
      allowed: true,
      constraints: [{
        type: 'field',
        field: 'owner_id',
        operator: 'eq',
        value: 'u_1',
      }],
    });

    await expectAllowed(policy, context({ action: 'get', user, row: { owner_id: 'u_1' } }));
    await expectDenied(
      policy,
      context({ action: 'update', user, row: { owner_id: 'u_2' } }),
      'owner-mismatch',
      403
    );
    await expectDenied(policy, context({ action: 'delete', user }), 'owner-row-required', 403);

    const stamped = await evaluateResourcePolicy(
      policy,
      context({ action: 'create', user, input: { title: 'Ticket', owner_id: 'malicious' } })
    );
    expect(stamped).toMatchObject({
      allowed: true,
      stampedInput: {
        title: 'Ticket',
        owner_id: 'u_1',
      },
    });

    await expectAllowed(
      ownerPolicy({ userField: 'owner_id', create: 'require' }),
      context({ action: 'create', user, input: { owner_id: 'u_1' } })
    );
    await expectDenied(
      ownerPolicy({ userField: 'owner_id', create: 'require' }),
      context({ action: 'create', user, input: { owner_id: 'u_2' } }),
      'owner-input-mismatch',
      403
    );
    await expectDenied(
      ownerPolicy({ userField: 'owner_id', create: 'forbid' }),
      context({ action: 'create', user, input: { title: 'Ticket' } }),
      'create-forbidden',
      403
    );
  });

  test('metadata policy validates trusted user properties and matches values', async () => {
    const policy = metadataPolicy({
      department: ['support', 'management'],
      betaTester: true,
    });

    expect(validateResourcePolicy(policy, { authConfig }).length).toBe(0);
    await expectAllowed(policy, context({ user }));

    await expectDenied(
      policy,
      context({
        user: {
          ...user,
          properties: { department: 'sales', betaTester: 'true' },
        },
      }),
      'metadata-property',
      403
    );

    const unknownIssues = validateResourcePolicy(metadataPolicy({ missing: 'value' }), { authConfig });
    expect(unknownIssues).toMatchObject([{
      code: 'metadata-property-unknown',
      path: 'metadata.missing',
    }]);

    const untrustedPolicy = metadataPolicy({ theme: 'dark' });
    expect(validateResourcePolicy(untrustedPolicy, { authConfig })).toMatchObject([{
      code: 'metadata-property-untrusted',
      path: 'metadata.theme',
    }]);
    await expectDenied(untrustedPolicy, context({ user }), 'policy-invalid', 500);
  });

  test('anyOf composes admin overrides and constrained owner branches', async () => {
    const policy = anyOf(ownerPolicy({ userField: 'owner_id' }), adminOnly());

    const adminList = await evaluateResourcePolicy(policy, context({ action: 'list', user: admin }));
    expect(adminList).toMatchObject({ allowed: true });
    expect(adminList.constraints).toBeUndefined();

    const userList = await evaluateResourcePolicy(policy, context({ action: 'list', user }));
    expect(userList).toMatchObject({
      allowed: true,
      constraints: [{
        type: 'field',
        field: 'owner_id',
        value: 'u_1',
      }],
    });

    await expectDenied(
      policy,
      context({ action: 'get', user, row: { owner_id: 'u_2' } }),
      'owner-mismatch',
      403
    );
  });

  test('allOf requires every branch and merges constraints and stamped input', async () => {
    const policy = allOf(
      authenticatedOnly(),
      metadataPolicy({ department: 'support' }),
      ownerPolicy({ userField: 'owner_id' })
    );

    const list = await evaluateResourcePolicy(policy, context({ action: 'list', user }));
    expect(list).toMatchObject({
      allowed: true,
      constraints: [{
        type: 'field',
        field: 'owner_id',
        value: 'u_1',
      }],
    });

    const create = await evaluateResourcePolicy(
      policy,
      context({ action: 'create', user, input: { title: 'Ticket' } })
    );
    expect(create).toMatchObject({
      allowed: true,
      stampedInput: {
        title: 'Ticket',
        owner_id: 'u_1',
      },
    });

    await expectDenied(
      policy,
      context({
        action: 'list',
        user: {
          ...user,
          properties: { department: 'sales' },
        },
      }),
      'metadata-property',
      403
    );
  });

  test('custom policy normalizes returns and fails closed on errors', async () => {
    await expectAllowed(
      customPolicy(() => ({ allowed: true, metadata: { source: 'test' } })),
      context({ user })
    );

    await expectDenied(customPolicy(() => false), context({ user }), 'forbidden', 403);
    await expectDenied(
      customPolicy(() => {
        throw new Error('boom');
      }, { name: 'throws' }),
      context({ user }),
      'policy-error',
      500
    );
  });

  test('validation catches invalid owner and empty composite policies', () => {
    expect(validateResourcePolicy(ownerPolicy({ userField: '' }), { authConfig })).toMatchObject([{
      code: 'owner-field-invalid',
      path: 'owner.userField',
    }]);

    expect(validateResourcePolicy(anyOf(), { authConfig })).toMatchObject([{
      code: 'composite-policy-empty',
      path: 'anyOf',
    }]);

    expect(validateResourcePolicy(allOf(), { authConfig })).toMatchObject([{
      code: 'composite-policy-empty',
      path: 'allOf',
    }]);
  });
});

function context(overrides: Partial<ResourcePolicyContext> = {}): ResourcePolicyContext {
  return {
    action: 'get',
    user,
    resource,
    authConfig,
    ...overrides,
  };
}

async function expectAllowed(policy: Parameters<typeof evaluateResourcePolicy>[0], ctx: ResourcePolicyContext) {
  const decision = await evaluateResourcePolicy(policy, ctx);
  expect(decision.allowed).toBe(true);
}

async function expectDenied(
  policy: Parameters<typeof evaluateResourcePolicy>[0],
  ctx: ResourcePolicyContext,
  reason: string,
  status: number
) {
  const decision = await evaluateResourcePolicy(policy, ctx);
  expect(decision).toMatchObject({
    allowed: false,
    reason,
    status,
  });
}
