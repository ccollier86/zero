import { existsSync, writeFileSync } from 'node:fs';

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
