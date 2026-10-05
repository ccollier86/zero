/** Public-package schema and composed realm used independently by gateway and actors. */

import { defineTable, field, getGuardianTableReferences, schema, type FieldDef } from '@zero/framework/schema';
import { composeDatabaseRealm, defineDatabaseRealmContribution, type DatabaseRealm } from '@zero/framework/server';
import { SYNC_TABLE_MUTATION_VALIDATOR, type TableSchema } from '@zero/framework/sync';

const syncSymbol = Symbol.for('@zero/framework/schema-declared-sync-mode');
const modes = ['full', 'lazy', 'auto', undefined] as const;
const tables: Record<string, TableSchema> = {};

for (const mode of modes) {
  const suffix = mode ?? 'omitted';
  const fields: Record<string, FieldDef> = {
    title: field.text({ required: true, minLength: 1, maxLength: 40 }),
  };
  if (mode === 'full') fields.owner_user_id = field.guardianUser();
  const options = { pk: 'id', ...(mode === undefined ? {} : { sync: mode }) };
  const table = defineTable(`defined_${suffix}`, fields, options);
  const generated = schema({ [`schema_${suffix}`]: { fields, ...options } });
  // Spread modes exercise enumerable metadata independently of the Guardian
  // metadata, which intentionally remains non-enumerable on the full tables.
  tables[table.name] = mode === 'full' ? table.serverTable : { ...table.serverTable };
  const name = `schema_${suffix}`;
  tables[name] = mode === 'full' ? generated.serverTables[name]! : { ...generated.serverTables[name]! };
}

export const fixtureTables = tables;
export const fixtureTableNames = Object.keys(tables).sort();

export const fixtureRealm: DatabaseRealm = composeDatabaseRealm({
  name: 'public-sync-metadata-startup',
  version: '1',
  contributions: [defineDatabaseRealmContribution({
    name: 'application-tables',
    version: '1',
    tables,
    queries: {
      'proof.inspect': ({ database }) => fixtureTableNames.map((name) => {
        const table = fixtureRealm.tables[name]!;
        const installed = database.query('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
          .get('table', name) as { sql: string };
        const count = database.query(`SELECT count(*) AS count FROM "${name}"`).get() as { count: number };
        const validator = table[SYNC_TABLE_MUTATION_VALIDATOR];
        return {
          name,
          declaredMode: Reflect.get(table, syncSymbol) ?? null,
          hasValidator: typeof validator === 'object' && validator !== null,
          guardianReferences: getGuardianTableReferences(table).map(({ field, kind }) => ({ field, kind })),
          sql: installed.sql,
          count: count.count,
        };
      }),
    },
  })],
});
