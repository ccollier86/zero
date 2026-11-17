/** Additive 005. Catalog history, policy evidence and typed booking bindings. */
import type { Migration } from '../migrations/migrator';
import { migrateCalendarTypeBindings } from './realm-type-bindings-migration';

export function migrateCalendarTypes(database: Parameters<Migration['up']>[0]): void {
  for (const sql of [
    'CREATE INDEX calendar_type_catalog ON calendar_types(scope_id,id)',
    'CREATE UNIQUE INDEX calendar_type_history_identity ON _calendar_type_history(scope_id,type_id,type_revision)',
    'CREATE UNIQUE INDEX calendar_resource_type_history_identity ON _calendar_resource_type_history(scope_id,resource_id,resource_revision)',
    'CREATE UNIQUE INDEX calendar_resource_type_member_identity ON _calendar_resource_type_members(scope_id,resource_id,resource_revision,type_id)',
    'CREATE INDEX calendar_resource_type_member_lookup ON _calendar_resource_type_members(scope_id,type_id,resource_id,resource_revision)',
    'CREATE UNIQUE INDEX calendar_resource_types_identity ON _calendar_resource_types(scope_id,resource_id)',
    'CREATE UNIQUE INDEX calendar_type_receipt_identity ON _calendar_type_receipts(scope_id,principal,request_id)',
    'CREATE INDEX calendar_type_effect_source ON _calendar_type_effect_intents(scope_id,target_kind,target_id,revision)',
  ]) database.run(sql);
  const immutable = ['_calendar_type_history', '_calendar_resource_type_history', '_calendar_resource_type_members', '_calendar_type_receipts', '_calendar_type_effect_intents'];
  for (const table of ['calendar_types', '_calendar_resource_types', ...immutable]) {
    const duplicate = 'id=NEW.id' + (table === '_calendar_type_history' ? ' OR (scope_id=NEW.scope_id AND type_id=NEW.type_id AND type_revision=NEW.type_revision)'
      : table === '_calendar_resource_type_history' ? ' OR (scope_id=NEW.scope_id AND resource_id=NEW.resource_id AND resource_revision=NEW.resource_revision)'
      : table === '_calendar_resource_type_members' ? ' OR (scope_id=NEW.scope_id AND resource_id=NEW.resource_id AND resource_revision=NEW.resource_revision AND type_id=NEW.type_id)'
      : table === '_calendar_resource_types' ? ' OR (scope_id=NEW.scope_id AND resource_id=NEW.resource_id)'
      : table === '_calendar_type_receipts' ? ' OR (scope_id=NEW.scope_id AND principal=NEW.principal AND request_id=NEW.request_id)' : '');
    database.run(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${duplicate}) BEGIN SELECT RAISE(ABORT,'Private calendar identity cannot be replaced'); END`);
    database.run(`CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private calendar scope is inconsistent'); END`);
    database.run(`CREATE TRIGGER ${table}_identity BEFORE UPDATE OF id,scope_id ON ${table} WHEN OLD.id IS NOT NEW.id OR OLD.scope_id IS NOT NEW.scope_id BEGIN SELECT RAISE(ABORT,'Private calendar identity is immutable'); END`);
    database.run(`CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar history must be retained'); END`);
    if (immutable.includes(table)) database.run(`CREATE TRIGGER ${table}_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar evidence is immutable'); END`);
  }
  // The fifth store shares one global per-principal request namespace with all
  // earlier families. Existing receipt/effect definitions remain untouched.
  for (const old of ['_calendar_receipts', '_calendar_block_receipts', '_calendar_hold_receipts', '_calendar_location_receipts']) {
    for (const [table, other] of [[old, '_calendar_type_receipts'], ['_calendar_type_receipts', old]]) {
      database.run(`CREATE TRIGGER ${table}_types_cross_${other} BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${other} WHERE id=NEW.id OR (scope_id=NEW.scope_id AND principal=NEW.principal AND request_id=NEW.request_id)) BEGIN SELECT RAISE(ABORT,'Private calendar request identity cannot be reused'); END`);
    }
  }
  database.run(`CREATE TRIGGER calendar_type_history_revision BEFORE INSERT ON _calendar_type_history WHEN NOT (
    (NEW.type_revision=1 AND NOT EXISTS(SELECT 1 FROM calendar_types WHERE id=NEW.type_id)) OR
    EXISTS(SELECT 1 FROM calendar_types WHERE id=NEW.type_id AND scope_id=NEW.scope_id AND revision=NEW.type_revision-1)
    ) BEGIN SELECT RAISE(ABORT,'Private type revision is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_type_initial BEFORE INSERT ON calendar_types WHEN NEW.revision<>1 BEGIN SELECT RAISE(ABORT,'Private type must start at revision one'); END`);
  database.run(`CREATE TRIGGER calendar_type_revision BEFORE UPDATE ON calendar_types WHEN NEW.revision<>OLD.revision+1 BEGIN SELECT RAISE(ABORT,'Private type revision must advance'); END`);
  for (const operation of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER calendar_type_history_parent_${operation.toLowerCase()} BEFORE ${operation} ON calendar_types WHEN NOT EXISTS(SELECT 1 FROM _calendar_type_history WHERE scope_id=NEW.scope_id AND type_id=NEW.id AND type_revision=NEW.revision) BEGIN SELECT RAISE(ABORT,'Private type history is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_resource_type_history_revision BEFORE INSERT ON _calendar_resource_type_history WHEN NOT EXISTS(SELECT 1 FROM calendar_resources WHERE id=NEW.resource_id AND scope_id=NEW.scope_id AND revision=NEW.resource_revision) OR EXISTS(SELECT 1 FROM _calendar_resource_types WHERE resource_id=NEW.resource_id AND scope_id=NEW.scope_id AND resource_revision>=NEW.resource_revision) OR EXISTS(SELECT 1 FROM _calendar_effect_intents WHERE scope_id=NEW.scope_id AND target_kind='resource' AND target_id=NEW.resource_id AND revision=NEW.resource_revision) BEGIN SELECT RAISE(ABORT,'Private type policy revision is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_resource_type_history_values BEFORE INSERT ON _calendar_resource_type_history WHEN EXISTS(SELECT 1 FROM json_each(NEW.type_ids_json) WHERE type<>'text') OR (SELECT count(DISTINCT value) FROM json_each(NEW.type_ids_json))<>json_array_length(NEW.type_ids_json) BEGIN SELECT RAISE(ABORT,'Private type policy membership is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_resource_type_member_parent BEFORE INSERT ON _calendar_resource_type_members WHEN NOT EXISTS(SELECT 1 FROM _calendar_resource_type_history h,json_each(h.type_ids_json) j WHERE h.scope_id=NEW.scope_id AND h.resource_id=NEW.resource_id AND h.resource_revision=NEW.resource_revision AND j.value=NEW.type_id) OR NOT EXISTS(SELECT 1 FROM calendar_types WHERE id=NEW.type_id AND scope_id=NEW.scope_id) OR EXISTS(SELECT 1 FROM _calendar_resource_types WHERE scope_id=NEW.scope_id AND resource_id=NEW.resource_id AND resource_revision>=NEW.resource_revision) OR EXISTS(SELECT 1 FROM _calendar_effect_intents WHERE scope_id=NEW.scope_id AND target_kind='resource' AND target_id=NEW.resource_id AND revision=NEW.resource_revision) BEGIN SELECT RAISE(ABORT,'Private type policy membership is inconsistent'); END`);
  // The pointer seals the exact immutable member set. Deactivated types may be
  // retained or removed, but cannot newly enter another current policy.
  for (const operation of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER calendar_resource_types_parent_${operation.toLowerCase()} BEFORE ${operation} ON _calendar_resource_types WHEN
    NOT EXISTS(SELECT 1 FROM calendar_resources WHERE id=NEW.resource_id AND scope_id=NEW.scope_id AND revision=NEW.resource_revision)
    OR EXISTS(SELECT 1 FROM _calendar_effect_intents WHERE scope_id=NEW.scope_id AND target_kind='resource' AND target_id=NEW.resource_id AND revision=NEW.resource_revision)
    OR NOT EXISTS(SELECT 1 FROM _calendar_resource_type_history h WHERE h.scope_id=NEW.scope_id AND h.resource_id=NEW.resource_id AND h.resource_revision=NEW.resource_revision AND json_array_length(h.type_ids_json)=(SELECT count(*) FROM _calendar_resource_type_members m WHERE m.scope_id=h.scope_id AND m.resource_id=h.resource_id AND m.resource_revision=h.resource_revision))
    OR EXISTS(SELECT 1 FROM _calendar_resource_type_members m JOIN calendar_types t ON t.id=m.type_id AND t.scope_id=m.scope_id JOIN _calendar_type_history h ON h.scope_id=t.scope_id AND h.type_id=t.id AND h.type_revision=t.revision
      WHERE m.scope_id=NEW.scope_id AND m.resource_id=NEW.resource_id AND m.resource_revision=NEW.resource_revision AND h.active<>1
      AND NOT EXISTS(SELECT 1 FROM _calendar_resource_types p JOIN _calendar_resource_type_members prior ON prior.scope_id=p.scope_id AND prior.resource_id=p.resource_id AND prior.resource_revision=p.resource_revision WHERE p.scope_id=NEW.scope_id AND p.resource_id=NEW.resource_id AND prior.type_id=m.type_id))
    BEGIN SELECT RAISE(ABORT,'Private type policy history is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_resource_types_revision BEFORE UPDATE ON _calendar_resource_types WHEN NEW.resource_revision<=OLD.resource_revision OR OLD.resource_id IS NOT NEW.resource_id BEGIN SELECT RAISE(ABORT,'Private type policy revision must advance'); END`);
  database.run(`CREATE TRIGGER calendar_type_receipt_parent BEFORE INSERT ON _calendar_type_receipts WHEN NOT EXISTS(SELECT 1 FROM calendar_types WHERE id=NEW.target_id AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private type is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_type_effect_parent BEFORE INSERT ON _calendar_type_effect_intents WHEN NOT EXISTS(SELECT 1 FROM _calendar_type_receipts WHERE id=NEW.receipt_id AND scope_id=NEW.scope_id AND target_kind=NEW.target_kind AND target_id=NEW.target_id) OR NOT EXISTS(SELECT 1 FROM _calendar_type_history WHERE scope_id=NEW.scope_id AND type_id=NEW.target_id AND type_revision=NEW.revision) BEGIN SELECT RAISE(ABORT,'Private calendar receipt is inconsistent'); END`);
  migrateCalendarTypeBindings(database);
}
