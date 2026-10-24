/** Synthetic in-memory actor fixture for public workflow integration tests. No real accounts or databases. */
import { applicationServiceDataScope, trustedSystemServiceDataScope } from '../auth/service-data-scope';
import type { AuthContext, AuthContextAuthorityReference } from '../auth/types';
import { createReactiveDB } from '../sync/reactive-db';
import { WorkflowExecutionAuthorityStore, type WorkflowActorExecutionAuthority, type WorkflowExecutionAuthorityProvider } from './workflow-execution-authority';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { WorkflowService } from './workflow-service';

export function workflowContractFixture(tenantId: string | null = null, admin = true) {
  const db = createReactiveDB({ mode: 'memory', emitTelemetry: false });
  defineWorkflowTables(db);
  const registry = new WorkflowRegistry(), store = new WorkflowExecutionAuthorityStore(db);
  const context: AuthContext = { userId: 'actor-one', email: 'actor@example.test', role: admin ? 'admin' : 'user', authGeneration: 0,
    sessionKind: 'web', sessionId: 'session-one', sessionGeneration: 0, sessionScopeKind: tenantId ? 'tenant' : 'application',
    sessionScopeId: tenantId ?? 'application', ...(tenantId ? { tenantId, membershipId: `membership:${tenantId}` } : {}) };
  let live = true;
  const provider: WorkflowExecutionAuthorityProvider = {
    captureActor(actor) {
      if (!live) return null;
      const tenant = actor.tenantId ?? null;
      const reference: AuthContextAuthorityReference = { version: 1, userId: actor.userId, platformRole: actor.role,
        authGeneration: 0, sessionKind: 'web', sessionId: actor.sessionId!, mfaVerifiedAt: null, sessionGeneration: 0,
        clientId: null, identityScopes: [], sessionScopeKind: tenant ? 'tenant' : 'application', sessionScopeId: tenant ?? 'application',
        tenantId: tenant, membershipId: tenant ? `membership:${tenant}` : null, tenantKind: tenant ? 'organization' : null,
        tenantRole: tenant ? (admin ? 'owner' : 'member') : null, tenantAuthorizationGeneration: tenant ? 0 : null,
        membershipAuthorizationGeneration: tenant ? 0 : null, authorizationAssignmentRevision: null };
      return { version: 1, kind: 'actor', reference, identity: { kind: 'actor', userId: actor.userId, platformRole: actor.role,
        scopeKind: tenant ? 'tenant' : 'application', scopeId: tenant ?? 'application', tenantId: tenant,
        membershipId: tenant ? `membership:${tenant}` : null, roles: admin ? ['owner'] : ['member'], permissions: [],
        allPermissions: admin, authorizationRevision: 'fixture-one', sessionKind: 'web', clientId: null }, propertiesMac: store.propertyMac({}) };
    },
    revalidateActor(authority: WorkflowActorExecutionAuthority) {
      return live ? { persisted: authority, identity: authority.identity,
        scope: authority.identity.tenantId ? trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: authority.identity.tenantId }) : applicationServiceDataScope(),
        authContext: { ...context, userId: authority.identity.userId }, userProperties: {} } : null;
    },
  };
  const createService = () => new WorkflowService(db, registry, { authorityStore: store, authorityProvider: provider,
    tenancyMode: tenantId ? 'multi' : 'single' });
  let service = createService();
  return { db, registry, get service() { return service; }, context, revoke: () => { live = false; },
    restart: async () => { await service.dispose(); service = createService(); await service.recoverInFlight(); },
    close: async () => { await service.dispose(); db.dispose(); } };
}
