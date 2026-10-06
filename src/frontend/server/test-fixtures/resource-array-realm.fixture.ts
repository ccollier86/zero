/** Public package realm loaded independently by the gateway and its actors. */
import { defineTable, field } from '@zero/framework/schema';
import { defineDatabaseRealm } from '@zero/framework/server';

export const tasks = defineTable('tasks', {
  title: field.text({ required: true }),
  _access_groups_json: field.json(),
}, { pk: 'id', sync: 'full' });

export const realm = defineDatabaseRealm({
  name: 'public-array-policy-proof', version: '1',
  tables: { tasks: tasks.serverTable },
});
