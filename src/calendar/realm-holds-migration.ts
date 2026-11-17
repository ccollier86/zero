/** Additive 003. Existing domain/receipt generations retain their exact definitions and SQL. */
import type { Migration } from '../migrations/migrator';

export function migrateCalendarHolds(database: Parameters<Migration['up']>[0]): void {
  for (const sql of [
    'CREATE INDEX calendar_hold_range ON calendar_holds(scope_id,status,expires_ms,occupied_start_ms,id)',
    'CREATE INDEX calendar_hold_live_scope ON calendar_holds(scope_id,status,expires_ms,id)',
    'CREATE INDEX calendar_hold_live_principal ON calendar_holds(scope_id,principal,status,expires_ms,id)',
    'CREATE UNIQUE INDEX calendar_hold_appointment ON calendar_holds(scope_id,appointment_id) WHERE appointment_id IS NOT NULL',
    'CREATE UNIQUE INDEX calendar_hold_reservation_identity ON _calendar_hold_reservations(scope_id,hold_id,resource_id)',
    'CREATE INDEX calendar_hold_reservation_overlap ON _calendar_hold_reservations(scope_id,resource_id,active,expires_ms,occupied_start_ms,occupied_end_ms,hold_id)',
    'CREATE UNIQUE INDEX calendar_hold_receipt_identity ON _calendar_hold_receipts(scope_id,principal,request_id)',
    'CREATE INDEX calendar_hold_receipt_target ON _calendar_hold_receipts(scope_id,target_id,id)',
    'CREATE INDEX calendar_hold_effect_source ON _calendar_hold_effect_intents(scope_id,target_kind,target_id,revision)',
  ]) database.run(sql);
  const immutable = ['_calendar_hold_receipts', '_calendar_hold_effect_intents'];
  for (const table of ['calendar_holds', '_calendar_hold_reservations', ...immutable]) {
    const duplicate = 'id=NEW.id' + (table === '_calendar_hold_receipts' ? ' OR (scope_id=NEW.scope_id AND principal=NEW.principal AND request_id=NEW.request_id)'
      : table === '_calendar_hold_reservations' ? ' OR (scope_id=NEW.scope_id AND hold_id=NEW.hold_id AND resource_id=NEW.resource_id)' : '');
    database.run(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${duplicate}) BEGIN SELECT RAISE(ABORT,'Private calendar identity cannot be replaced'); END`);
    database.run(`CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private calendar scope is inconsistent'); END`);
    database.run(`CREATE TRIGGER ${table}_identity BEFORE UPDATE OF id,scope_id ON ${table} WHEN OLD.id IS NOT NEW.id OR OLD.scope_id IS NOT NEW.scope_id BEGIN SELECT RAISE(ABORT,'Private calendar identity is immutable'); END`);
    database.run(`CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar history must be retained'); END`);
    if (immutable.includes(table)) database.run(`CREATE TRIGGER ${table}_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar evidence is immutable'); END`);
  }
  for (const old of ['_calendar_receipts', '_calendar_block_receipts']) {
    for (const [table, other] of [[old, '_calendar_hold_receipts'], ['_calendar_hold_receipts', old]]) {
      database.run(`CREATE TRIGGER ${table}_holds_cross_${other === '_calendar_receipts' ? 'core' : other === '_calendar_block_receipts' ? 'block' : 'hold'} BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${other} WHERE id=NEW.id OR (scope_id=NEW.scope_id AND principal=NEW.principal AND request_id=NEW.request_id)) BEGIN SELECT RAISE(ABORT,'Private calendar request identity cannot be reused'); END`);
    }
  }
  database.run(`CREATE TRIGGER calendar_hold_initial BEFORE INSERT ON calendar_holds WHEN NEW.status<>'held' OR NEW.revision<>1 OR NEW.appointment_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'Private calendar hold must start held'); END`);
  const frozen = ['principal', 'created_by', 'start_at', 'end_at', 'start_ms', 'end_ms', 'time_zone', 'buffer_before', 'buffer_after', 'occupied_start_ms', 'occupied_end_ms', 'created_ms', 'expires_ms'];
  database.run(`CREATE TRIGGER calendar_hold_transition BEFORE UPDATE ON calendar_holds WHEN OLD.status<>'held' OR NEW.status NOT IN ('released','confirmed') OR NEW.revision<>OLD.revision+1 OR ${frozen.map(field => `OLD.${field} IS NOT NEW.${field}`).join(' OR ')} BEGIN SELECT RAISE(ABORT,'Private calendar hold transition is inconsistent'); END`);
  // Confirmation creates its ordinary appointment first, then consumes the hold,
  // all within one writer transaction; no intermediate state is publicly visible.
  database.run(`CREATE TRIGGER calendar_hold_confirmation BEFORE UPDATE ON calendar_holds WHEN NEW.status='confirmed' AND (
    NOT EXISTS(SELECT 1 FROM calendar_appointments a WHERE a.id=NEW.appointment_id AND a.scope_id=NEW.scope_id AND a.status='confirmed'
      AND a.created_by=NEW.created_by AND a.start_at=NEW.start_at AND a.end_at=NEW.end_at AND a.start_ms=NEW.start_ms AND a.end_ms=NEW.end_ms
      AND a.time_zone=NEW.time_zone AND a.buffer_before=NEW.buffer_before AND a.buffer_after=NEW.buffer_after
      AND a.occupied_start_ms=NEW.occupied_start_ms AND a.occupied_end_ms=NEW.occupied_end_ms)
    OR NOT EXISTS(SELECT 1 FROM _calendar_hold_reservations WHERE scope_id=NEW.scope_id AND hold_id=NEW.id)
    OR EXISTS(SELECT 1 FROM _calendar_hold_reservations h WHERE h.scope_id=NEW.scope_id AND h.hold_id=NEW.id
      AND NOT EXISTS(SELECT 1 FROM _calendar_reservations a WHERE a.scope_id=h.scope_id AND a.appointment_id=NEW.appointment_id AND a.resource_id=h.resource_id AND a.active=1))
    OR EXISTS(SELECT 1 FROM _calendar_reservations a WHERE a.scope_id=NEW.scope_id AND a.appointment_id=NEW.appointment_id
      AND NOT EXISTS(SELECT 1 FROM _calendar_hold_reservations h WHERE h.scope_id=a.scope_id AND h.hold_id=NEW.id AND h.resource_id=a.resource_id))
    ) BEGIN SELECT RAISE(ABORT,'Private calendar hold confirmation is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_hold_reservation_resource BEFORE INSERT ON _calendar_hold_reservations WHEN NOT EXISTS(SELECT 1 FROM calendar_resources WHERE id=NEW.resource_id AND scope_id=NEW.scope_id AND revision=NEW.resource_revision) BEGIN SELECT RAISE(ABORT,'Private hold resource is inconsistent'); END`);
  for (const operation of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER calendar_hold_reservation_parent_${operation.toLowerCase()} BEFORE ${operation} ON _calendar_hold_reservations WHEN NOT EXISTS(SELECT 1 FROM calendar_holds WHERE id=NEW.hold_id AND scope_id=NEW.scope_id AND occupied_start_ms=NEW.occupied_start_ms AND occupied_end_ms=NEW.occupied_end_ms AND expires_ms=NEW.expires_ms AND (status='held')=NEW.active) BEGIN SELECT RAISE(ABORT,'Private hold reservation is inconsistent'); END`);
  const reservationFields = ['hold_id', 'resource_id', 'resource_revision', 'occupied_start_ms', 'occupied_end_ms', 'expires_ms'];
  database.run(`CREATE TRIGGER calendar_hold_reservation_frozen BEFORE UPDATE ON _calendar_hold_reservations WHEN OLD.active<>1 OR NEW.active<>0 OR ${reservationFields.map(field => `OLD.${field} IS NOT NEW.${field}`).join(' OR ')} BEGIN SELECT RAISE(ABORT,'Private hold reservation is immutable'); END`);
  // The immutable acquisition receipt seals membership after all reservations
  // have been created in its source transaction. No later append may expand it.
  database.run(`CREATE TRIGGER calendar_hold_reservation_sealed BEFORE INSERT ON _calendar_hold_reservations WHEN EXISTS(SELECT 1 FROM _calendar_hold_receipts WHERE scope_id=NEW.scope_id AND target_id=NEW.hold_id) BEGIN SELECT RAISE(ABORT,'Private hold resource membership is sealed'); END`);
  database.run(`CREATE TRIGGER calendar_hold_receipt_parent BEFORE INSERT ON _calendar_hold_receipts WHEN NOT EXISTS(SELECT 1 FROM calendar_holds WHERE id=NEW.target_id AND scope_id=NEW.scope_id) OR (SELECT count(*) FROM _calendar_hold_reservations WHERE scope_id=NEW.scope_id AND hold_id=NEW.target_id) NOT BETWEEN 1 AND 16 BEGIN SELECT RAISE(ABORT,'Private calendar hold is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_hold_effect_parent BEFORE INSERT ON _calendar_hold_effect_intents WHEN NOT EXISTS(SELECT 1 FROM _calendar_hold_receipts WHERE id=NEW.receipt_id AND scope_id=NEW.scope_id AND target_kind=NEW.target_kind AND target_id=NEW.target_id) BEGIN SELECT RAISE(ABORT,'Private calendar receipt is inconsistent'); END`);
}
