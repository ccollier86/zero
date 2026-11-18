/** Additive 008. Opaque canonical references are domain facts, never cached Guardian authority. */
import type { Migration } from '../migrations/migrator';
import type { TableSchema } from '../sync/types';
import { CALENDAR_VISIT_TABLES } from './realm-visit-bindings-migration';

const references = "TEXT NOT NULL CHECK(length(references_json)<=20000 AND json_valid(references_json) AND json_type(references_json)='array' AND json_array_length(references_json)<=100)";
export const CALENDAR_PARTICIPANT_ADDITIONS: Record<string, TableSchema> = {
  _calendar_appointment_participant_bindings: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', appointment_id: 'TEXT NOT NULL REFERENCES calendar_appointments(id)',
    appointment_revision: 'INTEGER NOT NULL CHECK(appointment_revision>0)', references_json: references },
  _calendar_appointment_participant_current: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', appointment_id: 'TEXT NOT NULL REFERENCES calendar_appointments(id)',
    binding_id: 'TEXT NOT NULL REFERENCES _calendar_appointment_participant_bindings(id)' },
  _calendar_hold_participant_bindings: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', hold_id: 'TEXT NOT NULL REFERENCES calendar_holds(id)', references_json: references },
};
export const CALENDAR_PARTICIPANT_TABLES: Record<string, TableSchema> = { ...CALENDAR_VISIT_TABLES, ...CALENDAR_PARTICIPANT_ADDITIONS };

export function migrateCalendarParticipantBindings(database: Parameters<Migration['up']>[0]): void {
  database.run('CREATE UNIQUE INDEX calendar_appointment_participant_binding_identity ON _calendar_appointment_participant_bindings(scope_id,appointment_id,appointment_revision)');
  database.run('CREATE UNIQUE INDEX calendar_appointment_participant_current_identity ON _calendar_appointment_participant_current(scope_id,appointment_id)');
  database.run('CREATE UNIQUE INDEX calendar_hold_participant_binding_identity ON _calendar_hold_participant_bindings(scope_id,hold_id)');
  for (const table of Object.keys(CALENDAR_PARTICIPANT_ADDITIONS)) {
    const parent = table === '_calendar_hold_participant_bindings' ? 'hold_id' : 'appointment_id';
    const duplicate = table === '_calendar_appointment_participant_bindings'
      ? ' OR (scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id AND appointment_revision=NEW.appointment_revision)'
      : ` OR (scope_id=NEW.scope_id AND ${parent}=NEW.${parent})`;
    database.run(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=NEW.id${duplicate}) BEGIN SELECT RAISE(ABORT,'Private calendar identity cannot be replaced'); END`);
    database.run(`CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private calendar scope is inconsistent'); END`);
    database.run(`CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar history must be retained'); END`);
    if (table !== '_calendar_appointment_participant_current') database.run(`CREATE TRIGGER ${table}_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar evidence is immutable'); END`);
    else database.run(`CREATE TRIGGER ${table}_identity BEFORE UPDATE OF id,scope_id,appointment_id ON ${table} WHEN OLD.id IS NOT NEW.id OR OLD.scope_id IS NOT NEW.scope_id OR OLD.appointment_id IS NOT NEW.appointment_id BEGIN SELECT RAISE(ABORT,'Private calendar identity is immutable'); END`);
  }
  for (const table of ['_calendar_appointment_participant_bindings', '_calendar_hold_participant_bindings']) {
    // This proves only bounded canonical wire structure. SYSTEM membership and
    // current subject policy are checked by the trusted parent's final fence.
    database.run(`CREATE TRIGGER ${table}_references BEFORE INSERT ON ${table} WHEN EXISTS(
      SELECT 1 FROM json_each(NEW.references_json) r WHERE r.type<>'object'
      OR json_type(r.value,'$.kind') IS NOT 'text' OR json_extract(r.value,'$.kind') IS NOT 'guardian-user'
      OR json_type(r.value,'$.userId') IS NOT 'text' OR length(json_extract(r.value,'$.userId')) NOT BETWEEN 1 AND 128
      OR json_extract(r.value,'$.userId') GLOB '*[^A-Za-z0-9._:-]*' OR substr(json_extract(r.value,'$.userId'),1,1) NOT GLOB '[A-Za-z0-9]'
      OR (SELECT count(*) FROM json_each(r.value))<>2 OR EXISTS(SELECT 1 FROM json_each(r.value) f WHERE f.key NOT IN ('kind','userId')))
      OR NEW.references_json<>(SELECT json_group_array(json_object('kind','guardian-user','userId',user_id)) FROM
        (SELECT DISTINCT json_extract(value,'$.userId') AS user_id FROM json_each(NEW.references_json) ORDER BY user_id))
      BEGIN SELECT RAISE(ABORT,'Private participant references are inconsistent'); END`);
  }
  database.run(`CREATE TRIGGER calendar_appointment_participant_binding_parent BEFORE INSERT ON _calendar_appointment_participant_bindings WHEN
    NOT EXISTS(SELECT 1 FROM calendar_appointments WHERE id=NEW.appointment_id AND scope_id=NEW.scope_id AND revision=NEW.appointment_revision AND status='confirmed')
    OR EXISTS(SELECT 1 FROM _calendar_appointment_participant_bindings WHERE scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id AND appointment_revision>=NEW.appointment_revision)
    OR EXISTS(SELECT 1 FROM _calendar_effect_intents WHERE scope_id=NEW.scope_id AND target_kind='appointment' AND target_id=NEW.appointment_id AND revision=NEW.appointment_revision)
    BEGIN SELECT RAISE(ABORT,'Private appointment participant generation is sealed'); END`);
  for (const operation of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER calendar_appointment_participant_current_parent_${operation.toLowerCase()} BEFORE ${operation} ON _calendar_appointment_participant_current WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_appointment_participant_bindings b JOIN calendar_appointments a ON a.scope_id=b.scope_id AND a.id=b.appointment_id
    WHERE b.id=NEW.binding_id AND b.scope_id=NEW.scope_id AND b.appointment_id=NEW.appointment_id AND a.status='confirmed' AND a.revision=b.appointment_revision
      AND NOT EXISTS(SELECT 1 FROM _calendar_effect_intents e WHERE e.scope_id=b.scope_id AND e.target_kind='appointment' AND e.target_id=b.appointment_id AND e.revision=b.appointment_revision))
    BEGIN SELECT RAISE(ABORT,'Private appointment participant pointer is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_appointment_participant_current_forward BEFORE UPDATE ON _calendar_appointment_participant_current WHEN
    (SELECT appointment_revision FROM _calendar_appointment_participant_bindings WHERE id=NEW.binding_id)<=(SELECT appointment_revision FROM _calendar_appointment_participant_bindings WHERE id=OLD.binding_id)
    BEGIN SELECT RAISE(ABORT,'Private appointment participant pointer must advance'); END`);
  database.run(`CREATE TRIGGER calendar_hold_participant_binding_parent BEFORE INSERT ON _calendar_hold_participant_bindings WHEN
    NOT EXISTS(SELECT 1 FROM calendar_holds WHERE id=NEW.hold_id AND scope_id=NEW.scope_id AND revision=1 AND status='held')
    OR EXISTS(SELECT 1 FROM _calendar_hold_effect_intents WHERE scope_id=NEW.scope_id AND target_kind='hold' AND target_id=NEW.hold_id)
    BEGIN SELECT RAISE(ABORT,'Private hold participant generation is sealed'); END`);
  database.run(`CREATE TRIGGER calendar_hold_confirmed_participant_parent BEFORE UPDATE ON calendar_holds WHEN NEW.status='confirmed' AND OLD.status<>'confirmed' AND (
    EXISTS(SELECT 1 FROM _calendar_hold_participant_bindings h WHERE h.scope_id=NEW.scope_id AND h.hold_id=NEW.id AND NOT EXISTS(
      SELECT 1 FROM _calendar_appointment_participant_current p JOIN _calendar_appointment_participant_bindings a ON a.id=p.binding_id AND a.scope_id=p.scope_id AND a.appointment_id=p.appointment_id
      WHERE p.scope_id=NEW.scope_id AND p.appointment_id=NEW.appointment_id AND a.appointment_revision=1 AND a.references_json=h.references_json))
    OR EXISTS(SELECT 1 FROM _calendar_appointment_participant_current p JOIN _calendar_appointment_participant_bindings a ON a.id=p.binding_id AND a.scope_id=p.scope_id AND a.appointment_id=p.appointment_id
      WHERE p.scope_id=NEW.scope_id AND p.appointment_id=NEW.appointment_id AND NOT EXISTS(
        SELECT 1 FROM _calendar_hold_participant_bindings h WHERE h.scope_id=NEW.scope_id AND h.hold_id=NEW.id AND h.references_json=a.references_json)))
    BEGIN SELECT RAISE(ABORT,'Private hold participant transfer is inconsistent'); END`);
}
