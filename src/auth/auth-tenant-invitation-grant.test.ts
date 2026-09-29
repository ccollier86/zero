import { expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from './auth-config';
import { AuthorizationKernel } from './authorization-kernel';
import {
  createInvitationGrantSnapshot,
  invitationGrantRemainsWithinSnapshot,
} from './auth-tenant-invitation-grant';

test('organization all-permission invitations ignore dormant application scope drift', () => {
  const issuedKernel = kernel(false);
  const issued = createInvitationGrantSnapshot({
    kernel: issuedKernel,
    tenantKind: 'organization',
    roleKeys: ['observer'],
  });
  const snapshot = JSON.parse(issued.json) as {
    tenantPermissions: string[];
    applicationPermissions: string[];
  };
  expect(snapshot.tenantPermissions).toContain('records:read');
  expect(snapshot.applicationPermissions).toEqual([]);

  expect(invitationGrantRemainsWithinSnapshot({
    kernel: kernel(true),
    tenantKind: 'organization',
    roleKeys: ['observer'],
    snapshotJson: issued.json,
    snapshotFingerprint: issued.fingerprint,
  })).toBe(true);
});

test('administration invitations continue to fence application permission expansion', () => {
  const issued = createInvitationGrantSnapshot({
    kernel: kernel(false),
    tenantKind: 'administration',
    roleKeys: ['report-operator'],
  });
  expect(invitationGrantRemainsWithinSnapshot({
    kernel: kernel(true),
    tenantKind: 'administration',
    roleKeys: ['report-operator'],
    snapshotJson: issued.json,
    snapshotFingerprint: issued.fingerprint,
  })).toBe(false);
});

function kernel(expanded: boolean): AuthorizationKernel {
  return new AuthorizationKernel(resolveAuthBehaviorConfig({
    tenancy: 'multi',
    authorization: {
      mode: 'advanced',
      permissions: {
        'records:read': { scope: 'tenant' },
        'application.reports:read': { scope: 'application' },
        ...(expanded
          ? { 'application.reports:export': { scope: 'application' as const } }
          : {}),
      },
      roles: {
        observer: { allPermissions: true },
        'report-operator': {
          permissions: [
            'application.reports:read',
            ...(expanded ? ['application.reports:export'] : []),
          ],
        },
      },
    },
  }));
}
