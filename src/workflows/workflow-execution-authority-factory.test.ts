import { describe, expect, test } from 'bun:test';

import { applicationServiceDataScope } from '../auth/service-data-scope';
import {
  createSystemAuthority,
  sameExecutionIdentity,
  scopeFromIdentity,
} from './workflow-execution-authority-factory';
import type { WorkflowExecutionIdentity } from './workflow-execution-authority-types';

describe('workflow execution authority factories', () => {
  test('compares canonical actor identity fields independent of array order', () => {
    const left = actorIdentity({
      roles: ['reviewer', 'operator'],
      permissions: ['workflow.write', 'workflow.read'],
    });
    const right = actorIdentity({
      credentialKind: 'session',
      credentialId: null,
      roles: ['operator', 'reviewer'],
      permissions: ['workflow.read', 'workflow.write'],
    });

    expect(sameExecutionIdentity(left, right)).toBeTrue();
    expect(sameExecutionIdentity(left, {
      ...right,
      authorizationRevision: 'revision-2',
    })).toBeFalse();
  });

  test('uses stable workflow errors for invalid system authority configuration', () => {
    expect(() => createSystemAuthority({
      principal: '   ',
      reason: 'scheduled recovery',
      scope: applicationServiceDataScope(),
    })).toThrow(expect.objectContaining({
      code: 'WORKFLOW_CONFIG_INVALID',
      status: 500,
    }));
  });

  test('fails closed on a contradictory tenant identity', () => {
    const identity: WorkflowExecutionIdentity = {
      kind: 'system',
      principal: 'scheduler',
      reason: 'scheduled recovery',
      scopeKind: 'tenant',
      scopeId: 'tenant-alpha',
      tenantId: 'tenant-beta',
      roles: [],
      permissions: [],
      allPermissions: true,
      legacyCompatibility: false,
    };

    expect(() => scopeFromIdentity(identity)).toThrow(
      expect.objectContaining({
        code: 'WORKFLOW_STATE_INVALID',
        status: 500,
      }),
    );
  });
});

function actorIdentity(
  overrides: {
    credentialKind?: 'session';
    credentialId?: null;
    roles?: readonly string[];
    permissions?: readonly string[];
    authorizationRevision?: string;
  } = {},
): Extract<WorkflowExecutionIdentity, { kind: 'actor' }> {
  return {
    kind: 'actor',
    userId: 'user-1',
    platformRole: 'user',
    sessionKind: 'web',
    clientId: null,
    scopeKind: 'tenant',
    scopeId: 'tenant-1',
    tenantId: 'tenant-1',
    membershipId: 'membership-1',
    roles: ['operator'],
    permissions: ['workflow.read'],
    allPermissions: false,
    authorizationRevision: 'revision-1',
    ...overrides,
  };
}
