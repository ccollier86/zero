import { afterEach, describe, expect, test } from 'bun:test';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { resolveAuthAuditConfig } from './auth-audit-config';
import { AuthAuditService } from './auth-audit-service';
import {
  createAuthorizationManifest,
  InstalledAuthorizationManifestGuard,
  readInstalledAuthorizationManifest,
  reconcileAuthorizationManifest,
} from './auth-authorization-manifest';
import {
  installAuthAuthorityRevision,
  readAuthAuthorityRevision,
} from './auth-authority-revision';
import { resolveAuthBehaviorConfig } from './auth-config';
import { defineAuthTables } from './auth-schema';

const databases: ReactiveDB[] = [];

afterEach(() => {
  for (const db of databases.splice(0).reverse()) db.dispose();
});

describe('installed authorization registry manifest', () => {
  test('hashes authority semantics but ignores display-only metadata', () => {
    const first = authorization({
      registryVersion: 1,
      permissions: {
        'records:read': { label: 'Read', description: 'First copy' },
      },
      roles: {
        clinician: { label: 'Clinician', permissions: ['records:read'] },
      },
    });
    const relabeled = authorization({
      registryVersion: 1,
      permissions: {
        'records:read': { label: 'View records', description: 'Second copy' },
      },
      roles: {
        clinician: { label: 'Care team', permissions: ['records:read'] },
      },
    });
    const expanded = authorization({
      registryVersion: 2,
      permissions: {
        'records:read': {},
        'records:write': {},
      },
      roles: {
        clinician: { permissions: ['records:read', 'records:write'] },
      },
    });

    expect(createAuthorizationManifest(first, 'single').fingerprint)
      .toBe(createAuthorizationManifest(relabeled, 'single').fingerprint);
    expect(createAuthorizationManifest(expanded, 'single').fingerprint)
      .not.toBe(createAuthorizationManifest(first, 'single').fingerprint);
  });

  test('persists, audits, and authority-fences an explicitly versioned update', () => {
    const db = createDb();
    const audit = new AuthAuditService(db, resolveAuthAuditConfig(undefined));
    const firstConfig = authorization({
      registryVersion: 3,
      permissions: { 'records:read': {} },
      roles: { clinician: { permissions: ['records:read'] } },
    });
    const beforeRevision = readAuthAuthorityRevision(db)!;
    const first = db.transaction(() => reconcileAuthorizationManifest({
      db,
      authorization: firstConfig,
      tenancy: 'single',
      audit,
    }));
    expect(first).toMatchObject({
      kind: 'initialized',
      previous: null,
      committed: { registryVersion: 3 },
    });
    expect(readAuthAuthorityRevision(db)).toBe(beforeRevision + 1);
    const original = new InstalledAuthorizationManifestGuard(db, first.committed);

    const restarted = db.transaction(() => reconcileAuthorizationManifest({
      db,
      authorization: firstConfig,
      tenancy: 'single',
      audit,
    }));
    expect(restarted.kind).toBe('unchanged');
    expect(readAuthAuthorityRevision(db)).toBe(beforeRevision + 1);
    expect(original.isCurrent()).toBe(true);

    const updated = db.transaction(() => reconcileAuthorizationManifest({
      db,
      authorization: authorization({
        registryVersion: 4,
        permissions: {
          'records:read': {},
          'records:write': {},
        },
        roles: {
          clinician: { permissions: ['records:read', 'records:write'] },
        },
      }),
      tenancy: 'single',
      audit,
    }));
    expect(updated).toMatchObject({
      kind: 'updated',
      previous: { registryVersion: 3 },
      committed: { registryVersion: 4 },
    });
    expect(original.isCurrent()).toBe(false);
    expect(() => original.assertCurrent()).toThrow(expect.objectContaining({
      code: 'AUTH_PROFILE_CHANGED',
      status: 503,
    }));

    expect(audit.listPlatform({
      action: 'application.authorization-registry-updated',
    }).events).toEqual([expect.objectContaining({
      actorProvenance: 'system',
      targetType: 'authorization-registry',
      metadata: expect.objectContaining({
        'from-version': 3,
        'to-version': 4,
      }),
    })]);
  });

  test('rejects semantic drift at the same version and version rollback', () => {
    const db = createDb();
    const initial = authorization({
      registryVersion: 2,
      permissions: { 'records:read': {} },
      roles: { clinician: { permissions: ['records:read'] } },
    });
    db.transaction(() => reconcileAuthorizationManifest({
      db, authorization: initial, tenancy: 'single',
    }));
    const marker = readInstalledAuthorizationManifest(db);
    const revision = readAuthAuthorityRevision(db);

    expect(() => db.transaction(() => reconcileAuthorizationManifest({
      db,
      authorization: authorization({
        registryVersion: 2,
        permissions: {
          'records:read': {},
          'records:write': {},
        },
        roles: { clinician: { permissions: ['records:read', 'records:write'] } },
      }),
      tenancy: 'single',
    }))).toThrow(expect.objectContaining({
      code: 'AUTHORIZATION_REGISTRY_VERSION_REQUIRED',
      status: 503,
    }));
    expect(() => db.transaction(() => reconcileAuthorizationManifest({
      db,
      authorization: authorization({
        registryVersion: 1,
        permissions: { 'records:read': {} },
        roles: { clinician: { permissions: ['records:read'] } },
      }),
      tenancy: 'single',
    }))).toThrow('older than installed version 2');
    expect(readInstalledAuthorizationManifest(db)).toEqual(marker);
    expect(readAuthAuthorityRevision(db)).toBe(revision);
  });

  test('profile acknowledgement permits only a profile-axis change', () => {
    const db = createDb();
    const registry = authorization({
      registryVersion: 1,
      permissions: { 'records:read': {} },
      roles: { clinician: { permissions: ['records:read'] } },
    });
    db.transaction(() => reconcileAuthorizationManifest({
      db,
      authorization: registry,
      tenancy: 'single',
    }));
    const updated = db.transaction(() => reconcileAuthorizationManifest({
      db,
      authorization: registry,
      tenancy: 'multi',
      allowProfileAxisChange: true,
    }));
    expect(updated).toMatchObject({ kind: 'updated', committed: { registryVersion: 1 } });
  });

  test('profile acknowledgement cannot hide same-version registry drift', () => {
    const db = createDb();
    db.transaction(() => reconcileAuthorizationManifest({
      db,
      authorization: authorization({
        registryVersion: 1,
        permissions: { 'records:read': {} },
        roles: { clinician: { permissions: ['records:read'] } },
      }),
      tenancy: 'single',
    }));

    expect(() => db.transaction(() => reconcileAuthorizationManifest({
      db,
      authorization: authorization({
        registryVersion: 1,
        permissions: { 'records:write': {} },
        roles: { clinician: { permissions: ['records:write'] } },
      }),
      tenancy: 'multi',
      allowProfileAxisChange: true,
    }))).toThrow(expect.objectContaining({
      code: 'AUTHORIZATION_REGISTRY_VERSION_REQUIRED',
      status: 503,
    }));
  });

  test('never silently reactivates a retired role key with retained subjects', () => {
    const db = createDb();
    const initial = resolveAuthBehaviorConfig({
      tenancy: 'single',
      authorization: {
        mode: 'simple',
        registryVersion: 1,
        permissions: { 'records:read': {} },
        roles: { reader: { permissions: ['records:read'] } },
      },
    }).authorization;
    db.transaction(() => reconcileAuthorizationManifest({
      db, authorization: initial, tenancy: 'single',
    }));
    db.prepare(`
      INSERT INTO users (
        user_id, username, email, role, status, password_change_required,
        email_verification_required, mfa_required, created_at
      ) VALUES ('retained-user', 'retained-user', 'retained@example.test',
        'retired-clinician', 'active', 0, 0, 0, ?)
    `).run(Date.now());

    const reintroduced = resolveAuthBehaviorConfig({
      tenancy: 'single',
      authorization: {
        mode: 'simple',
        registryVersion: 2,
        permissions: { 'records:read': {} },
        roles: {
          reader: { permissions: ['records:read'] },
          'retired-clinician': { permissions: ['records:read'] },
        },
      },
    }).authorization;
    expect(() => db.transaction(() => reconcileAuthorizationManifest({
      db,
      authorization: reintroduced,
      tenancy: 'single',
      allowProfileAxisChange: true,
    }))).toThrow(expect.objectContaining({
      code: 'AUTHORIZATION_ROLE_REACTIVATION_BLOCKED',
      status: 503,
    }));
    expect(readInstalledAuthorizationManifest(db)).toMatchObject({ registryVersion: 1 });

    db.prepare("UPDATE users SET role = 'user' WHERE user_id = 'retained-user'").run();
    expect(db.transaction(() => reconcileAuthorizationManifest({
      db, authorization: reintroduced, tenancy: 'single',
    }))).toMatchObject({ kind: 'updated', committed: { registryVersion: 2 } });
  });

  test('checks retained assignments from the installed profile before adoption', () => {
    const db = createDb();
    db.exec(`
      CREATE TABLE _auth_tenant_memberships (
        membership_id TEXT PRIMARY KEY,
        role_key TEXT,
        status TEXT NOT NULL
      )
    `);
    const initial = resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: {
        mode: 'simple',
        registryVersion: 1,
        permissions: { 'records:read': {} },
        roles: { reader: { permissions: ['records:read'] } },
      },
    }).authorization;
    db.transaction(() => reconcileAuthorizationManifest({
      db, authorization: initial, tenancy: 'multi',
    }));
    db.prepare(`
      INSERT INTO _auth_tenant_memberships (membership_id, role_key, status)
      VALUES ('retained-membership', 'retired-clinician', 'active')
    `).run();

    const reintroduced = resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: {
        mode: 'advanced',
        registryVersion: 2,
        permissions: { 'records:read': {} },
        roles: {
          reader: { permissions: ['records:read'] },
          'retired-clinician': { permissions: ['records:read'] },
        },
      },
    }).authorization;
    expect(() => db.transaction(() => reconcileAuthorizationManifest({
      db,
      authorization: reintroduced,
      tenancy: 'multi',
      allowProfileAxisChange: true,
    }))).toThrow(expect.objectContaining({
      code: 'AUTHORIZATION_ROLE_REACTIVATION_BLOCKED',
      status: 503,
    }));
  });
});

function createDb(): ReactiveDB {
  const db = createReactiveDB({ mode: 'memory' });
  databases.push(db);
  defineAuthTables(db);
  installAuthAuthorityRevision(db);
  return db;
}

function authorization(input: {
  registryVersion: number;
  permissions: Record<string, {
    label?: string;
    description?: string;
    scope?: 'application' | 'tenant';
  }>;
  roles: Record<string, {
    label?: string;
    permissions: readonly string[];
  }>;
}) {
  return resolveAuthBehaviorConfig({
    tenancy: 'single',
    authorization: {
      mode: 'advanced',
      registryVersion: input.registryVersion,
      permissions: input.permissions,
      roles: input.roles,
    },
  }).authorization;
}
