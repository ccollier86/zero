/** Additive 007. Visit facts are private assignment metadata, never geographic authority. */
import type { Migration } from '../migrations/migrator';
import type { TableSchema } from '../sync/types';
import { CALENDAR_LIFECYCLE_TABLES } from './realm-lifecycle-migration';

const visitColumns: TableSchema = {
  visit_mode: "TEXT CHECK(visit_mode IS NULL OR visit_mode IN ('in-person','video','phone'))",
  location_id: 'TEXT',
  location_revision: "INTEGER CHECK((visit_mode IS NULL AND location_id IS NULL AND location_revision IS NULL) OR (visit_mode IS NOT NULL AND ((visit_mode IN ('video','phone') AND location_id IS NULL AND location_revision IS NULL) OR (visit_mode='in-person' AND location_id IS NOT NULL AND location_revision IS NOT NULL AND location_revision>0))))",
};
export const CALENDAR_VISIT_ADDITIONS: Record<string, TableSchema> = {
  _calendar_appointment_visit_bindings: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', appointment_id: 'TEXT NOT NULL REFERENCES calendar_appointments(id)',
    appointment_revision: 'INTEGER NOT NULL CHECK(appointment_revision>0)', ...visitColumns },
  _calendar_appointment_visit_current: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', appointment_id: 'TEXT NOT NULL REFERENCES calendar_appointments(id)',
    binding_id: 'TEXT NOT NULL REFERENCES _calendar_appointment_visit_bindings(id)' },
  _calendar_hold_visit_bindings: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', hold_id: 'TEXT NOT NULL REFERENCES calendar_holds(id)', ...visitColumns },
};
export const CALENDAR_VISIT_TABLES: Record<string, TableSchema> = { ...CALENDAR_LIFECYCLE_TABLES, ...CALENDAR_VISIT_ADDITIONS };

export function migrateCalendarVisitBindings(database: Parameters<Migration['up']>[0]): void {
  database.run('CREATE UNIQUE INDEX calendar_appointment_visit_binding_identity ON _calendar_appointment_visit_bindings(scope_id,appointment_id,appointment_revision)');
  database.run('CREATE UNIQUE INDEX calendar_appointment_visit_current_identity ON _calendar_appointment_visit_current(scope_id,appointment_id)');
  database.run('CREATE UNIQUE INDEX calendar_hold_visit_binding_identity ON _calendar_hold_visit_bindings(scope_id,hold_id)');
  for (const table of Object.keys(CALENDAR_VISIT_ADDITIONS)) {
    const parent = table === '_calendar_hold_visit_bindings' ? 'hold_id' : 'appointment_id';
    const duplicate = table === '_calendar_appointment_visit_bindings'
      ? ' OR (scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id AND appointment_revision=NEW.appointment_revision)'
      : ` OR (scope_id=NEW.scope_id AND ${parent}=NEW.${parent})`;
    database.run(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=NEW.id${duplicate}) BEGIN SELECT RAISE(ABORT,'Private calendar identity cannot be replaced'); END`);
    database.run(`CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private calendar scope is inconsistent'); END`);
    database.run(`CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar history must be retained'); END`);
    if (table !== '_calendar_appointment_visit_current') database.run(`CREATE TRIGGER ${table}_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar evidence is immutable'); END`);
    else database.run(`CREATE TRIGGER ${table}_identity BEFORE UPDATE OF id,scope_id,appointment_id ON ${table} WHEN OLD.id IS NOT NEW.id OR OLD.scope_id IS NOT NEW.scope_id OR OLD.appointment_id IS NOT NEW.appointment_id BEGIN SELECT RAISE(ABORT,'Private calendar identity is immutable'); END`);
  }
  for (const table of ['_calendar_appointment_visit_bindings', '_calendar_hold_visit_bindings']) database.run(`CREATE TRIGGER ${table}_location_parent BEFORE INSERT ON ${table} WHEN NEW.visit_mode='in-person' AND NOT EXISTS(
    SELECT 1 FROM _calendar_location_history WHERE scope_id=NEW.scope_id AND location_id=NEW.location_id AND location_revision=NEW.location_revision AND active=1)
    BEGIN SELECT RAISE(ABORT,'Private visit location history is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_appointment_visit_binding_parent BEFORE INSERT ON _calendar_appointment_visit_bindings WHEN
    NOT EXISTS(SELECT 1 FROM calendar_appointments WHERE id=NEW.appointment_id AND scope_id=NEW.scope_id AND revision=NEW.appointment_revision AND status='confirmed')
    OR EXISTS(SELECT 1 FROM _calendar_appointment_visit_bindings WHERE scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id AND appointment_revision>=NEW.appointment_revision)
    OR EXISTS(SELECT 1 FROM _calendar_effect_intents WHERE scope_id=NEW.scope_id AND target_kind='appointment' AND target_id=NEW.appointment_id AND revision=NEW.appointment_revision)
    OR (NEW.visit_mode IS NULL AND NEW.appointment_revision=1)
    BEGIN SELECT RAISE(ABORT,'Private appointment visit generation is sealed'); END`);
  for (const operation of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER calendar_appointment_visit_current_parent_${operation.toLowerCase()} BEFORE ${operation} ON _calendar_appointment_visit_current WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_appointment_visit_bindings b JOIN calendar_appointments a ON a.scope_id=b.scope_id AND a.id=b.appointment_id
    WHERE b.id=NEW.binding_id AND b.scope_id=NEW.scope_id AND b.appointment_id=NEW.appointment_id AND a.status='confirmed' AND a.revision=b.appointment_revision
      AND NOT EXISTS(SELECT 1 FROM _calendar_effect_intents e WHERE e.scope_id=b.scope_id AND e.target_kind='appointment' AND e.target_id=b.appointment_id AND e.revision=b.appointment_revision))
    BEGIN SELECT RAISE(ABORT,'Private appointment visit pointer is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_appointment_visit_current_forward BEFORE UPDATE ON _calendar_appointment_visit_current WHEN
    (SELECT appointment_revision FROM _calendar_appointment_visit_bindings WHERE id=NEW.binding_id)<=(SELECT appointment_revision FROM _calendar_appointment_visit_bindings WHERE id=OLD.binding_id)
    BEGIN SELECT RAISE(ABORT,'Private appointment visit pointer must advance'); END`);
  database.run(`CREATE TRIGGER calendar_hold_visit_binding_parent BEFORE INSERT ON _calendar_hold_visit_bindings WHEN NEW.visit_mode IS NULL
    OR NOT EXISTS(SELECT 1 FROM calendar_holds WHERE id=NEW.hold_id AND scope_id=NEW.scope_id AND revision=1 AND status='held')
    OR EXISTS(SELECT 1 FROM _calendar_hold_effect_intents WHERE scope_id=NEW.scope_id AND target_kind='hold' AND target_id=NEW.hold_id)
    BEGIN SELECT RAISE(ABORT,'Private hold visit generation is sealed'); END`);
  database.run(`CREATE TRIGGER calendar_hold_confirmed_visit_parent BEFORE UPDATE ON calendar_holds WHEN NEW.status='confirmed' AND OLD.status<>'confirmed' AND (
    EXISTS(SELECT 1 FROM _calendar_hold_visit_bindings h WHERE h.scope_id=NEW.scope_id AND h.hold_id=NEW.id AND NOT EXISTS(
      SELECT 1 FROM _calendar_appointment_visit_current p JOIN _calendar_appointment_visit_bindings a ON a.id=p.binding_id AND a.scope_id=p.scope_id AND a.appointment_id=p.appointment_id
      WHERE p.scope_id=NEW.scope_id AND p.appointment_id=NEW.appointment_id AND a.visit_mode IS h.visit_mode AND a.location_id IS h.location_id AND a.location_revision IS h.location_revision))
    OR EXISTS(SELECT 1 FROM _calendar_appointment_visit_current p JOIN _calendar_appointment_visit_bindings a ON a.id=p.binding_id AND a.scope_id=p.scope_id AND a.appointment_id=p.appointment_id
      WHERE p.scope_id=NEW.scope_id AND p.appointment_id=NEW.appointment_id AND a.visit_mode IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM _calendar_hold_visit_bindings h WHERE h.scope_id=NEW.scope_id AND h.hold_id=NEW.id AND h.visit_mode IS a.visit_mode AND h.location_id IS a.location_id AND h.location_revision IS a.location_revision)))
    BEGIN SELECT RAISE(ABORT,'Private hold visit transfer is inconsistent'); END`);
}
