/** Framework-private managed audit bindings. No request facade can install a policy or choose an actor source. */
import type { LoggingContext, LoggingScope } from '../logging/logging-contracts';
import { normalizeLoggingActorSourceBinding, type LoggingActorSourceBinding } from '../logging/logging-actor-source';
import { DatabaseError } from './database-error';
import { normalizeDatabaseId, type DatabaseId } from './database-file';
import type { LoggingSourceLimits } from '../logging/logging-source-limits';
import type { LoggingResourcePolicies } from '../logging/logging-activity-contracts';

interface Owner {
  admitting: boolean;
  readonly records: boolean;
  readonly policyVersion: string;
  readonly sourceQueue: LoggingSourceLimits;
  readonly resources?: LoggingResourcePolicies;
  readonly context: () => LoggingContext | null;
  readonly sources: Map<DatabaseId, LoggingActorSourceBinding>;
}
const owners = new WeakMap<object, Owner>();

/** Install once before the managed coordinator starts admitting source bindings. */
export function installDatabaseLoggingBinding(coordinator: object, options: Omit<Owner, 'sources' | 'admitting'>): () => void {
  if (owners.has(coordinator)) throw new DatabaseError('DATABASE_CONFIG_INVALID', 'Database logging is already installed.');
  const owner = { ...options, admitting: true, sources: new Map<DatabaseId, LoggingActorSourceBinding>() };
  owners.set(coordinator, owner);
  return () => { if (owners.get(coordinator) === owner) owners.delete(coordinator); };
}

/** Shutdown preserves existing recovery bindings but never admits an uncataloged file. */
export function sealDatabaseLoggingBinding(coordinator: object): void { const owner = owners.get(coordinator); if (owner) owner.admitting = false; }

/** Scope comes only from the manager's named/tenant routing, not from a database operation body. */
export function prepareDatabaseLoggingBinding(coordinator: object, id: string, scope: LoggingScope): void {
  const owner = owners.get(coordinator); if (!owner) return;
  const key = normalizeDatabaseId(id), binding = normalizeLoggingActorSourceBinding({ records: owner.records, policyVersion: owner.policyVersion, sourceQueue: owner.sourceQueue, resources: owner.resources, scope });
  const prior = owner.sources.get(key);
  if (!prior && !owner.admitting) throw new DatabaseError('DATABASE_CLOSED', 'Database audit source admission is closed.', { outcome: 'not-started' });
  if (prior && (prior.scope.kind !== scope.kind || prior.scope.tenantId !== scope.tenantId)) {
    throw new DatabaseError('DATABASE_AUTHORITY_CHANGED', 'Database logging scope changed.', { outcome: 'not-started' });
  }
  owner.sources.set(key, binding);
}

/** An installed audit owner cannot silently fall through an unregistered raw source binding. */
export function databaseLoggingBinding(coordinator: object, id: DatabaseId): LoggingActorSourceBinding | undefined {
  const owner = owners.get(coordinator); if (!owner) return undefined;
  const binding = owner.sources.get(id);
  if (!binding) throw new DatabaseError('DATABASE_NOT_READY', 'Managed database audit binding is unavailable.', { outcome: 'not-started' });
  return binding;
}

export function databaseLoggingContext(coordinator: object): LoggingContext | undefined { return owners.get(coordinator)?.context() ?? undefined; }
