/** Actual Jobs realm/service/runner and actual Torrent cryptography/runtime, all in memory.
 * Only physical Jobs transport, owner catalog and native source-owner callbacks are simulated.
 * No JobsRuntime.open(), file-presence probe, actor process or filesystem fixture is used.
 */
import { Database } from 'bun:sqlite';
import { resolveAuthBehaviorConfig } from '../../auth/auth-config';
import { createRequestAuthorizationAccess } from '../../auth/authorization-access';
import { createAuthorizationKernel } from '../../auth/authorization-kernel';
import { applicationServiceDataScope, serviceDataScopeKey, type ServiceDataScope } from '../../auth/service-data-scope';
import type { AuthContext, AuthContextAuthorityReference } from '../../auth/types';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../../databases/database-read-query-capability';
import { type DatabaseSerializableValue, cloneDatabaseSerializableValue } from '../../databases/database-operations';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../../databases/database-realm';
import { Migrator } from '../../migrations/migrator';
import { createReactiveDB, type ReactiveDB } from '../../sync/reactive-db';
import { flow, step } from '../../workflows/workflow-dsl';
import { WorkflowExecutionAuthorityStore, type WorkflowActorExecutionAuthority } from '../../workflows/workflow-execution-authority';
import { workflowDeferredStarts } from '../../workflows/workflow-deferred-start-bridge';
import { WorkflowRegistry } from '../../workflows/workflow-registry';
import { defineWorkflowTables } from '../../workflows/workflow-schema';
import { WorkflowService } from '../../workflows/workflow-service';
import { resolveJobsConfig } from '../config';
import { defineJob } from '../definition';
import { JobsError, readJobRejection } from '../error';
import { jobsRealm } from '../realm';
import type { JobsDueCursor, JobsRuntime } from '../runtime';
import { JobsService } from '../service';
import { createTrustedJobSource } from '../source-authority';
import type { JobSourceIdentity } from '../source-model';

export interface MemoryJobsOperation { readonly scope: ServiceDataScope; readonly name: string; readonly input: unknown }
interface MemoryPlane { readonly db: ReactiveDB; readonly scope: ServiceDataScope; wakeAt: number | null }
interface Options {
  readonly tenancy?: 'single' | 'multi';
  readonly beforeWrite?: (operation: MemoryJobsOperation) => void | Promise<void>;
  readonly afterWrite?: (operation: MemoryJobsOperation) => void | Promise<void>;
  readonly beforeRead?: (operation: MemoryJobsOperation) => void | Promise<void>;
  readonly activity?: (input: unknown) => void | Promise<void>;
}
export async function memorySourceJobsFixture(options: Options = {}) {
  const auth = resolveAuthBehaviorConfig({ tenancy: options.tenancy ?? 'single' }), kernel = createAuthorizationKernel(auth);
  const definition = defineJob({ name: 'synthetic.source', version: '1', origin: 'source', access: 'admin',
    workflow: { name: 'synthetic.source.workflow', version: 1 }, parseInput: input => input });
  const requestDefinition = defineJob({ name: 'synthetic.request', version: '1', access: 'admin',
    workflow: { name: 'synthetic.source.workflow', version: 1 }, parseInput: input => input });
  const config = resolveJobsConfig({ definitions: [definition, requestDefinition], concurrency: 4, maxActiveDatabases: 2 },
    '/synthetic-memory-source-jobs-never-created', auth, true);
  if (!config) throw new Error('Synthetic source Jobs configuration missing.');
  const torrentDb = createReactiveDB({ mode: 'memory' });
  const planes = new Map<string, MemoryPlane>(), lifetime = new AbortController(), sourceLifetimes = new Set<AbortController>();
  const calls: unknown[] = [], commands: MemoryJobsOperation[] = [], failures: string[] = [];
  let now = Date.parse('2026-12-01T00:00:00.000Z'), activeLeases = 0, backendLeases = 0, ownerChecks = 0, eligibleChecks = 0;
  let closed = false, discovery = false, retainOnClose = false, service: JobsService | undefined, workflows: WorkflowService | undefined;
  const context: AuthContext = { userId: 'synthetic-admin', email: 'synthetic-admin@example.test', role: 'admin', credentialKind: 'session',
    authGeneration: 0, sessionKind: 'web', sessionId: 'synthetic-session', sessionGeneration: 0, sessionScopeKind: 'application', sessionScopeId: 'application' };
  try {
    torrentDb.getRawDatabase().run('PRAGMA temp_store=MEMORY'); defineWorkflowTables(torrentDb);
    const registry = new WorkflowRegistry();
    registry.registerActivity({ name: 'synthetic.source.activity', version: '1', databaseCallable: true,
      handler: async activity => { if (activeLeases || backendLeases) throw new Error('Source/Jobs SQL lease escaped into Torrent activity.');
        calls.push(cloneDatabaseSerializableValue(activity.input)); await options.activity?.(activity.input); return activity.input; } });
    registry.create({ name: 'synthetic.source.workflow', version: 1, flow: flow(step('execute', { name: 'synthetic.source.activity', version: '1' })) });
    const store = new WorkflowExecutionAuthorityStore(torrentDb, () => now);
    const actor = (): WorkflowActorExecutionAuthority => ({ version: 1, kind: 'actor',
      reference: { version: 1, userId: context.userId, platformRole: 'admin', authGeneration: 0, sessionKind: 'web', sessionId: context.sessionId!,
        sessionGeneration: 0, mfaVerifiedAt: null, clientId: null, identityScopes: [], sessionScopeKind: 'application', sessionScopeId: 'application',
        tenantId: null, membershipId: null, tenantKind: null, tenantRole: null, tenantAuthorizationGeneration: null,
        membershipAuthorizationGeneration: null, authorizationAssignmentRevision: null } as AuthContextAuthorityReference,
      identity: { kind: 'actor', userId: context.userId, platformRole: 'admin', scopeKind: 'application', scopeId: 'application', tenantId: null,
        membershipId: null, roles: ['admin'], permissions: [], allPermissions: true, authorizationRevision: 'synthetic-admin:1', sessionKind: 'web', clientId: null },
      propertiesMac: store.propertyMac({}) });
    workflows = new WorkflowService(torrentDb, registry, { clock: { now: () => new Date(now) }, wakeTimer: false, shutdownGraceMs: 0,
      tenancyMode: options.tenancy ?? 'single', authorityStore: store, authorityProvider: { captureActor: () => actor(),
        revalidateActor: authority => ({ persisted: authority, identity: authority.identity, scope: applicationServiceDataScope(), authContext: context, userProperties: {} }) } });
    const bridge = workflowDeferredStarts(workflows);
    const unwrap = <T>(value: unknown): T => {
      const envelope = value as { ok: boolean; value: T; code?: ConstructorParameters<typeof JobsError>[0] };
      if (!envelope?.ok) throw new JobsError(envelope?.code ?? 'JOBS_STATE_INVALID'); return envelope.value;
    };
    const query = <T>(plane: MemoryPlane, name: string, input: unknown): T => {
      const copy = Database.deserialize(plane.db.getRawDatabase().serialize(), { readonly: true, strict: true }); activeLeases++;
      try { copy.run('PRAGMA temp_store=MEMORY'); return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context =>
        unwrap<T>(runDatabaseRealmQuery(jobsRealm, context, name, input as DatabaseSerializableValue))); }
      finally { copy.close(true); activeLeases--; }
    };
    const command = <T>(plane: MemoryPlane, name: string, input: unknown): T => {
      activeLeases++;
      try { return unwrap<T>(runDatabaseRealmCommand(jobsRealm, plane.db, name, input as DatabaseSerializableValue)); }
      catch (error) { throw readJobRejection(error) ?? error; }
      finally { activeLeases--; }
    };
    const allocate = (scope: ServiceDataScope): MemoryPlane => {
      const key = serviceDataScopeKey(scope), existing = planes.get(key); if (existing) return existing;
      const db = createReactiveDB({ mode: 'memory' });
      try {
        const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA foreign_keys=ON');
        const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations: jobsRealm.migrations, createBackups: false, applyPragmas: false, log() {} });
        try { migrator.run(); } finally { migrator.dispose(); }
        for (const [name, schema] of Object.entries(jobsRealm.tables)) db.defineTable(name, schema);
        const plane = { db, scope, wakeAt: null }; command(plane, 'jobs.owner.bind', { scopeId: key, ownerId: 'synthetic-jobs-owner-' + key });
        planes.set(key, plane); return plane;
      } catch (error) { db.dispose(); throw error; }
    };
    const read = async <T>(scope: ServiceDataScope, name: string, input: unknown, guard: () => void, signal?: AbortSignal, existingOnly = false): Promise<T | null> => {
      guard(); signal?.throwIfAborted(); await options.beforeRead?.({ scope, name, input }); guard(); signal?.throwIfAborted();
      const plane = existingOnly ? planes.get(serviceDataScopeKey(scope)) : allocate(scope); if (!plane) return null;
      const value = query<T>(plane, name, input); guard(); return value;
    };
    const write = async <T>(scope: ServiceDataScope, name: string, input: unknown, _transportId: string, guard: () => void, signal?: AbortSignal, existingOnly = false): Promise<T> => {
      guard(); signal?.throwIfAborted(); const operation = { scope, name, input }; await options.beforeWrite?.(operation); guard(); signal?.throwIfAborted();
      const plane = existingOnly ? planes.get(serviceDataScopeKey(scope)) : allocate(scope); if (!plane) throw new JobsError('JOBS_NOT_READY');
      plane.wakeAt = 0; const value = command<T>(plane, name, input); commands.push(operation);
      // Fault injection occurs AFTER the actual realm transaction and its SQL lease close.
      try { await options.afterWrite?.(operation); guard(); signal?.throwIfAborted(); }
      catch { throw new JobsError('JOBS_OUTCOME_UNKNOWN'); }
      return value;
    };
    const runtime = {
      read: <T>(scope: ServiceDataScope, name: string, input: unknown, guard: () => void, signal?: AbortSignal) => read<T>(scope, name, input, guard, signal),
      readExisting: <T>(scope: ServiceDataScope, name: string, input: unknown, guard: () => void, signal?: AbortSignal) => read<T>(scope, name, input, guard, signal, true),
      write: <T>(scope: ServiceDataScope, name: string, input: unknown, id: string, guard: () => void, signal?: AbortSignal) => write<T>(scope, name, input, id, guard, signal),
      writeExisting: <T>(scope: ServiceDataScope, name: string, input: unknown, id: string, guard: () => void, signal?: AbortSignal) => write<T>(scope, name, input, id, guard, signal, true),
      dueScopePage(horizon: number, limit: number, after?: JobsDueCursor) {
        return discovery ? [...planes].filter(([, plane]) => plane.wakeAt !== null && plane.wakeAt <= horizon)
          .map(([id, plane]) => ({ scope: plane.scope, cursor: { wakeAt: plane.wakeAt!, id } }))
          .filter(entry => !after || entry.cursor.wakeAt > after.wakeAt || entry.cursor.wakeAt === after.wakeAt && entry.cursor.id > after.id)
          .sort((a, b) => a.cursor.wakeAt - b.cursor.wakeAt || a.cursor.id.localeCompare(b.cursor.id)).slice(0, limit) : [];
      },
      async refreshWake(scope: ServiceDataScope, time: number, guard: () => void) { guard(); const plane = planes.get(serviceDataScopeKey(scope));
        if (plane) plane.wakeAt = query<number | null>(plane, 'jobs.wake', { scopeId: serviceDataScopeKey(scope), now: time }); },
      async deferWake(scope: ServiceDataScope, at: number, guard: () => void) { guard(); const plane = planes.get(serviceDataScopeKey(scope)); if (plane) plane.wakeAt = at; },
      diagnostics: () => ({ syntheticMemoryOnly: true, activeLeases, planes: planes.size, closed }),
      subscribe() { return () => {}; },
      async close() { closed = true; if (!retainOnClose) { for (const plane of planes.values()) plane.db.dispose(); planes.clear(); } },
    } as unknown as JobsRuntime;
    service = new JobsService({ runtime, bridge, config, now: () => now, onFailure: (stage, code) => failures.push(stage + ':' + code) });
    const source = (settings: { identity?: Partial<JobSourceIdentity>; scope?: ServiceDataScope; policyVersion?: string; semanticsVersion?: string;
      confirmEligible?: () => void | Promise<void> } = {}) => {
      const scope = settings.scope ?? applicationServiceDataScope(), controller = new AbortController(); sourceLifetimes.add(controller);
      const identity: JobSourceIdentity = { domain: 'synthetic', databaseId: 'synthetic-calendar', ownerId: 'synthetic-owner', rootHash: 'a'.repeat(64),
        scopeId: serviceDataScopeKey(scope), ...settings.identity };
      let ownerCurrent = true, eligible = true, ownBackendLeases = 0;
      const assertOwnerCurrent = () => { if (activeLeases || ownBackendLeases) throw new Error('A physical SQL lease escaped into a source ownership callback.');
        ownerChecks++; if (!ownerCurrent || closed) throw new JobsError('JOBS_AUTHORITY_RETIRED'); };
      const assertEligible = () => { eligibleChecks++; if (!eligible) throw new JobsError('JOBS_AUTHORITY_RETIRED'); };
      const capability = createTrustedJobSource({ identity, scope, realmFingerprint: jobsRealm.fingerprint, definition,
        policyVersion: settings.policyVersion ?? 'A', semanticsVersion: settings.semanticsVersion ?? '1', signal: controller.signal,
        assertOwnerCurrent, async confirmOwnerCurrent() { assertOwnerCurrent(); backendLeases++; ownBackendLeases++;
          try { await Promise.resolve(); } finally { backendLeases--; ownBackendLeases--; } },
        assertEligible, async confirmEligible() { backendLeases++; ownBackendLeases++; try { await Promise.resolve(); } finally { backendLeases--; ownBackendLeases--; }
          await settings.confirmEligible?.(); assertEligible(); } });
      return { identity, scope, capability, api: service!.forSource(capability), revokeOwner() { ownerCurrent = false; }, retireEligibility() { eligible = false; },
        abort() { controller.abort(new JobsError('JOBS_AUTHORITY_RETIRED')); } };
    };
    return { get service() { return service!; }, runtime, workflows, bridge, config, definition, requestDefinition, torrentDb, calls, commands, failures, source,
      now: () => now, advance(milliseconds: number) { now += milliseconds; },
      enableDiscovery() { discovery = true; }, disableDiscovery() { discovery = false; },
      async tick() { discovery = true; await service!.tick(); await untilMemoryJobs(() => !service!.diagnostics().runner.activeScopes && !service!.diagnostics().runner.ticking); },
      async restartService() {
        // The durable planes intentionally remain live in this physical-transport
        // simulation; every broker, gate and runner is nevertheless truly closed.
        discovery = false; retainOnClose = true;
        try { await service!.close(); } finally { retainOnClose = false; }
        closed = false; service = new JobsService({ runtime, bridge, config, now: () => now, onFailure: (stage, code) => failures.push(stage + ':' + code) });
      },
      rows(scope: ServiceDataScope, table: string) { return planes.get(serviceDataScopeKey(scope))?.db.list(table) ?? []; },
      plane(scope: ServiceDataScope) { return planes.get(serviceDataScopeKey(scope))?.db; },
      query: <T>(scope: ServiceDataScope, name: string, input: unknown) => read<T>(scope, name, input, () => {}, undefined, true),
      stats: () => ({ planes: planes.size, activeLeases, backendLeases, ownerChecks, eligibleChecks }),
      request() { const access = createRequestAuthorizationAccess({ kernel, authContext: context }); return service!.forAuthority({ access, scope: applicationServiceDataScope(),
        assertCurrentAuthoritySync() { if (closed) throw new JobsError('JOBS_NOT_READY'); }, async assertCurrentAuthority() { if (closed) throw new JobsError('JOBS_NOT_READY'); } }); },
      async close() { discovery = false; lifetime.abort(); for (const controller of sourceLifetimes) controller.abort();
        try { await service!.close(); } finally { try { await workflows!.dispose(); } finally { for (const plane of planes.values()) plane.db.dispose(); planes.clear(); torrentDb.dispose(); } } },
    };
  } catch (error) { lifetime.abort(); for (const controller of sourceLifetimes) controller.abort();
    try { await service?.close(); }
    finally { try { await workflows?.dispose(); } finally { for (const plane of planes.values()) plane.db.dispose(); planes.clear(); torrentDb.dispose(); } }
    throw error;
  }
}
export async function untilMemoryJobs(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!check()) { if (performance.now() > deadline) throw new Error('Memory Jobs condition did not settle.'); await Bun.sleep(1); }
}
