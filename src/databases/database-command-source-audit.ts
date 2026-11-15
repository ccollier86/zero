/** Framework-private source audit bridge. No raw database, actor, scope, sink or asynchronous capability escapes a command. */
import type { LoggingEventInput } from '../logging/logging-contracts';
import type { ReactiveDB } from '../sync/reactive-db';
import type { DatabaseWriteCommandContext } from './database-write-command-capability';
import { DatabaseError } from './database-error';

export type DatabaseCommandSourceAuditEvent = Omit<LoggingEventInput, 'family' | 'evidence' | 'detail' | 'level'> & {
  readonly family: 'workflow';
};
type Append = (event: DatabaseCommandSourceAuditEvent) => void;
const sources = new WeakMap<ReactiveDB, Append | null>();
const commands = new WeakMap<DatabaseWriteCommandContext, Append>();

/** @internal The actor source alone owns registration and its identity-safe retirement. */
export function registerDatabaseCommandSourceAudit(database: ReactiveDB, append: Append): () => void {
  if (typeof append !== 'function' || sources.get(database)) throw new DatabaseError('DATABASE_CONFIG_INVALID', 'Database command audit is already installed or invalid.');
  sources.set(database, append);
  return () => { if (sources.get(database) === append) sources.set(database, null); };
}

/** @internal Bind only the revocable command lifetime; retaining the context never retains write authority. */
export function bindDatabaseCommandSourceAudit(context: DatabaseWriteCommandContext, database: ReactiveDB, assertActive: () => void): () => void {
  const append: Append = event => {
    assertActive();
    if (!sources.has(database)) return; // Optional logging creates no source/schema when disabled.
    const source = sources.get(database);
    if (!source) throw new DatabaseError('DATABASE_CLOSED', 'Database command audit source is closed.', { outcome: 'not-started' });
    if (!database.getRawDatabase().inTransaction) throw new DatabaseError('DATABASE_OPERATION_UNSUPPORTED', 'Command audit requires its source transaction.', { outcome: 'not-started' });
    const result: unknown = source(event);
    if (result !== undefined) {
      // An async function is assignable to () => void. Never let a yielded
      // capture grant commit authority or inspect an authored then getter.
      try { Promise.prototype.then.call(result, undefined, () => {}); } catch {}
      throw new DatabaseError('DATABASE_CONFIG_INVALID', 'Database command audit must finish synchronously.', { outcome: 'not-committed' });
    }
  };
  commands.set(context, append);
  return () => { if (commands.get(context) === append) commands.delete(context); };
}

/** @internal Code-owned semantic facts only; source attribution and confirmation are supplied by the actor source. */
export function appendDatabaseCommandSourceAudit(context: DatabaseWriteCommandContext, event: DatabaseCommandSourceAuditEvent): void {
  const append = commands.get(context);
  if (!append) throw new DatabaseError('DATABASE_CLOSED', 'Database command audit capability is closed.', { outcome: 'not-started' });
  append(event);
}
