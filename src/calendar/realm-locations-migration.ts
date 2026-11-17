/** Additive 004: versioned directory metadata and resource assignments, never booking authority. */
import type { Migration } from '../migrations/migrator';

export function migrateCalendarLocations(database: Parameters<Migration['up']>[0]): void {
  for (const sql of [
    'CREATE INDEX calendar_location_catalog ON calendar_locations(scope_id,id)',
    'CREATE UNIQUE INDEX calendar_location_history_identity ON _calendar_location_history(scope_id,location_id,location_revision)',
    'CREATE INDEX calendar_location_region ON _calendar_location_history(scope_id,region,location_id,location_revision)',
    'CREATE UNIQUE INDEX calendar_resource_location_history_identity ON _calendar_resource_location_history(scope_id,resource_id,resource_revision)',
    'CREATE UNIQUE INDEX calendar_resource_location_member_identity ON _calendar_resource_location_members(scope_id,resource_id,resource_revision,location_id)',
    'CREATE INDEX calendar_resource_location_lookup ON _calendar_resource_location_members(scope_id,location_id,resource_id,resource_revision)',
    'CREATE UNIQUE INDEX calendar_resource_location_current_identity ON _calendar_resource_location_current(scope_id,resource_id,location_id)',
    'CREATE INDEX calendar_resource_location_current_lookup ON _calendar_resource_location_current(scope_id,location_id,resource_id,resource_revision)',
    'CREATE UNIQUE INDEX calendar_resource_locations_identity ON _calendar_resource_locations(scope_id,resource_id)',
    'CREATE UNIQUE INDEX calendar_location_receipt_identity ON _calendar_location_receipts(scope_id,principal,request_id)',
    'CREATE INDEX calendar_location_effect_source ON _calendar_location_effect_intents(scope_id,target_kind,target_id,revision)',
  ]) database.run(sql);
  const immutable = ['_calendar_location_history', '_calendar_resource_location_history', '_calendar_resource_location_members', '_calendar_location_receipts', '_calendar_location_effect_intents'];
  for (const table of ['calendar_locations', '_calendar_resource_locations', '_calendar_resource_location_current', ...immutable]) {
    const duplicate = 'id=NEW.id' + (table === '_calendar_location_history' ? ' OR (scope_id=NEW.scope_id AND location_id=NEW.location_id AND location_revision=NEW.location_revision)'
      : table === '_calendar_resource_location_history' ? ' OR (scope_id=NEW.scope_id AND resource_id=NEW.resource_id AND resource_revision=NEW.resource_revision)'
      : table === '_calendar_resource_location_members' ? ' OR (scope_id=NEW.scope_id AND resource_id=NEW.resource_id AND resource_revision=NEW.resource_revision AND location_id=NEW.location_id)'
      : table === '_calendar_resource_locations' ? ' OR (scope_id=NEW.scope_id AND resource_id=NEW.resource_id)'
      : table === '_calendar_resource_location_current' ? ' OR (scope_id=NEW.scope_id AND resource_id=NEW.resource_id AND location_id=NEW.location_id)'
      : table === '_calendar_location_receipts' ? ' OR (scope_id=NEW.scope_id AND principal=NEW.principal AND request_id=NEW.request_id)' : '');
    database.run(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${duplicate}) BEGIN SELECT RAISE(ABORT,'Private calendar identity cannot be replaced'); END`);
    database.run(`CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private calendar scope is inconsistent'); END`);
    database.run(`CREATE TRIGGER ${table}_identity BEFORE UPDATE OF id,scope_id ON ${table} WHEN OLD.id IS NOT NEW.id OR OLD.scope_id IS NOT NEW.scope_id BEGIN SELECT RAISE(ABORT,'Private calendar identity is immutable'); END`);
    if (table !== '_calendar_resource_location_current') database.run(`CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar history must be retained'); END`);
    if (immutable.includes(table)) database.run(`CREATE TRIGGER ${table}_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar evidence is immutable'); END`);
  }
  for (const old of ['_calendar_receipts', '_calendar_block_receipts', '_calendar_hold_receipts']) {
    for (const [table, other] of [[old, '_calendar_location_receipts'], ['_calendar_location_receipts', old]]) {
      database.run(`CREATE TRIGGER ${table}_locations_cross_${other} BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${other} WHERE id=NEW.id OR (scope_id=NEW.scope_id AND principal=NEW.principal AND request_id=NEW.request_id)) BEGIN SELECT RAISE(ABORT,'Private calendar request identity cannot be reused'); END`);
    }
  }
  // Append history before moving the directory pointer. Only the next revision
  // can be appended; previous labels/regions/active flags are never relabelled.
  database.run(`CREATE TRIGGER calendar_location_history_revision BEFORE INSERT ON _calendar_location_history WHEN NOT (
    (NEW.location_revision=1 AND NOT EXISTS(SELECT 1 FROM calendar_locations WHERE id=NEW.location_id)) OR
    EXISTS(SELECT 1 FROM calendar_locations WHERE id=NEW.location_id AND scope_id=NEW.scope_id AND revision=NEW.location_revision-1)
    ) BEGIN SELECT RAISE(ABORT,'Private location revision is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_location_initial BEFORE INSERT ON calendar_locations WHEN NEW.revision<>1 BEGIN SELECT RAISE(ABORT,'Private location must start at revision one'); END`);
  database.run(`CREATE TRIGGER calendar_location_revision BEFORE UPDATE ON calendar_locations WHEN NEW.revision<>OLD.revision+1 BEGIN SELECT RAISE(ABORT,'Private location revision must advance'); END`);
  for (const operation of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER calendar_location_history_parent_${operation.toLowerCase()} BEFORE ${operation} ON calendar_locations WHEN NOT EXISTS(SELECT 1 FROM _calendar_location_history WHERE scope_id=NEW.scope_id AND location_id=NEW.id AND location_revision=NEW.revision) BEGIN SELECT RAISE(ABORT,'Private location history is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_resource_location_history_revision BEFORE INSERT ON _calendar_resource_location_history WHEN NOT EXISTS(SELECT 1 FROM calendar_resources WHERE id=NEW.resource_id AND scope_id=NEW.scope_id AND revision=NEW.resource_revision) OR EXISTS(SELECT 1 FROM _calendar_resource_locations WHERE resource_id=NEW.resource_id AND scope_id=NEW.scope_id AND resource_revision>=NEW.resource_revision) BEGIN SELECT RAISE(ABORT,'Private assignment revision is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_resource_location_history_values BEFORE INSERT ON _calendar_resource_location_history WHEN EXISTS(SELECT 1 FROM json_each(NEW.location_ids_json) WHERE type<>'text') OR (SELECT count(DISTINCT value) FROM json_each(NEW.location_ids_json))<>json_array_length(NEW.location_ids_json) BEGIN SELECT RAISE(ABORT,'Private assignment membership is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_resource_location_member_parent BEFORE INSERT ON _calendar_resource_location_members WHEN NOT EXISTS(SELECT 1 FROM _calendar_resource_location_history h,json_each(h.location_ids_json) j WHERE h.scope_id=NEW.scope_id AND h.resource_id=NEW.resource_id AND h.resource_revision=NEW.resource_revision AND j.value=NEW.location_id) OR NOT EXISTS(SELECT 1 FROM calendar_locations WHERE id=NEW.location_id AND scope_id=NEW.scope_id) OR EXISTS(SELECT 1 FROM _calendar_resource_locations WHERE scope_id=NEW.scope_id AND resource_id=NEW.resource_id AND resource_revision>=NEW.resource_revision) BEGIN SELECT RAISE(ABORT,'Private assignment membership is inconsistent'); END`);
  // The pointer seals an exact immutable member set. New assignments require an
  // active location; retained inactive members remain valid directory metadata.
  for (const operation of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER calendar_resource_locations_parent_${operation.toLowerCase()} BEFORE ${operation} ON _calendar_resource_locations WHEN
    NOT EXISTS(SELECT 1 FROM calendar_resources WHERE id=NEW.resource_id AND scope_id=NEW.scope_id AND revision=NEW.resource_revision)
    OR NOT EXISTS(SELECT 1 FROM _calendar_resource_location_history h WHERE h.scope_id=NEW.scope_id AND h.resource_id=NEW.resource_id AND h.resource_revision=NEW.resource_revision AND json_array_length(h.location_ids_json)=(SELECT count(*) FROM _calendar_resource_location_members m WHERE m.scope_id=h.scope_id AND m.resource_id=h.resource_id AND m.resource_revision=h.resource_revision))
    OR EXISTS(SELECT 1 FROM _calendar_resource_location_members m JOIN calendar_locations l ON l.id=m.location_id AND l.scope_id=m.scope_id JOIN _calendar_location_history h ON h.scope_id=l.scope_id AND h.location_id=l.id AND h.location_revision=l.revision
      WHERE m.scope_id=NEW.scope_id AND m.resource_id=NEW.resource_id AND m.resource_revision=NEW.resource_revision AND h.active<>1
      AND NOT EXISTS(SELECT 1 FROM _calendar_resource_locations p JOIN _calendar_resource_location_members prior ON prior.scope_id=p.scope_id AND prior.resource_id=p.resource_id AND prior.resource_revision=p.resource_revision WHERE p.scope_id=NEW.scope_id AND p.resource_id=NEW.resource_id AND prior.location_id=m.location_id))
    BEGIN SELECT RAISE(ABORT,'Private assignment history is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_resource_locations_revision BEFORE UPDATE ON _calendar_resource_locations WHEN NEW.resource_revision<=OLD.resource_revision OR OLD.resource_id IS NOT NEW.resource_id BEGIN SELECT RAISE(ABORT,'Private assignment revision must advance'); END`);
  database.run(`CREATE TRIGGER calendar_resource_location_current_parent BEFORE INSERT ON _calendar_resource_location_current WHEN NOT EXISTS(SELECT 1 FROM _calendar_resource_locations p JOIN _calendar_resource_location_members m ON m.scope_id=p.scope_id AND m.resource_id=p.resource_id AND m.resource_revision=p.resource_revision WHERE p.scope_id=NEW.scope_id AND p.resource_id=NEW.resource_id AND p.resource_revision=NEW.resource_revision AND m.location_id=NEW.location_id) BEGIN SELECT RAISE(ABORT,'Private current assignment is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_resource_location_current_update BEFORE UPDATE ON _calendar_resource_location_current BEGIN SELECT RAISE(ABORT,'Private current assignment must be replaced'); END`);
  database.run(`CREATE TRIGGER calendar_location_receipt_parent BEFORE INSERT ON _calendar_location_receipts WHEN NOT EXISTS(SELECT 1 FROM calendar_locations WHERE id=NEW.target_id AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private location is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_location_effect_parent BEFORE INSERT ON _calendar_location_effect_intents WHEN NOT EXISTS(SELECT 1 FROM _calendar_location_receipts WHERE id=NEW.receipt_id AND scope_id=NEW.scope_id AND target_kind=NEW.target_kind AND target_id=NEW.target_id) OR NOT EXISTS(SELECT 1 FROM _calendar_location_history WHERE scope_id=NEW.scope_id AND location_id=NEW.target_id AND location_revision=NEW.revision) BEGIN SELECT RAISE(ABORT,'Private calendar receipt is inconsistent'); END`);
}
