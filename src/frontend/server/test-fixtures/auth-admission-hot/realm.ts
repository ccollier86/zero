/** Populated hot-mode actor with a real durable outbox and a bounded work barrier. */
import { existsSync, writeFileSync } from 'node:fs';
import { defineDatabaseRealm } from '../../../../databases/database-realm';
import { defineDatabaseAutomations, defineDatabaseFunction, defineDatabaseTrigger } from '../../../../database-automations';

export const tables = {
  functions: { id: 'text primary key', title: 'text not null', source: 'text not null' },
  invocations: { id: 'text primary key', body: 'text not null' },
  retained_history: { id: 'text primary key', body: 'text not null' },
};
const notify = defineDatabaseFunction({ name: 'auth-proof.notify', version: 1, mode: 'durable', async handler() {} });
export const realm = defineDatabaseRealm({
  name: 'auth-admission-hot-proof', version: '1', tables,
  automations: defineDatabaseAutomations({ functions: [notify], triggers: [defineDatabaseTrigger({
    name: 'auth-proof.function-created', version: 1, table: 'functions', after: { insert: true }, run: notify,
  })] }),
  commands: {
    'proof.seed': ({ db }) => {
      for (let i = 0; i < 51; i++) db.insert('functions', { id: `f${i}`, title: `Function ${i}`, source: 'x'.repeat(2048) });
      for (let i = 0; i < 768; i++) db.insert('invocations', { id: `i${i}`, body: 'x'.repeat(256) });
      // Synthetic retained-history rows exercise image size, not private receipt SQL.
      for (let i = 0; i < 19_448; i++) db.insert('retained_history', { id: `r${i}`, body: 'x'.repeat(64) });
      return { functions: 51, invocations: 768, history: 19_448 };
    },
    'proof.work': ({ db }, input) => {
      const { enteredPath, releasePath } = input as { enteredPath: string; releasePath: string };
      db.get('functions', 'f0');
      writeFileSync(enteredPath, 'entered', { flag: 'wx' });
      const deadline = Date.now() + 5_000, sleeper = new Int32Array(new SharedArrayBuffer(4));
      while (!existsSync(releasePath)) {
        if (Date.now() >= deadline) throw new Error('Synthetic actor barrier expired');
        Atomics.wait(sleeper, 0, 0, 5);
      }
      return { completed: true };
    },
  },
  queries: {
    'proof.counts': ({ database }) => database.query(`SELECT
      (SELECT count(*) FROM functions) AS functions,
      (SELECT count(*) FROM invocations) AS invocations,
      (SELECT count(*) FROM retained_history) AS history,
      (SELECT count(*) FROM _zero_database_automation_outbox WHERE status = 'completed') AS deliveries`).get() as {
        functions: number; invocations: number; history: number; deliveries: number;
      },
  },
});
