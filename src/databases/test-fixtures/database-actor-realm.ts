import { existsSync, writeFileSync } from 'node:fs';

import { DatabaseError } from '../database-error';
import { defineDatabaseRealm } from '../database-realm';

/** Realm imported independently by the real database-actor subprocess test. */
export const databaseActorFixtureRealm = defineDatabaseRealm({
  name: 'database-actor-fixture',
  version: '1',
  tables: {
    todos: {
      id: 'text primary key',
      title: 'text not null',
    },
  },
  queries: {
    'todos.count': ({ database }) => {
      const row = database.query('SELECT count(*) AS count FROM todos').get() as {
        count: number;
      };
      return { count: row.count };
    },
    'todos.capabilityProbe': ({ database }) => {
      const attempt = (sql: string): string => {
        try {
          database.query(sql).get();
          return 'unexpected-success';
        } catch (error) {
          return error instanceof DatabaseError ? error.code : 'untyped-error';
        }
      };
      const statement = database.query('SELECT count(*) AS count FROM todos');
      return {
        pragma: attempt('PRAGMA query_only = OFF'),
        pathQuery: attempt('SELECT file FROM pragma_database_list'),
        insert: attempt(
          "INSERT INTO todos (id, title) VALUES ('hostile', 'unsafe')",
        ),
        connectionKeys: Object.keys(database).sort(),
        statementKeys: Object.keys(statement).sort(),
        mutableSurfaces: [
          'run', 'exec', 'transaction', 'filename', 'handle', 'loadExtension',
        ].filter((key) => key in database),
        nativeStatement: 'native' in statement,
      };
    },
  },
  commands: {
    /** Deterministic cross-process transaction barrier used only by integration tests. */
    'test.blockingUpdate': ({ db }, input) => {
      const value = input as {
        id: string;
        title: string;
        enteredPath: string;
        releasePath: string;
      };
      db.update('todos', value.id, { title: value.title });
      writeFileSync(value.enteredPath, 'entered', { flag: 'wx' });

      const deadline = Date.now() + 10_000;
      const sleeper = new Int32Array(new SharedArrayBuffer(4));
      while (!existsSync(value.releasePath)) {
        if (Date.now() >= deadline) {
          throw new Error('Timed out waiting for the integration-test release barrier.');
        }
        Atomics.wait(sleeper, 0, 0, 5);
      }
      return { id: value.id, title: value.title };
    },
  },
});
