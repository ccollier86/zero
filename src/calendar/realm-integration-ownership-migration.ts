/** Additive 011. Each retained calendar rule owns one permanent Jobs source identity. */
import type { Migration } from '../migrations/migrator';
import type { TableSchema } from '../sync/types';
import { CALENDAR_INTEGRATION_TABLES } from './realm-integrations-migration';

export const CALENDAR_INTEGRATION_OWNERSHIP_ADDITIONS: Record<string, TableSchema> = {
  _calendar_integration_rule_sources: {
    id: 'TEXT PRIMARY KEY CHECK(id=rule_id)', scope_id: 'TEXT NOT NULL', rule_id: 'TEXT NOT NULL',
    source_id: "TEXT NOT NULL CHECK(length(source_id)=68 AND substr(source_id,1,4)='src_' AND substr(source_id,5) NOT GLOB '*[^a-f0-9]*')",
  },
};
export const CALENDAR_INTEGRATION_OWNERSHIP_TABLES: Record<string, TableSchema> = { ...CALENDAR_INTEGRATION_TABLES, ...CALENDAR_INTEGRATION_OWNERSHIP_ADDITIONS };
for (const schema of Object.values(CALENDAR_INTEGRATION_OWNERSHIP_ADDITIONS)) Object.freeze(schema);
Object.freeze(CALENDAR_INTEGRATION_OWNERSHIP_ADDITIONS); Object.freeze(CALENDAR_INTEGRATION_OWNERSHIP_TABLES);

export function migrateCalendarIntegrationOwnership(database: Parameters<Migration['up']>[0]): void {
  // Inspect retained 010 evidence before installing guards or backfilling. Never
  // choose a winner, rewrite a source ID, or discard an earlier retired epoch.
  // The historical source protocol admits at most 10,000 policies/eight rules.
  const history = database.query<{ scope_id: string; rule_id: string; source_id: string }, []>(
    'SELECT scope_id,rule_id,source_id FROM _calendar_integration_policy_history ORDER BY scope_id,rule_id,epoch LIMIT 10001').all();
  if (history.length > 10_000) throw new Error('Calendar source ownership found policy history outside its retained envelope.');
  const owner = database.query<{ scope_id: string }, []>("SELECT scope_id FROM _calendar_owner WHERE id='application'").get();
  const rules = new Map<string, { scope_id: string; rule_id: string; source_id: string }>(), sources = new Map<string, string>();
  for (const row of history) {
    if (!owner || owner.scope_id !== row.scope_id) throw new Error('Calendar source ownership found inconsistent retained scope.');
    const key = row.scope_id + '\0' + row.rule_id, source = row.scope_id + '\0' + row.source_id;
    const rule = rules.get(key), claimant = sources.get(source);
    if (rule && rule.source_id !== row.source_id || claimant !== undefined && claimant !== key) {
      throw new Error('Calendar source ownership conflicts with retained rule history; preserve it for explicit recovery.');
    }
    rules.set(key, row); sources.set(source, key);
  }
  if (rules.size > 8) throw new Error('Calendar source ownership found rules outside its retained envelope.');
  database.run('CREATE UNIQUE INDEX calendar_integration_rule_source_owner ON _calendar_integration_rule_sources(scope_id,source_id)');
  database.run(`CREATE TRIGGER calendar_integration_rule_source_scope BEFORE INSERT ON _calendar_integration_rule_sources WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id)
    BEGIN SELECT RAISE(ABORT,'Private integration source scope is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_integration_rule_source_no_replace BEFORE INSERT ON _calendar_integration_rule_sources WHEN EXISTS(
    SELECT 1 FROM _calendar_integration_rule_sources WHERE id=NEW.id OR (scope_id=NEW.scope_id AND source_id=NEW.source_id))
    BEGIN SELECT RAISE(ABORT,'Private integration source ownership cannot be replaced'); END`);
  for (const operation of ['UPDATE', 'DELETE']) database.run(`CREATE TRIGGER calendar_integration_rule_source_${operation.toLowerCase()} BEFORE ${operation} ON _calendar_integration_rule_sources
    BEGIN SELECT RAISE(ABORT,'Private integration source ownership is permanent'); END`);
  for (const row of rules.values()) database.query('INSERT INTO _calendar_integration_rule_sources(id,scope_id,rule_id,source_id) VALUES(?,?,?,?)')
    .run(row.rule_id, row.scope_id, row.rule_id, row.source_id);
  database.run(`CREATE TRIGGER calendar_integration_policy_source_binding BEFORE INSERT ON _calendar_integration_policy_history WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_integration_rule_sources WHERE id=NEW.rule_id AND scope_id=NEW.scope_id AND source_id=NEW.source_id)
    BEGIN SELECT RAISE(ABORT,'Private integration policy must retain its rule source ownership'); END`);
}
