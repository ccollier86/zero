import { defineDatabaseRealm } from '../../../../databases/database-realm';
export const tables = { notes: { id: 'text primary key', title: 'text not null' } };
export const realm = defineDatabaseRealm({ name: 'application-data-proof', version: '1', tables,
  queries: { 'notes.count': ({ database }) => database.query<{ total: number }>('SELECT COUNT(*) AS total FROM notes').get()! },
  commands: { 'notes.seed': ({ db }) => {
    for (let i = 0; i < 25; i++) db.create('notes', { id: String(i).padStart(3, '0'), title: `Synthetic ${i}` });
    return { total: 25 };
  } },
});
