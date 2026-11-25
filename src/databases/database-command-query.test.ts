/** Native MEMORY evidence only. No files, dependencies, actors or fixtures are retained. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { DatabaseError } from './database-error';
import { defineDatabaseRealm, runDatabaseRealmCommand, type DatabaseReadQueryHandler } from './database-realm';
import type { DatabaseReadQueryContext, DatabaseReadQueryStatement } from './database-read-query-capability';
import { createDatabaseWriteCommandSession, type DatabaseWriteCommandContext, type DatabaseWriteCommandQuery } from './database-write-command-capability';

const tables = { notes: { id: 'TEXT PRIMARY KEY', body: 'TEXT NOT NULL', current: 'INTEGER NOT NULL' } };
function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  db.defineTable('notes', tables.notes);
  return db;
}
function code(run: () => unknown, expected: DatabaseError['code']) {
  try { run(); throw new Error('Expected command-query refusal'); }
  catch (error) { expect(error).toBeInstanceOf(DatabaseError); expect((error as DatabaseError).code).toBe(expected); }
}

test('command registered queries see their own writes, select current rows before LIMIT, and restore writer access', () => {
  const db = fixture();
  const realm = defineDatabaseRealm({ name: 'command-query-current-state', version: '1', tables,
    queries: { selected: ({ database }) => database.query('SELECT id,body FROM notes WHERE current=1 ORDER BY id LIMIT 1').all() as never },
    commands: { create: context => {
      expect(Object.getPrototypeOf(context)).toBeNull(); expect(Object.isFrozen(context)).toBe(true);
      expect('database' in context).toBe(false); expect('getRawDatabase' in context).toBe(false);
      context.db.createStrict('notes', { id: 'a-retired', body: 'retired', current: 0 });
      context.db.createStrict('notes', { id: 'b-current', body: 'current', current: 1 });
      const selected = context.query('selected', null);
      expect(Object.isFrozen(selected)).toBe(true);
      context.db.createStrict('notes', { id: 'c-after-query', body: 'after', current: 1 });
      return selected;
    } } });
  try {
    expect(runDatabaseRealmCommand(realm, db, 'create', null)).toEqual([{ id: 'b-current', body: 'current' }]);
    expect(db.currentSeq).toBe(3);
    expect(db.getRawDatabase().query('PRAGMA query_only').get()).toEqual({ query_only: 0 });
  } finally { db.dispose(); }
});

test('query sessions and command query dispatch are revoked before later command work and post-commit callbacks', () => {
  const db = fixture();
  let retainedQuery: DatabaseWriteCommandQuery | undefined;
  let retainedContext: DatabaseReadQueryContext | undefined;
  let retainedStatement: DatabaseReadQueryStatement | undefined;
  let retainedIterator: IterableIterator<unknown> | undefined;
  let postCommit = false;
  const realm = defineDatabaseRealm({ name: 'command-query-lifetimes', version: '1', tables,
    queries: { inspect: context => {
      retainedContext = context;
      retainedStatement = context.database.query('SELECT id FROM notes');
      retainedIterator = retainedStatement.iterate();
      return retainedStatement.all() as never;
    } }, commands: { create: context => {
      retainedQuery = context.query;
      context.db.createStrict('notes', { id: 'one', body: 'one', current: 1 });
      const result = context.query('inspect', null);
      code(() => retainedContext!.database.query('SELECT 1'), 'DATABASE_CLOSED');
      code(() => retainedStatement!.all(), 'DATABASE_CLOSED');
      code(() => retainedIterator!.next(), 'DATABASE_CLOSED');
      context.db.afterCommit(() => { postCommit = true; code(() => retainedQuery!('inspect', null), 'DATABASE_CLOSED'); });
      return result;
    } } });
  try {
    expect(runDatabaseRealmCommand(realm, db, 'create', null)).toEqual([{ id: 'one' }]);
    expect(postCommit).toBe(true);
    code(() => retainedQuery!('inspect', null), 'DATABASE_CLOSED');
    code(() => retainedStatement!.get(), 'DATABASE_CLOSED');
  } finally { db.dispose(); }
});

test('unknown queries, mutating SQL, thrown queries and asynchronous results roll back all command writes', () => {
  const db = fixture();
  let retainedContext: DatabaseReadQueryContext | undefined;
  const asyncResult = ((context: DatabaseReadQueryContext) => {
    retainedContext = context;
    return Promise.resolve(null);
  }) as unknown as DatabaseReadQueryHandler;
  const realm = defineDatabaseRealm({ name: 'command-query-rollback', version: '1', tables,
    queries: {
      mutate: context => context.database.query('DELETE FROM notes').all() as never,
      cteMutate: context => context.database.query('WITH n AS (SELECT 1) UPDATE notes SET body=\'changed\'').all() as never,
      throws: () => { throw new Error('Synthetic query refusal'); },
      asyncResult,
    }, commands: { create: (context, input: { name: string }) => {
      context.db.createStrict('notes', { id: 'rolled-back', body: 'never committed', current: 1 });
      return context.query(input.name, null);
    } } });
  try {
    for (const name of ['missing', 'mutate', 'cteMutate', 'throws', 'asyncResult']) {
      expect(() => runDatabaseRealmCommand(realm, db, 'create', { name })).toThrow();
      expect(db.get('notes', 'rolled-back')).toBeNull(); expect(db.currentSeq).toBe(0);
      expect(db.getRawDatabase().query('PRAGMA query_only').get()).toEqual({ query_only: 0 });
    }
    code(() => retainedContext!.database.query('SELECT 1'), 'DATABASE_CLOSED');
  } finally { db.dispose(); }
});

test('an asynchronous query continuation finds both its read session and enclosing command revoked', async () => {
  const db = fixture();
  let continuation: Promise<null> | undefined;
  let command: DatabaseWriteCommandContext | undefined;
  const asyncResult = ((context: DatabaseReadQueryContext) => {
    continuation = Promise.resolve().then(() => {
      code(() => context.database.query('SELECT id FROM notes').all(), 'DATABASE_CLOSED');
      code(() => command!.query('asyncResult', null), 'DATABASE_CLOSED');
      code(() => command!.db.createStrict('notes', { id: 'async-escape', body: 'forbidden', current: 1 }), 'DATABASE_CLOSED');
      return null;
    });
    return continuation;
  }) as unknown as DatabaseReadQueryHandler;
  const realm = defineDatabaseRealm({ name: 'command-query-async-lifetime', version: '1', tables,
    queries: { asyncResult }, commands: { create: context => {
      command = context;
      context.db.createStrict('notes', { id: 'before', body: 'before', current: 1 });
      return context.query('asyncResult', null);
    } } });
  try {
    code(() => runDatabaseRealmCommand(realm, db, 'create', null), 'DATABASE_OPERATION_UNSUPPORTED');
    await continuation;
    expect(db.list('notes')).toEqual([]); expect(db.currentSeq).toBe(0);
  } finally { db.dispose(); }
});

test('nested registered reads retain query_only and throwing reads restore the writer guard', () => {
  const db = fixture();
  let command: DatabaseWriteCommandContext | undefined;
  const guarded = () => expect(db.getRawDatabase().query('PRAGMA query_only').get()).toEqual({ query_only: 1 });
  const realm = defineDatabaseRealm({ name: 'command-query-nested-readonly', version: '1', tables,
    queries: {
      inner: ({ database }) => { guarded(); return database.query('SELECT id FROM notes').all() as never; },
      outer: () => {
        guarded(); const value = command!.query('inner', null); guarded();
        return value;
      },
      throws: () => { throw new Error('Synthetic nested refusal'); },
    }, commands: { create: context => {
      command = context;
      context.db.createStrict('notes', { id: 'before', body: 'before', current: 1 });
      const value = context.query('outer', null);
      expect(() => context.query('throws', null)).toThrow();
      context.db.createStrict('notes', { id: 'after', body: 'after', current: 1 });
      return value;
    } } });
  try {
    expect(runDatabaseRealmCommand(realm, db, 'create', null)).toEqual([{ id: 'before' }]);
    expect(db.get('notes', 'after')).not.toBeNull();
    expect(db.getRawDatabase().query('PRAGMA query_only').get()).toEqual({ query_only: 0 });
  } finally { db.dispose(); }
});

test('a captured command capability cannot mutate during a registered read, even when its error is caught', () => {
  const db = fixture();
  let command: DatabaseWriteCommandContext | undefined;
  const realm = defineDatabaseRealm({ name: 'command-query-captured-mutation', version: '1', tables,
    queries: { mutation: () => {
      expect(() => command!.db.createStrict('notes', { id: 'read-escape', body: 'forbidden', current: 1 })).toThrow();
      return null;
    } }, commands: { create: context => {
      command = context;
      context.db.createStrict('notes', { id: 'before', body: 'before', current: 1 });
      context.query('mutation', null);
      context.db.createStrict('notes', { id: 'after', body: 'after', current: 1 });
      return null;
    } } });
  try {
    expect(() => runDatabaseRealmCommand(realm, db, 'create', null)).toThrow();
    expect(db.list('notes')).toEqual([]); expect(db.currentSeq).toBe(0);
    expect(db.getRawDatabase().query('PRAGMA query_only').get()).toEqual({ query_only: 0 });
  } finally { db.dispose(); }
});

test('standalone command sessions cannot invent registered query dispatch and revoke it after close', () => {
  const db = fixture(); const session = createDatabaseWriteCommandSession(db);
  try {
    code(() => session.context.query('invented', null), 'DATABASE_OPERATION_UNSUPPORTED');
    session.close(); code(() => session.context.query('invented', null), 'DATABASE_CLOSED');
  } finally { session.close(); db.dispose(); }
});
