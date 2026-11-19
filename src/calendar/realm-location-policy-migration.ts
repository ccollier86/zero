/** Additive018 ownsDDL; original001–017 declarations/functions remain exact. */
import type { Database, Statement } from 'bun:sqlite';
import type { Migration } from '../migrations/migrator';
import type { TableSchema } from '../sync/types';
import { inspectDatabaseSchema } from '../migrations/schema-inspector';
import { snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { diffSchemaSnapshots } from '../migrations/schema-diff';
import { calendarAppointmentAllDayTables } from './realm-appointment-all-day-migration';
import { CALENDAR_LOCATION_POLICY_STATE as state, CALENDAR_LOCATION_POLICY_HISTORY as history, CALENDAR_LOCATION_POLICY_WINDOWS as windows,
  CALENDAR_LOCATION_POLICY_CURRENT as current, normalizeCalendarResourceLocationPolicy } from './location-policy-model';
import { CalendarError } from './error';

export const CALENDAR_RESOURCE_LOCATION_POLICY_ADDITIONS: Readonly<Record<string, TableSchema>> = Object.freeze({
  [state]: Object.freeze({ id: "TEXT PRIMARY KEY NOT NULL CHECK(id='application')", version: "INTEGER NOT NULL CHECK(typeof(version)='integer' AND version=18)" }),
  [history]: Object.freeze({ id: 'TEXT PRIMARY KEY NOT NULL', scope_id: 'TEXT NOT NULL', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id)',
    resource_revision: "INTEGER NOT NULL CHECK(typeof(resource_revision)='integer' AND resource_revision>1)",
    kind: "TEXT NOT NULL CHECK(kind IN ('static-v1','effective-utc-v1'))", source_json: "TEXT NOT NULL CHECK(length(CAST(source_json AS BLOB))<=24576 AND CASE WHEN json_valid(source_json) THEN json_type(source_json)='object' AND json_extract(source_json,'$.kind') IS kind ELSE 0 END)",
    window_count: "INTEGER NOT NULL CHECK(typeof(window_count)='integer' AND window_count BETWEEN 0 AND 256 AND (kind<>'static-v1' OR window_count=0))" }),
  [windows]: Object.freeze({ id: 'TEXT PRIMARY KEY NOT NULL', scope_id: 'TEXT NOT NULL', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id)',
    resource_revision: "INTEGER NOT NULL CHECK(typeof(resource_revision)='integer' AND resource_revision>1)", history_id: `TEXT NOT NULL REFERENCES ${history}(id)`,
    location_id: 'TEXT NOT NULL REFERENCES calendar_locations(id)', ordinal: "INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal BETWEEN 0 AND 63)",
    start_ms: "INTEGER NOT NULL CHECK(typeof(start_ms)='integer' AND start_ms BETWEEN -8640000000000000 AND 8640000000000000)",
    end_ms: "INTEGER NOT NULL CHECK(typeof(end_ms)='integer' AND end_ms>start_ms AND end_ms<=8640000000000000)" }),
  [current]: Object.freeze({ id: 'TEXT PRIMARY KEY NOT NULL', scope_id: 'TEXT NOT NULL', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id) CHECK(id=resource_id)',
    resource_revision: "INTEGER NOT NULL CHECK(typeof(resource_revision)='integer' AND resource_revision>0)",
    source_kind: "TEXT NOT NULL CHECK(source_kind IN ('legacy','policy'))", history_id: `TEXT REFERENCES ${history}(id) CHECK(((source_kind='legacy' AND history_id IS NULL) OR (source_kind='policy' AND history_id IS NOT NULL)) IS 1)` }),
});
export function calendarResourceLocationPolicyTables(): Readonly<Record<string, TableSchema>> {
  return Object.freeze({ ...Object.fromEntries(Object.entries(calendarAppointmentAllDayTables()).map(([name, table]) => [name, Object.freeze({ ...table })])),
    ...CALENDAR_RESOURCE_LOCATION_POLICY_ADDITIONS });
}
function schema(database: Parameters<Migration['up']>[0]) {
  const statements: Statement[] = [];
  try { return inspectDatabaseSchema({ prepare(sql: string) { const statement = database.prepare(sql); statements.push(statement); return statement; } } as Database); }
  finally { for (const statement of statements.reverse()) statement.finalize(); }
}
export function migrateCalendarResourceLocationPolicy(database: Parameters<Migration['up']>[0]): void {
  const before = schema(database), retained = calendarAppointmentAllDayTables();
  if (diffSchemaSnapshots(snapshotDeclaredTables(retained), { tables: Object.fromEntries(Object.keys(retained).filter(name => before.tables[name]).map(name => [name, before.tables[name]!])) }).length
    || !database.query("SELECT 1 WHERE (SELECT count(*) FROM _calendar_appointment_time_state)=1 AND EXISTS(SELECT 1 FROM _calendar_appointment_time_state WHERE id='application' AND version=17)").get()
    || database.query("SELECT 1 FROM _calendar_usage WHERE id='locationPolicyVersion'").get()) throw new CalendarError('CALENDAR_STATE_INVALID');
  // Preparation validates real retained directory facts before deriving a
  // selector. Never turn a lost old pointer/member into all-time permission.
  for (const resource of database.query<{ id: string; scope_id: string; revision: number }, []>('SELECT id,scope_id,revision FROM calendar_resources').all()) {
    const pointer = database.query<{ scope_id: string; resource_id: string; resource_revision: number }, [string]>('SELECT * FROM _calendar_resource_locations WHERE id=?').get(resource.id);
    const selected = pointer ? database.query<{ location_ids_json: string }, [string, string, number]>('SELECT location_ids_json FROM _calendar_resource_location_history WHERE scope_id=? AND resource_id=? AND resource_revision=?').get(resource.scope_id, resource.id, pointer.resource_revision) : null;
    const members = database.query<{ location_id: string; resource_revision: number }, [string, string]>('SELECT location_id,resource_revision FROM _calendar_resource_location_current WHERE scope_id=? AND resource_id=? ORDER BY location_id LIMIT 17').all(resource.scope_id, resource.id);
    if (!pointer) {
      if (members.length || database.query('SELECT 1 FROM _calendar_resource_location_history WHERE scope_id=? AND resource_id=? LIMIT 1').get(resource.scope_id, resource.id)) throw new CalendarError('CALENDAR_STATE_INVALID');
    } else {
      try {
        if (pointer.scope_id !== resource.scope_id || pointer.resource_id !== resource.id || pointer.resource_revision > resource.revision || !selected) throw new Error();
        const policy = normalizeCalendarResourceLocationPolicy({ kind: 'static-v1', locationIds: JSON.parse(selected.location_ids_json) });
        if (policy.kind !== 'static-v1' || JSON.stringify(policy.locationIds) !== selected.location_ids_json
          || JSON.stringify(members.map(member => member.location_id)) !== selected.location_ids_json
          || members.some(member => member.resource_revision !== pointer.resource_revision)) throw new Error();
      } catch { throw new CalendarError('CALENDAR_STATE_INVALID'); }
    }
  }
  for (const [name, table] of Object.entries(CALENDAR_RESOURCE_LOCATION_POLICY_ADDITIONS)) if (before.tables[name]
    && (diffSchemaSnapshots(snapshotDeclaredTables({ [name]: table }), { tables: { [name]: before.tables[name]! } }).length
      || database.query(`SELECT 1 FROM ${name} LIMIT 1`).get()
      || database.query("SELECT 1 FROM sqlite_schema WHERE tbl_name=? AND type IN ('index','trigger') AND name NOT LIKE 'sqlite_%' LIMIT 1").get(name))) throw new CalendarError('CALENDAR_STATE_INVALID');
  for (const [name, table] of Object.entries(CALENDAR_RESOURCE_LOCATION_POLICY_ADDITIONS)) database.run(`CREATE TABLE IF NOT EXISTS "${name}" (${Object.entries(table).map(([column, declaration]) => `"${column}" ${declaration}`).join(',')})`);
  database.run(`INSERT INTO ${state} VALUES('application',18)`);
  database.run("INSERT INTO _calendar_usage(id,count) VALUES('locationPolicyVersion',18)");
  // Derived legacy selectors only: never fabricate authored static-policy history.
  database.run(`INSERT INTO ${current}(id,scope_id,resource_id,resource_revision,source_kind,history_id)
    SELECT r.id,r.scope_id,r.id,COALESCE(d.resource_revision,1),'legacy',NULL FROM calendar_resources r
    LEFT JOIN _calendar_resource_locations d ON d.scope_id=r.scope_id AND d.resource_id=r.id`);
  database.run(`CREATE UNIQUE INDEX calendar_location_policy_history_identity ON ${history}(scope_id,resource_id,resource_revision)`);
  database.run(`CREATE UNIQUE INDEX calendar_location_policy_window_identity ON ${windows}(history_id,location_id,ordinal)`);
  database.run(`CREATE INDEX calendar_location_policy_coverage ON ${windows}(scope_id,resource_id,resource_revision,location_id,start_ms,end_ms)`);
  database.run(`CREATE UNIQUE INDEX calendar_location_policy_current_identity ON ${current}(scope_id,resource_id)`);
  for (const op of ['UPDATE', 'DELETE']) database.run(`CREATE TRIGGER calendar_location_policy_state_${op.toLowerCase()} BEFORE ${op} ON ${state} BEGIN SELECT RAISE(ABORT,'Private location policy state is immutable'); END`);
  database.run(`CREATE TRIGGER calendar_location_policy_state_replace BEFORE INSERT ON ${state} WHEN EXISTS(SELECT 1 FROM ${state}) BEGIN SELECT RAISE(ABORT,'Private location policy state is immutable'); END`);
  for (const op of ['UPDATE', 'DELETE']) database.run(`CREATE TRIGGER calendar_location_policy_marker_${op.toLowerCase()} BEFORE ${op} ON _calendar_usage WHEN OLD.id='locationPolicyVersion' BEGIN SELECT RAISE(ABORT,'Private location policy marker is immutable'); END`);
  database.run("CREATE TRIGGER calendar_location_policy_marker_replace BEFORE INSERT ON _calendar_usage WHEN NEW.id='locationPolicyVersion' BEGIN SELECT RAISE(ABORT,'Private location policy marker is immutable'); END");
  for (const table of [history, windows, current]) {
    database.run(`CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private location policy facts are retained'); END`);
    database.run(`CREATE TRIGGER ${table}_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'Private location policy identity is immutable'); END`);
    database.run(`CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM calendar_resources r JOIN _calendar_owner o ON o.scope_id=r.scope_id AND o.id='application' WHERE r.id=NEW.resource_id AND r.scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private location policy scope is inconsistent'); END`);
    if (table !== current) database.run(`CREATE TRIGGER ${table}_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Private location policy facts are immutable'); END`);
  }
  const unsealed = (scope: string, resource: string, revision: string) => `NOT EXISTS(SELECT 1 FROM _calendar_effect_intents e WHERE e.scope_id=${scope} AND e.target_kind='resource' AND e.target_id=${resource} AND e.revision=${revision})`;
  database.run(`CREATE TRIGGER calendar_location_policy_history_parent BEFORE INSERT ON ${history} WHEN
    NOT EXISTS(SELECT 1 FROM calendar_resources r WHERE r.id=NEW.resource_id AND r.scope_id=NEW.scope_id AND r.revision=NEW.resource_revision)
    OR NOT ${unsealed('NEW.scope_id', 'NEW.resource_id', 'NEW.resource_revision')}
    OR EXISTS(SELECT 1 FROM ${current} p WHERE p.scope_id=NEW.scope_id AND p.resource_id=NEW.resource_id AND p.resource_revision>=NEW.resource_revision)
    OR NOT EXISTS(SELECT 1 FROM ${state} WHERE id='application' AND version=18)
    BEGIN SELECT RAISE(ABORT,'Private location policy generation is sealed'); END`);
  database.run(`CREATE TRIGGER calendar_location_policy_history_source BEFORE INSERT ON ${history} WHEN NOT (
    CASE NEW.kind WHEN 'static-v1' THEN json_type(NEW.source_json,'$.locationIds') IS 'array'
      AND json_array_length(NEW.source_json,'$.locationIds')<=16 AND json_remove(NEW.source_json,'$.kind','$.locationIds')='{}'
      AND NOT EXISTS(SELECT 1 FROM json_each(NEW.source_json,'$.locationIds') WHERE type<>'text')
      AND (SELECT count(DISTINCT value) FROM json_each(NEW.source_json,'$.locationIds'))=json_array_length(NEW.source_json,'$.locationIds')
    ELSE json_type(NEW.source_json,'$.assignments') IS 'array' AND json_array_length(NEW.source_json,'$.assignments')<=16
      AND json_remove(NEW.source_json,'$.kind','$.assignments')='{}'
      AND (SELECT count(DISTINCT json_extract(value,'$.locationId')) FROM json_each(NEW.source_json,'$.assignments'))=json_array_length(NEW.source_json,'$.assignments')
      AND NOT EXISTS(SELECT 1 FROM json_each(NEW.source_json,'$.assignments') a WHERE a.type<>'object'
        OR json_type(a.value,'$.locationId') IS NOT 'text' OR json_type(a.value,'$.windows') IS NOT 'array'
        OR json_array_length(a.value,'$.windows')>64 OR json_remove(a.value,'$.locationId','$.windows')<>'{}')
      AND (SELECT COALESCE(sum(json_array_length(value,'$.windows')),0) FROM json_each(NEW.source_json,'$.assignments'))=NEW.window_count
    END IS 1) BEGIN SELECT RAISE(ABORT,'Private location policy source is malformed'); END`);
  database.run(`CREATE TRIGGER calendar_location_policy_window_parent BEFORE INSERT ON ${windows} WHEN NOT EXISTS(
    SELECT 1 FROM ${history} h, json_each(h.source_json,'$.assignments') a WHERE h.id=NEW.history_id AND h.scope_id=NEW.scope_id
      AND h.resource_id=NEW.resource_id AND h.resource_revision=NEW.resource_revision AND h.kind='effective-utc-v1'
      AND json_extract(a.value,'$.locationId') IS NEW.location_id AND json_type(a.value,'$.windows['||NEW.ordinal||']') IS 'object'
      AND ${unsealed('h.scope_id', 'h.resource_id', 'h.resource_revision')}
      AND NOT EXISTS(SELECT 1 FROM ${current} p WHERE p.scope_id=h.scope_id AND p.resource_id=h.resource_id AND p.resource_revision>=h.resource_revision))
    BEGIN SELECT RAISE(ABORT,'Private location policy window generation is sealed'); END`);
  const selected = `EXISTS(SELECT 1 FROM calendar_resources r WHERE r.id=NEW.resource_id AND r.scope_id=NEW.scope_id AND r.revision=NEW.resource_revision)
    AND ${unsealed('NEW.scope_id', 'NEW.resource_id', 'NEW.resource_revision')}
    AND ((NEW.source_kind='legacy' AND NEW.history_id IS NULL AND (
      (NEW.resource_revision=1 AND NOT EXISTS(SELECT 1 FROM _calendar_resource_locations d WHERE d.scope_id=NEW.scope_id AND d.resource_id=NEW.resource_id))
      OR EXISTS(SELECT 1 FROM _calendar_resource_locations d WHERE d.scope_id=NEW.scope_id AND d.resource_id=NEW.resource_id AND d.resource_revision=NEW.resource_revision)))
      OR (NEW.source_kind='policy' AND EXISTS(SELECT 1 FROM ${history} h JOIN _calendar_resource_locations d ON d.scope_id=h.scope_id AND d.resource_id=h.resource_id AND d.resource_revision=h.resource_revision
        JOIN _calendar_resource_location_history dh ON dh.scope_id=d.scope_id AND dh.resource_id=d.resource_id AND dh.resource_revision=d.resource_revision
        WHERE h.id=NEW.history_id AND h.scope_id=NEW.scope_id AND h.resource_id=NEW.resource_id AND h.resource_revision=NEW.resource_revision
          AND h.window_count=(SELECT count(*) FROM ${windows} w WHERE w.history_id=h.id)
          AND (CASE h.kind WHEN 'static-v1' THEN json_extract(h.source_json,'$.locationIds') ELSE (SELECT json_group_array(json_extract(value,'$.locationId')) FROM json_each(h.source_json,'$.assignments')) END) IS dh.location_ids_json)))`;
  for (const op of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER calendar_location_policy_pointer_${op.toLowerCase()} BEFORE ${op} ON ${current} WHEN NOT (${selected}) BEGIN SELECT RAISE(ABORT,'Private location policy selector is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_location_policy_pointer_identity BEFORE UPDATE ON ${current} WHEN NEW.id IS NOT OLD.id OR NEW.scope_id IS NOT OLD.scope_id OR NEW.resource_id IS NOT OLD.resource_id OR NEW.resource_revision<=OLD.resource_revision OR (OLD.source_kind='policy' AND NEW.source_kind='legacy') BEGIN SELECT RAISE(ABORT,'Private location policy selector must advance'); END`);
  for (const [table, operations] of [['_calendar_resource_location_history', ['INSERT']], ['_calendar_resource_location_members', ['INSERT']],
    ['_calendar_resource_locations', ['INSERT', 'UPDATE']], ['_calendar_resource_location_current', ['INSERT', 'UPDATE', 'DELETE']]] as const) {
    for (const op of operations) {
      const row = op === 'DELETE' ? 'OLD' : 'NEW';
      database.run(`CREATE TRIGGER calendar_location_policy_directory_${table}_${op.toLowerCase()} BEFORE ${op} ON ${table}
        WHEN EXISTS(SELECT 1 FROM calendar_resources r JOIN _calendar_effect_intents e ON e.scope_id=r.scope_id AND e.target_kind='resource' AND e.target_id=r.id AND e.revision=r.revision
          WHERE r.scope_id=${row}.scope_id AND r.id=${row}.resource_id)
        BEGIN SELECT RAISE(ABORT,'Private directory assignment generation is sealed'); END`);
    }
  }
  database.run(`CREATE TRIGGER calendar_location_policy_effect BEFORE INSERT ON _calendar_effect_intents WHEN NEW.target_kind='resource' AND (
    NOT EXISTS(SELECT 1 FROM ${state} WHERE id='application' AND version=18)
    OR NOT EXISTS(SELECT 1 FROM _calendar_usage WHERE id='locationPolicyVersion' AND count=18)
    OR NOT EXISTS(SELECT 1 FROM ${current} p JOIN calendar_resources r ON r.id=p.resource_id AND r.scope_id=p.scope_id
      WHERE p.scope_id=NEW.scope_id AND p.resource_id=NEW.target_id AND r.revision=NEW.revision AND p.resource_revision<=r.revision))
    BEGIN SELECT RAISE(ABORT,'Private current location policy is missing'); END`);
}
export const CALENDAR_RESOURCE_LOCATION_POLICY_MIGRATION: Readonly<Migration> = Object.freeze({ version: '018',
  description: 'Versioned effective resource location assignment coverage', up: migrateCalendarResourceLocationPolicy });
