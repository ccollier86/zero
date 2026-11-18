/** Additive 009. Retained source rules and their frozen UTC expansion are distinct from legacy availability. */
import type { Migration } from '../migrations/migrator';
import type { TableSchema } from '../sync/types';
import { CALENDAR_PARTICIPANT_TABLES } from './realm-participant-bindings-migration';

export const CALENDAR_AVAILABILITY_POLICY_ADDITIONS: Record<string, TableSchema> = {
  _calendar_availability_policy_history: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id)',
    resource_revision: 'INTEGER NOT NULL CHECK(resource_revision>1)', kind: "TEXT NOT NULL CHECK(kind IN ('explicit-utc-v1','weekly-local-v1'))",
    source_json: "TEXT NOT NULL CHECK(length(CAST(source_json AS BLOB))<=24576 AND json_valid(source_json) AND json_type(source_json)='object' AND json_extract(source_json,'$.kind')=kind)",
    mode: "TEXT NOT NULL CHECK(mode IN ('unrestricted','windows'))", window_count: 'INTEGER NOT NULL CHECK(window_count BETWEEN 0 AND 1024)',
    coverage_start_ms: 'INTEGER', coverage_end_ms: 'INTEGER', engine_json: 'TEXT',
    skipped_json: "TEXT NOT NULL CHECK(length(skipped_json)<=8192 AND json_valid(skipped_json) AND json_type(skipped_json)='array' AND json_array_length(skipped_json)<=366)",
    _identity: ['scope_id', 'resource_id', 'resource_revision'] },
  _calendar_availability_policy_windows: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id)',
    history_id: 'TEXT NOT NULL REFERENCES _calendar_availability_policy_history(id)', ordinal: 'INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 1023)',
    start_ms: 'INTEGER NOT NULL', end_ms: 'INTEGER NOT NULL CHECK(end_ms>start_ms)', _identity: ['history_id', 'ordinal'] },
  _calendar_availability_policy_current: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id) CHECK(id=resource_id)',
    resource_revision: 'INTEGER NOT NULL CHECK(resource_revision>1)', source_kind: "TEXT NOT NULL CHECK(source_kind IN ('legacy','policy'))",
    history_id: "TEXT REFERENCES _calendar_availability_policy_history(id) CHECK((source_kind='policy')=(history_id IS NOT NULL))" },
};
export const CALENDAR_AVAILABILITY_POLICY_TABLES: Record<string, TableSchema> = { ...CALENDAR_PARTICIPANT_TABLES, ...CALENDAR_AVAILABILITY_POLICY_ADDITIONS };
// The migration closes over this exact addition set. Freeze only the new
// declarations and current map, never mutate imported historical generations.
for (const definition of Object.values(CALENDAR_AVAILABILITY_POLICY_ADDITIONS)) {
  if (Array.isArray(definition._identity)) Object.freeze(definition._identity);
  Object.freeze(definition);
}
Object.freeze(CALENDAR_AVAILABILITY_POLICY_ADDITIONS);
Object.freeze(CALENDAR_AVAILABILITY_POLICY_TABLES);

export function migrateCalendarWorkingHours(database: Parameters<Migration['up']>[0]): void {
  database.run('CREATE UNIQUE INDEX calendar_availability_policy_history_identity ON _calendar_availability_policy_history(scope_id,resource_id,resource_revision)');
  database.run('CREATE UNIQUE INDEX calendar_availability_policy_window_identity ON _calendar_availability_policy_windows(history_id,ordinal)');
  database.run('CREATE INDEX calendar_availability_policy_window_contains ON _calendar_availability_policy_windows(scope_id,history_id,start_ms DESC,end_ms)');
  database.run('CREATE UNIQUE INDEX calendar_availability_policy_current_identity ON _calendar_availability_policy_current(scope_id,resource_id)');
  for (const table of Object.keys(CALENDAR_AVAILABILITY_POLICY_ADDITIONS)) {
    const duplicate = table === '_calendar_availability_policy_history' ? ' OR (scope_id=NEW.scope_id AND resource_id=NEW.resource_id AND resource_revision=NEW.resource_revision)'
      : table === '_calendar_availability_policy_windows' ? ' OR (history_id=NEW.history_id AND ordinal=NEW.ordinal)'
      : ' OR (scope_id=NEW.scope_id AND resource_id=NEW.resource_id)';
    database.run(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=NEW.id${duplicate}) BEGIN SELECT RAISE(ABORT,'Private calendar identity cannot be replaced'); END`);
    database.run(`CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private calendar scope is inconsistent'); END`);
    database.run(`CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar history must be retained'); END`);
    if (table !== '_calendar_availability_policy_current') database.run(`CREATE TRIGGER ${table}_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar evidence is immutable'); END`);
    else database.run(`CREATE TRIGGER ${table}_identity BEFORE UPDATE OF id,scope_id,resource_id ON ${table} WHEN OLD.id IS NOT NEW.id OR OLD.scope_id IS NOT NEW.scope_id OR OLD.resource_id IS NOT NEW.resource_id BEGIN SELECT RAISE(ABORT,'Private calendar identity is immutable'); END`);
  }
  database.run(`CREATE TRIGGER calendar_availability_policy_history_parent BEFORE INSERT ON _calendar_availability_policy_history WHEN
    NOT EXISTS(SELECT 1 FROM calendar_resources WHERE id=NEW.resource_id AND scope_id=NEW.scope_id AND revision=NEW.resource_revision)
    OR EXISTS(SELECT 1 FROM _calendar_availability_policy_current WHERE scope_id=NEW.scope_id AND resource_id=NEW.resource_id AND resource_revision>=NEW.resource_revision)
    OR EXISTS(SELECT 1 FROM _calendar_effect_intents WHERE scope_id=NEW.scope_id AND target_kind='resource' AND target_id=NEW.resource_id AND revision=NEW.resource_revision)
    OR (NEW.kind='explicit-utc-v1' AND (NEW.coverage_start_ms IS NOT NULL OR NEW.coverage_end_ms IS NOT NULL OR NEW.engine_json IS NOT NULL OR NEW.skipped_json<>'[]' OR (NEW.mode='unrestricted' AND NEW.window_count<>0)))
    OR (NEW.kind='weekly-local-v1' AND (NEW.mode<>'windows' OR NEW.coverage_start_ms IS NULL OR NEW.coverage_end_ms IS NULL OR NEW.coverage_end_ms<=NEW.coverage_start_ms OR NEW.engine_json IS NULL OR NOT json_valid(NEW.engine_json) OR json_extract(NEW.engine_json,'$.name') IS NOT 'temporal-working-hours-v1'))
    BEGIN SELECT RAISE(ABORT,'Private availability policy generation is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_availability_policy_window_parent BEFORE INSERT ON _calendar_availability_policy_windows WHEN
    NOT EXISTS(SELECT 1 FROM _calendar_availability_policy_history h JOIN calendar_resources r ON r.id=h.resource_id AND r.scope_id=h.scope_id WHERE h.id=NEW.history_id AND h.scope_id=NEW.scope_id AND h.resource_id=NEW.resource_id AND r.revision=h.resource_revision AND NEW.ordinal<h.window_count
      AND (h.kind='explicit-utc-v1' OR (NEW.start_ms>=h.coverage_start_ms AND NEW.end_ms<=h.coverage_end_ms))
      AND NOT EXISTS(SELECT 1 FROM _calendar_effect_intents e WHERE e.scope_id=h.scope_id AND e.target_kind='resource' AND e.target_id=h.resource_id AND e.revision=h.resource_revision))
    OR EXISTS(SELECT 1 FROM _calendar_availability_policy_current WHERE history_id=NEW.history_id)
    OR NEW.ordinal<>(SELECT count(*) FROM _calendar_availability_policy_windows WHERE history_id=NEW.history_id)
    OR EXISTS(SELECT 1 FROM _calendar_availability_policy_windows WHERE history_id=NEW.history_id AND ordinal=NEW.ordinal-1 AND end_ms>=NEW.start_ms)
    BEGIN SELECT RAISE(ABORT,'Private availability window generation is sealed'); END`);
  for (const operation of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER calendar_availability_policy_current_parent_${operation.toLowerCase()} BEFORE ${operation} ON _calendar_availability_policy_current WHEN
    NOT EXISTS(SELECT 1 FROM calendar_resources WHERE id=NEW.resource_id AND scope_id=NEW.scope_id AND revision=NEW.resource_revision)
    OR EXISTS(SELECT 1 FROM _calendar_effect_intents WHERE scope_id=NEW.scope_id AND target_kind='resource' AND target_id=NEW.resource_id AND revision=NEW.resource_revision)
    OR (NEW.source_kind='legacy' AND NOT EXISTS(SELECT 1 FROM _calendar_availability WHERE scope_id=NEW.scope_id AND resource_id=NEW.resource_id AND policy_revision=NEW.resource_revision))
    OR (NEW.source_kind='policy' AND NOT EXISTS(SELECT 1 FROM _calendar_availability_policy_history h WHERE h.id=NEW.history_id AND h.scope_id=NEW.scope_id AND h.resource_id=NEW.resource_id AND h.resource_revision=NEW.resource_revision AND h.window_count=(SELECT count(*) FROM _calendar_availability_policy_windows w WHERE w.history_id=h.id)))
    BEGIN SELECT RAISE(ABORT,'Private availability policy pointer is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_availability_policy_current_forward BEFORE UPDATE ON _calendar_availability_policy_current WHEN NEW.resource_revision<=OLD.resource_revision BEGIN SELECT RAISE(ABORT,'Private availability policy pointer must advance'); END`);
}
