/** Real Guardian -> CalendarService -> CalendarRuntime -> native ReactiveDB/realm integration.
 * Only the physical coordinator, process transport and file-presence probe are explicitly simulated.
 * Never call CalendarRuntime.open(), create a fixture directory, launch an actor or open file-backed SQLite here.
 */
import { Database } from 'bun:sqlite';
import { resolveAuthBehaviorConfig } from '../../auth/auth-config';
import { authContextAuthorityFingerprint } from '../../auth/auth-context-authority';
import { createRequestAuthorizationAccess } from '../../auth/authorization-access';
import { createAuthorizationKernel } from '../../auth/authorization-kernel';
import { requireRequestServiceDataScope, serviceDataScopeKey, type ServiceDataScope } from '../../auth/service-data-scope';
import { AuthError, type AuthContext } from '../../auth/types';
import { AuthorityCommitCoordinator } from '../../databases/authority-commit-coordinator';
import { assertDatabaseCommitAuthorityCurrent, type DatabaseCommitAuthority } from '../../databases/database-commit-authority';
import type { DatabaseCoordinator } from '../../databases/database-coordinator';
import { notifyDatabaseCoordinatorCommit, observeDatabaseCoordinatorCommits } from '../../databases/database-coordinator-commit-notifications';
import { DatabaseError } from '../../databases/database-error';
import { createDatabaseRef } from '../../databases/database-file';
import type { DatabaseCommitResult, DatabaseOperation, DatabaseOperationExecutionOptions, DatabaseReadResult } from '../../databases/database-operations';
import { cloneDatabaseSerializableValue } from '../../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../../databases/database-realm';
import { createReactiveDB, type ReactiveDB } from '../../sync/reactive-db';
import type { CalendarAuthority } from '../authority';
import { resolveCalendarConfig, type CalendarConfig } from '../config';
import type { ScopedCalendar } from '../contracts';
import { installCalendarOwnerSchema } from '../owner-schema';
import { resolveCalendarPersistenceConfig } from '../persistence-config';
import { calendarRealm } from '../realm';
import { calendarDatabaseId, CalendarRuntime, type CalendarRuntimeOptions } from '../runtime';
import { CalendarService } from '../service';
import { calendarHash } from '../validation';
import type { CalendarParticipantDirectory } from '../participants-directory';

interface MemoryPlane {
  readonly db: ReactiveDB;
  readonly transport: Map<string, { readonly fingerprint: string; readonly result: DatabaseCommitResult }>;
}
export interface MemoryCalendarSession {
  readonly api: ScopedCalendar;
  readonly authority: CalendarAuthority;
  readonly scope: ServiceDataScope;
  readonly userId: string;
  revoke(): void;
  replaceScope(tenantId: string): void;
}

export function memoryCalendarServiceFixture(options: { tenancy?: 'single' | 'multi'; config?: CalendarConfig;
  participantDirectory?: CalendarParticipantDirectory; beforeDispatch?: (operation: DatabaseOperation) => void;
  afterCommand?: (operation: DatabaseOperation) => void } = {}) {
  const tenancy = options.tenancy ?? 'multi', project = '/synthetic-memory-calendar-service-never-created';
  const auth = resolveAuthBehaviorConfig({ tenancy }), kernel = createAuthorizationKernel(auth);
  const config = resolveCalendarConfig({ timezone: 'UTC', ...options.config }, project, auth);
  if (config === false) throw new Error('Synthetic calendar configuration missing.');
  const system = createReactiveDB({ mode: 'memory' }), authorityCoordinator = new AuthorityCommitCoordinator();
  const lifetime = new AbortController(), planes = new Map<string, MemoryPlane>();
  const queryCounts = new Map<string, number>();
  let acquisitions = 0, releases = 0, activeLeases = 0, closed = false;
  let runtime: CalendarRuntime | undefined, service: CalendarService | undefined, removeCommit: (() => void) | undefined;
  const disposePlanes = () => { for (const { db } of planes.values()) db.dispose(); planes.clear(); };
  try {
    system.getRawDatabase().run('PRAGMA temp_store=MEMORY');
    installCalendarOwnerSchema(system, true);
    const allocate = (id: string): MemoryPlane => {
      const db = createReactiveDB({ mode: 'memory' });
      try {
        db.getRawDatabase().run('PRAGMA temp_store=MEMORY');
        for (const [name, schema] of Object.entries(calendarRealm.tables)) db.defineTable(name, schema);
        for (const migration of calendarRealm.migrations) migration.up(db.getRawDatabase());
        const plane = { db, transport: new Map<string, { fingerprint: string; result: DatabaseCommitResult }>() };
        planes.set(id, plane); return plane;
      } catch (error) { db.dispose(); throw error; }
    };
    const lease = (id: string, plane: MemoryPlane, commitAuthority: DatabaseCommitAuthority) => {
      acquisitions++; activeLeases++;
      let released = false;
      return {
        async execute(operation: DatabaseOperation, operationOptions?: DatabaseOperationExecutionOptions): Promise<DatabaseReadResult | DatabaseCommitResult> {
          if (released) throw new Error('Synthetic physical lease is closed.');
          operationOptions?.signal?.throwIfAborted();
          options.beforeDispatch?.(operation);
          // Production strong reads do not carry writer commit authority. Only
          // commands exercise the real opaque final writer admission boundary.
          if (operation.type === 'command') assertDatabaseCommitAuthorityCurrent(commitAuthority, authorityCoordinator, createDatabaseRef(id));
          const db = plane.db;
          if (operation.type === 'get') return { value: cloneDatabaseSerializableValue(db.get(operation.table, operation.id)), sequence: { seq: db.currentSeq } };
          if (operation.type === 'query') {
            queryCounts.set(operation.name, (queryCounts.get(operation.name) ?? 0) + 1);
            const copy = Database.deserialize(db.getRawDatabase().serialize(), { readonly: true, strict: true });
            try {
              copy.run('PRAGMA temp_store=MEMORY');
              const value = withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context =>
                runDatabaseRealmQuery(calendarRealm, context, operation.name, operation.input));
              return { value, sequence: { seq: db.currentSeq } };
            } finally { copy.close(); }
          }
          if (operation.type !== 'command') throw new Error('Unsupported synthetic physical operation.');
          const fingerprint = calendarHash([operation.name, operation.input]), prior = plane.transport.get(operation.idempotencyKey);
          if (prior) {
            if (prior.fingerprint !== fingerprint) throw new DatabaseError('DATABASE_CONFLICT', 'Synthetic transport identity conflict.',
              { outcome: 'not-committed', details: { conflictType: 'idempotency-key-reused' } });
            return { ...prior.result, replayed: true };
          }
          const before = db.currentSeq, output = runDatabaseRealmCommand(calendarRealm, db, operation.name, operation.input);
          options.afterCommand?.(operation);
          const result: DatabaseCommitResult = { value: { kind: 'command', name: operation.name, output },
            sequence: { seq: db.currentSeq }, replayed: false, idempotencyKey: operation.idempotencyKey };
          plane.transport.set(operation.idempotencyKey, { fingerprint, result });
          // Native commit notifications are reproduced only after the REAL realm transaction accepted a change.
          // Internal owner binding is not a domain hint; exact transport replay never executes/notifies again.
          if (db.currentSeq !== before && operation.name !== 'calendar.owner.bind') notifyDatabaseCoordinatorCommit(owner, createDatabaseRef(id));
          return result;
        },
        release() { if (released) return; released = true; activeLeases--; releases++; },
      };
    };
    const owner = {
      async acquire(id: string, input: { commitAuthority: DatabaseCommitAuthority }) { return lease(id, planes.get(id) ?? allocate(id), input.commitAuthority); },
      async acquireExisting(id: string, input: { commitAuthority: DatabaseCommitAuthority }) {
        const plane = planes.get(id); return plane ? lease(id, plane, input.commitAuthority) : null;
      },
      diagnostics: () => ({ state: closed ? 'closed' : 'started', syntheticMemoryOnly: true }),
      async close() { closed = true; disposePlanes(); },
    };
    const runtimeOptions: CalendarRuntimeOptions = { config, persistence: resolveCalendarPersistenceConfig(config, project), system,
      installAllowed: true, authority: { coordinator: authorityCoordinator, actorContext: null } };
    const Constructor = CalendarRuntime as unknown as new (config: CalendarRuntimeOptions, owner: DatabaseCoordinator) => CalendarRuntime;
    runtime = new Constructor(runtimeOptions, owner as unknown as DatabaseCoordinator);
    const internal = runtime as unknown as { filePresent(id: string): boolean; queueHint(ref: string): void; listeners: Map<string, Set<() => void>> };
    internal.filePresent = id => planes.has(id);
    removeCommit = observeDatabaseCoordinatorCommits(owner, ref => internal.queueHint(ref));
    service = new CalendarService(runtime, config, lifetime.signal, options.participantDirectory);
    const session = (userId: string, sessionOptions: { tenantId?: string; manager?: boolean; context?: Partial<AuthContext> } = {}): MemoryCalendarSession => {
      const tenantId = sessionOptions.tenantId ?? 'tenant-a';
      let live: AuthContext | null = { userId, email: userId + '@synthetic.example.test', role: sessionOptions.manager ? 'admin' : 'user',
        credentialKind: 'session', sessionKind: 'web', sessionId: 'session-' + userId, sessionGeneration: 1, authGeneration: 1,
        ...(tenancy === 'single' ? { sessionScopeKind: 'application' as const, sessionScopeId: 'application' }
          : { sessionScopeKind: 'tenant' as const, sessionScopeId: tenantId, tenantId, membershipId: 'membership-' + userId + '-' + tenantId,
            tenantKind: 'organization' as const, tenantRole: sessionOptions.manager ? 'owner' as const : 'member' as const,
            tenantAuthorizationGeneration: 1, membershipAuthorizationGeneration: 1 }),
        ...sessionOptions.context };
      const captured = authContextAuthorityFingerprint(live);
      const assertCurrentAuthoritySync = () => {
        if (live === null || authContextAuthorityFingerprint(live) !== captured) throw new AuthError('Synthetic authority retired.', 'AUTH_STATE_CHANGED', 409);
      };
      const access = () => createRequestAuthorizationAccess({ kernel, authContext: live, assertCurrentProfile: assertCurrentAuthoritySync });
      const scope = requireRequestServiceDataScope(access(), () => kernel);
      const request: CalendarAuthority = { get access() { return access(); }, scope, assertCurrentAuthoritySync,
        async assertCurrentAuthority() { assertCurrentAuthoritySync(); } };
      return { api: service!.forAuthority(request), authority: request, scope, userId,
        revoke() { live = null; },
        replaceScope(nextTenant) { if (!live) throw new Error('Synthetic session already retired.'); live = { ...live,
          tenantId: nextTenant, sessionScopeKind: 'tenant', sessionScopeId: nextTenant, membershipId: 'replacement-membership' }; },
      };
    };
    return { config, runtime, service, system, session,
      sourceRows(scope: ServiceDataScope, table: string) { return planes.get(calendarDatabaseId(serviceDataScopeKey(scope)))?.db.list(table) ?? []; },
      sourceSequence(scope: ServiceDataScope) { return planes.get(calendarDatabaseId(serviceDataScopeKey(scope)))?.db.currentSeq ?? 0; },
      stats: () => ({ planes: planes.size, ownerRows: (system.prepare('SELECT count(*) AS count FROM _calendar_owners').get() as { count: number }).count,
        acquisitions, releases, activeLeases, appointmentQueries: queryCounts.get('calendar.appointments') ?? 0,
        subscriptions: [...internal.listeners.values()].reduce((total, listeners) => total + listeners.size, 0) }),
      async close() {
        lifetime.abort();
        try { await service!.close(); }
        finally {
          try { await runtime!.close(); }
          finally { removeCommit?.(); disposePlanes(); system.dispose(); await authorityCoordinator.drain(); }
        }
      },
    };
  } catch (error) { lifetime.abort(); removeCommit?.(); disposePlanes(); system.dispose(); void authorityCoordinator.drain(); throw error; }
}

/** Bounded polling uses only completed short waits; no pending timer remains when this helper settles. */
export async function eventuallyCalendar(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!check()) {
    if (performance.now() >= deadline) throw new Error('Synthetic calendar integration condition timed out.');
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
}
