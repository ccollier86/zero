import { afterEach, describe, expect, test } from 'bun:test';

import { createPlatformSQLiteService } from '../../persistence';
import type { PlatformSQLiteService } from '../../persistence';
import { ReactiveDB } from '../../sync/reactive-db';
import { createTenantDatabaseEligibility } from './tenant-database-eligibility';

describe('tenant database eligibility', () => {
  const services: PlatformSQLiteService[] = [];

  afterEach(() => {
    for (const sqlite of services.splice(0)) sqlite.close();
  });

  test('admits only active tenant purposes declared by physical resources', () => {
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    const db = new ReactiveDB({ sqlite });
    services.push(sqlite);
    db.prepare(`
      CREATE TABLE _auth_tenants (
        tenant_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL
      )
    `).run();
    db.prepare(`
      INSERT INTO _auth_tenants (tenant_id, kind, status)
      VALUES ('organization-active', 'organization', 'active'),
             ('administration-active', 'administration', 'active'),
             ('organization-suspended', 'organization', 'suspended')
    `).run();

    const eligibility = createTenantDatabaseEligibility(db, ['organization']);
    expect(eligibility.assertEligible('organization-active')).toBeUndefined();
    for (const tenantId of [
      'administration-active',
      'organization-suspended',
      'missing',
    ]) {
      expect(() => eligibility.assertEligible(tenantId)).toThrow(
        expect.objectContaining({
          code: 'DATABASE_AUTHORITY_CHANGED',
          retryable: false,
          outcome: 'not-started',
        }),
      );
    }
  });
});
