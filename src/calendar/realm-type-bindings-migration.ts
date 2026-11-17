/** Binding tables are part of additive 005, not a second migration generation. */
import type { Migration } from '../migrations/migrator';
import type { TableSchema } from '../sync/types';

export const CALENDAR_TYPE_BINDING_TABLES: Record<string, TableSchema> = {
  _calendar_appointment_type_bindings: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', appointment_id: 'TEXT NOT NULL REFERENCES calendar_appointments(id)',
    appointment_revision: 'INTEGER NOT NULL CHECK(appointment_revision>0)', type_id: 'TEXT',
    type_revision: 'INTEGER CHECK((type_id IS NULL AND type_revision IS NULL) OR (type_id IS NOT NULL AND type_revision IS NOT NULL AND type_revision>0))' },
  _calendar_appointment_type_current: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', appointment_id: 'TEXT NOT NULL REFERENCES calendar_appointments(id)',
    binding_id: 'TEXT NOT NULL REFERENCES _calendar_appointment_type_bindings(id)' },
  _calendar_hold_type_bindings: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', hold_id: 'TEXT NOT NULL REFERENCES calendar_holds(id)',
    type_id: 'TEXT NOT NULL', type_revision: 'INTEGER NOT NULL CHECK(type_revision>0)' },
};

export function migrateCalendarTypeBindings(database: Parameters<Migration['up']>[0]): void {
  database.run('CREATE UNIQUE INDEX calendar_appointment_type_binding_identity ON _calendar_appointment_type_bindings(scope_id,appointment_id,appointment_revision)');
  database.run('CREATE UNIQUE INDEX calendar_appointment_type_current_identity ON _calendar_appointment_type_current(scope_id,appointment_id)');
  database.run('CREATE UNIQUE INDEX calendar_hold_type_binding_identity ON _calendar_hold_type_bindings(scope_id,hold_id)');
  for (const table of Object.keys(CALENDAR_TYPE_BINDING_TABLES)) {
    const parent = table === '_calendar_hold_type_bindings' ? 'hold_id' : 'appointment_id';
    const duplicate = table === '_calendar_appointment_type_bindings'
      ? ' OR (scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id AND appointment_revision=NEW.appointment_revision)'
      : ` OR (scope_id=NEW.scope_id AND ${parent}=NEW.${parent})`;
    database.run(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=NEW.id${duplicate}) BEGIN SELECT RAISE(ABORT,'Private calendar identity cannot be replaced'); END`);
    database.run(`CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private calendar scope is inconsistent'); END`);
    database.run(`CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar history must be retained'); END`);
    if (table !== '_calendar_appointment_type_current') database.run(`CREATE TRIGGER ${table}_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar evidence is immutable'); END`);
    else database.run(`CREATE TRIGGER ${table}_identity BEFORE UPDATE OF id,scope_id,appointment_id ON ${table} WHEN OLD.id IS NOT NEW.id OR OLD.scope_id IS NOT NEW.scope_id OR OLD.appointment_id IS NOT NEW.appointment_id BEGIN SELECT RAISE(ABORT,'Private calendar identity is immutable'); END`);
  }
  database.run(`CREATE TRIGGER calendar_appointment_type_binding_parent BEFORE INSERT ON _calendar_appointment_type_bindings WHEN
    NOT EXISTS(SELECT 1 FROM calendar_appointments WHERE id=NEW.appointment_id AND scope_id=NEW.scope_id AND revision=NEW.appointment_revision AND status='confirmed')
    OR EXISTS(SELECT 1 FROM _calendar_appointment_type_bindings WHERE scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id AND appointment_revision>=NEW.appointment_revision)
    OR EXISTS(SELECT 1 FROM _calendar_effect_intents WHERE scope_id=NEW.scope_id AND target_kind='appointment' AND target_id=NEW.appointment_id AND revision=NEW.appointment_revision)
    OR (NEW.type_id IS NULL AND NEW.appointment_revision=1)
    BEGIN SELECT RAISE(ABORT,'Private appointment type generation is sealed'); END`);
  for (const table of ['_calendar_appointment_type_bindings', '_calendar_hold_type_bindings']) database.run(`CREATE TRIGGER ${table}_type_parent BEFORE INSERT ON ${table} WHEN NEW.type_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM _calendar_type_history WHERE scope_id=NEW.scope_id AND type_id=NEW.type_id AND type_revision=NEW.type_revision) BEGIN SELECT RAISE(ABORT,'Private appointment type history is inconsistent'); END`);
  for (const [table, parents, identity] of [['_calendar_appointment_type_bindings', 'calendar_appointments', 'appointment_id'], ['_calendar_hold_type_bindings', 'calendar_holds', 'hold_id']]) database.run(`CREATE TRIGGER ${table}_interval BEFORE INSERT ON ${table} WHEN NEW.type_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM _calendar_type_history h JOIN ${parents} p ON p.scope_id=h.scope_id
    WHERE p.id=NEW.${identity} AND h.scope_id=NEW.scope_id AND h.type_id=NEW.type_id AND h.type_revision=NEW.type_revision
      AND p.end_ms-p.start_ms=h.duration_minutes*60000 AND p.buffer_before=h.buffer_before AND p.buffer_after=h.buffer_after)
    BEGIN SELECT RAISE(ABORT,'Private appointment type interval is inconsistent'); END`);
  for (const operation of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER calendar_appointment_type_current_parent_${operation.toLowerCase()} BEFORE ${operation} ON _calendar_appointment_type_current WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_appointment_type_bindings b JOIN calendar_appointments a ON a.scope_id=b.scope_id AND a.id=b.appointment_id
    WHERE b.id=NEW.binding_id AND b.scope_id=NEW.scope_id AND b.appointment_id=NEW.appointment_id AND a.status='confirmed' AND a.revision=b.appointment_revision
      AND NOT EXISTS(SELECT 1 FROM _calendar_effect_intents e WHERE e.scope_id=b.scope_id AND e.target_kind='appointment' AND e.target_id=b.appointment_id AND e.revision=b.appointment_revision))
    BEGIN SELECT RAISE(ABORT,'Private appointment type pointer is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_appointment_type_current_forward BEFORE UPDATE ON _calendar_appointment_type_current WHEN
    (SELECT appointment_revision FROM _calendar_appointment_type_bindings WHERE id=NEW.binding_id)<=(SELECT appointment_revision FROM _calendar_appointment_type_bindings WHERE id=OLD.binding_id)
    BEGIN SELECT RAISE(ABORT,'Private appointment type pointer must advance'); END`);
  database.run(`CREATE TRIGGER calendar_hold_type_binding_parent BEFORE INSERT ON _calendar_hold_type_bindings WHEN
    NOT EXISTS(SELECT 1 FROM calendar_holds WHERE id=NEW.hold_id AND scope_id=NEW.scope_id AND revision=1 AND status='held')
    OR EXISTS(SELECT 1 FROM _calendar_hold_effect_intents WHERE scope_id=NEW.scope_id AND target_kind='hold' AND target_id=NEW.hold_id)
    BEGIN SELECT RAISE(ABORT,'Private hold type generation is sealed'); END`);
  database.run(`CREATE TRIGGER calendar_hold_confirmed_type_parent BEFORE UPDATE ON calendar_holds WHEN NEW.status='confirmed' AND OLD.status<>'confirmed' AND (
    EXISTS(SELECT 1 FROM _calendar_hold_type_bindings h WHERE h.scope_id=NEW.scope_id AND h.hold_id=NEW.id AND NOT EXISTS(
      SELECT 1 FROM _calendar_appointment_type_current p JOIN _calendar_appointment_type_bindings a ON a.id=p.binding_id AND a.scope_id=p.scope_id AND a.appointment_id=p.appointment_id
      WHERE p.scope_id=NEW.scope_id AND p.appointment_id=NEW.appointment_id AND a.type_id=h.type_id AND a.type_revision=h.type_revision))
    OR EXISTS(SELECT 1 FROM _calendar_appointment_type_current p JOIN _calendar_appointment_type_bindings a ON a.id=p.binding_id AND a.scope_id=p.scope_id AND a.appointment_id=p.appointment_id
      WHERE p.scope_id=NEW.scope_id AND p.appointment_id=NEW.appointment_id AND a.type_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM _calendar_hold_type_bindings h WHERE h.scope_id=NEW.scope_id AND h.hold_id=NEW.id AND h.type_id=a.type_id AND h.type_revision=a.type_revision)))
    BEGIN SELECT RAISE(ABORT,'Private hold type transfer is inconsistent'); END`);
}
