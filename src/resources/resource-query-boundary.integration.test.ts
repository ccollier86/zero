import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import type { TokenService } from '../auth/token-service';
import type { AuthContext } from '../auth/types';
import { createDataQueryPlugin } from '../sync/data-query.plugin';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { defineResource, tenantRealm } from './resource-definition';
import { ownerPolicy } from './resource-policy-helpers';
import { ResourceRegistry } from './resource-registry';

const tables = {
  tenant_documents: {
    id: 'text primary key',
    tenant_id: 'text collate nocase not null',
    owner_id: 'text collate nocase not null',
    title: 'text not null',
  },
};

let db: ReactiveDB;

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory' });
  db.defineTable('tenant_documents', tables.tenant_documents);
});

afterEach(() => db.dispose());

describe('managed resource query authorization equality', () => {
  test('/api/data does not inherit NOCASE for tenant or owner constraints', async () => {
    const registry = new ResourceRegistry();
    registry.register(defineResource({
      table: 'tenant_documents',
      exposure: 'http',
      actions: ['list'],
      realm: tenantRealm(),
      policy: { list: ownerPolicy({ userField: 'owner_id' }) },
    }), {
      tables,
      authConfig: { userProperties: {} },
      tenancyMode: 'multi',
      managedTables: ['tenant_documents'],
    });

    db.insert('tenant_documents', {
      id: 'exact',
      tenant_id: 'tenant-a',
      owner_id: 'user-1',
      title: 'Visible',
    });
    db.insert('tenant_documents', {
      id: 'tenant-case-variant',
      tenant_id: 'TENANT-A',
      owner_id: 'user-1',
      title: 'Wrong tenant spelling',
    });
    db.insert('tenant_documents', {
      id: 'owner-case-variant',
      tenant_id: 'tenant-a',
      owner_id: 'USER-1',
      title: 'Wrong owner spelling',
    });

    const authContext = tenantAuth('tenant-a');
    const tokenService = {
      async resolveAuthContext(token: string) {
        return token === 'tenant-token' ? authContext : null;
      },
      captureAuthContextAuthority(current: AuthContext) {
        return { version: 1 as const, current };
      },
      resolveAuthContextAuthority(reference: { current: AuthContext }) {
        return reference.current;
      },
    } as unknown as TokenService;

    const app = new Elysia().use(createDataQueryPlugin({
      queryableTables: new Set(['tenant_documents']),
      tableColumns: new Map([
        ['tenant_documents', ['id', 'tenant_id', 'owner_id', 'title']],
      ]),
      getDB: () => db,
      getTokenService: () => tokenService,
      resourceRegistry: registry,
      resourceAuthConfig: { userProperties: {} },
      tenancyMode: 'multi',
      managedTables: new Set(['tenant_documents']),
    }));

    const response = await app.handle(new Request(
      'http://zero.test/api/data?table=tenant_documents&order=id&dir=asc',
      { headers: { authorization: 'Bearer tenant-token' } },
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rows: [{
        id: 'exact',
        tenant_id: 'tenant-a',
        owner_id: 'user-1',
        title: 'Visible',
      }],
    });
  });
});

function tenantAuth(tenantId: string): AuthContext {
  return {
    userId: 'user-1',
    email: 'user-1@example.test',
    role: 'user',
    sessionKind: 'web',
    sessionId: `session-${tenantId}`,
    sessionGeneration: 0,
    sessionScopeKind: 'tenant',
    sessionScopeId: tenantId,
    tenantId,
    membershipId: `membership-${tenantId}`,
    tenantRole: 'member',
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0,
  };
}
