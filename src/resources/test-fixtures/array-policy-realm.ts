/** Pure actor-local schema and tracked parent/child commands for array-policy integration. */
import { defineDatabaseRealm } from '../../databases/database-realm';

export const arrayPolicyTables = {
  records: { id: 'text primary key', title: 'text not null', access_groups: 'text', state: 'text not null' },
  record_children: { id: 'text primary key', parent_id: 'text not null', title: 'text not null', access_groups: 'text', state: 'text not null' },
};

export const arrayPolicyRealm = defineDatabaseRealm({
  name: 'array-policy-integration', version: '1', tables: arrayPolicyTables,
  commands: {
    'records.relabel': ({ db }, input) => {
      const { id, groups } = input as { id: string; groups: string[] };
      const patch = { access_groups: JSON.stringify(groups) };
      db.update('records', id, patch);
      db.update('record_children', `child-${id}`, patch);
      return { id, groups };
    },
  },
});
