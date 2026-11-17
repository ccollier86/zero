/** Additive 006. Lifecycle facts never rewrite the original occupancy status domain. */
import type { Migration } from '../migrations/migrator';
import type { TableSchema } from '../sync/types';
import { CALENDAR_TYPE_TABLES } from './realm-schema';

export const CALENDAR_LIFECYCLE_ADDITIONS: Record<string, TableSchema> = {
  _calendar_lifecycle_policy_history: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', policy_revision: 'INTEGER NOT NULL CHECK(policy_revision>1)',
    extended: 'INTEGER NOT NULL CHECK(extended IN (0,1))', cancellation_reason: "TEXT NOT NULL CHECK(cancellation_reason IN ('optional','required'))",
    no_show_reason: "TEXT NOT NULL CHECK(no_show_reason IN ('optional','required'))" },
  _calendar_lifecycle_policy: { id: "TEXT PRIMARY KEY CHECK(id='policy')", scope_id: 'TEXT NOT NULL', policy_revision: 'INTEGER NOT NULL CHECK(policy_revision>1)' },
  _calendar_appointment_lifecycle_history: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', appointment_id: 'TEXT NOT NULL REFERENCES calendar_appointments(id)',
    appointment_revision: 'INTEGER NOT NULL CHECK(appointment_revision>1)', policy_revision: 'INTEGER NOT NULL CHECK(policy_revision>0)',
    status: "TEXT NOT NULL CHECK(status IN ('tentative','confirmed','completed','no-show','cancelled'))",
    reason: 'TEXT CHECK(reason IS NULL OR (length(reason) BETWEEN 1 AND 1024 AND length(trim(reason))>0))' },
  _calendar_appointment_lifecycle_current: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', appointment_id: 'TEXT NOT NULL REFERENCES calendar_appointments(id) CHECK(id=appointment_id)',
    lifecycle_id: 'TEXT NOT NULL REFERENCES _calendar_appointment_lifecycle_history(id)' },
  _calendar_lifecycle_receipts: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', principal: 'TEXT NOT NULL', request_id: 'TEXT NOT NULL', digest: 'TEXT NOT NULL', result_json: 'TEXT NOT NULL',
    target_kind: "TEXT NOT NULL CHECK(target_kind='lifecycle')", target_id: "TEXT NOT NULL CHECK(target_id='policy')", required_right: "TEXT NOT NULL CHECK(required_right='manage')" },
  _calendar_lifecycle_effect_intents: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', receipt_id: 'TEXT NOT NULL REFERENCES _calendar_lifecycle_receipts(id)',
    operation: "TEXT NOT NULL CHECK(operation='lifecycle.policy-changed')", target_kind: "TEXT NOT NULL CHECK(target_kind='lifecycle')", target_id: "TEXT NOT NULL CHECK(target_id='policy')", revision: 'INTEGER NOT NULL CHECK(revision>1)' },
};
export const CALENDAR_LIFECYCLE_TABLES: Record<string, TableSchema> = { ...CALENDAR_TYPE_TABLES, ...CALENDAR_LIFECYCLE_ADDITIONS };

export function migrateCalendarLifecycle(database: Parameters<Migration['up']>[0]): void {
  database.run('CREATE UNIQUE INDEX calendar_lifecycle_policy_history_identity ON _calendar_lifecycle_policy_history(scope_id,policy_revision)');
  database.run('CREATE UNIQUE INDEX calendar_appointment_lifecycle_history_identity ON _calendar_appointment_lifecycle_history(scope_id,appointment_id,appointment_revision)');
  database.run('CREATE UNIQUE INDEX calendar_appointment_lifecycle_current_identity ON _calendar_appointment_lifecycle_current(scope_id,appointment_id)');
  database.run('CREATE UNIQUE INDEX calendar_lifecycle_receipt_identity ON _calendar_lifecycle_receipts(scope_id,principal,request_id)');
  database.run('CREATE INDEX calendar_lifecycle_effect_source ON _calendar_lifecycle_effect_intents(scope_id,target_kind,target_id,revision)');
  const mutable = ['_calendar_lifecycle_policy', '_calendar_appointment_lifecycle_current'];
  for (const table of Object.keys(CALENDAR_LIFECYCLE_ADDITIONS)) {
    const duplicate = table === '_calendar_lifecycle_policy_history' ? ' OR (scope_id=NEW.scope_id AND policy_revision=NEW.policy_revision)'
      : table === '_calendar_appointment_lifecycle_history' ? ' OR (scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id AND appointment_revision=NEW.appointment_revision)'
      : table === '_calendar_appointment_lifecycle_current' ? ' OR (scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id)'
      : table === '_calendar_lifecycle_receipts' ? ' OR (scope_id=NEW.scope_id AND principal=NEW.principal AND request_id=NEW.request_id)' : '';
    database.run(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=NEW.id${duplicate}) BEGIN SELECT RAISE(ABORT,'Private calendar identity cannot be replaced'); END`);
    database.run(`CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private calendar scope is inconsistent'); END`);
    database.run(`CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar history must be retained'); END`);
    if (!mutable.includes(table)) database.run(`CREATE TRIGGER ${table}_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar evidence is immutable'); END`);
    else database.run(`CREATE TRIGGER ${table}_identity BEFORE UPDATE OF id,scope_id ON ${table} WHEN OLD.id IS NOT NEW.id OR OLD.scope_id IS NOT NEW.scope_id BEGIN SELECT RAISE(ABORT,'Private calendar identity is immutable'); END`);
  }
  for (const old of ['_calendar_receipts', '_calendar_block_receipts', '_calendar_hold_receipts', '_calendar_location_receipts', '_calendar_type_receipts']) {
    for (const [table, other] of [[old, '_calendar_lifecycle_receipts'], ['_calendar_lifecycle_receipts', old]]) database.run(`CREATE TRIGGER ${table}_lifecycle_cross_${other} BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${other} WHERE id=NEW.id OR (scope_id=NEW.scope_id AND principal=NEW.principal AND request_id=NEW.request_id)) BEGIN SELECT RAISE(ABORT,'Private calendar request identity cannot be reused'); END`);
  }
  database.run(`CREATE TRIGGER calendar_lifecycle_policy_history_revision BEFORE INSERT ON _calendar_lifecycle_policy_history WHEN
    NEW.policy_revision<>COALESCE((SELECT policy_revision+1 FROM _calendar_lifecycle_policy WHERE id='policy' AND scope_id=NEW.scope_id),2)
    OR EXISTS(SELECT 1 FROM _calendar_lifecycle_effect_intents WHERE scope_id=NEW.scope_id AND revision=NEW.policy_revision)
    BEGIN SELECT RAISE(ABORT,'Private lifecycle policy revision is inconsistent'); END`);
  for (const operation of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER calendar_lifecycle_policy_parent_${operation.toLowerCase()} BEFORE ${operation} ON _calendar_lifecycle_policy WHEN
    NOT EXISTS(SELECT 1 FROM _calendar_lifecycle_policy_history WHERE scope_id=NEW.scope_id AND policy_revision=NEW.policy_revision)
    OR EXISTS(SELECT 1 FROM _calendar_lifecycle_effect_intents WHERE scope_id=NEW.scope_id AND revision=NEW.policy_revision)
    BEGIN SELECT RAISE(ABORT,'Private lifecycle policy history is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_lifecycle_policy_initial BEFORE INSERT ON _calendar_lifecycle_policy WHEN NEW.policy_revision<>2 BEGIN SELECT RAISE(ABORT,'Private lifecycle policy must start at revision two'); END`);
  database.run(`CREATE TRIGGER calendar_lifecycle_policy_forward BEFORE UPDATE ON _calendar_lifecycle_policy WHEN NEW.policy_revision<>OLD.policy_revision+1 BEGIN SELECT RAISE(ABORT,'Private lifecycle policy revision must advance'); END`);
  database.run(`CREATE TRIGGER calendar_appointment_lifecycle_history_parent BEFORE INSERT ON _calendar_appointment_lifecycle_history WHEN
    NOT EXISTS(SELECT 1 FROM calendar_appointments WHERE id=NEW.appointment_id AND scope_id=NEW.scope_id AND revision=NEW.appointment_revision AND status=CASE WHEN NEW.status='cancelled' THEN 'cancelled' ELSE 'confirmed' END)
    OR NEW.policy_revision<>COALESCE((SELECT policy_revision FROM _calendar_lifecycle_policy WHERE id='policy' AND scope_id=NEW.scope_id),1)
    OR EXISTS(SELECT 1 FROM _calendar_appointment_lifecycle_history WHERE scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id AND appointment_revision>=NEW.appointment_revision)
    OR EXISTS(SELECT 1 FROM _calendar_effect_intents WHERE scope_id=NEW.scope_id AND target_kind='appointment' AND target_id=NEW.appointment_id AND revision=NEW.appointment_revision)
    BEGIN SELECT RAISE(ABORT,'Private appointment lifecycle generation is sealed'); END`);
  for (const operation of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER calendar_appointment_lifecycle_current_parent_${operation.toLowerCase()} BEFORE ${operation} ON _calendar_appointment_lifecycle_current WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_appointment_lifecycle_history h JOIN calendar_appointments a ON a.scope_id=h.scope_id AND a.id=h.appointment_id
    WHERE h.id=NEW.lifecycle_id AND h.scope_id=NEW.scope_id AND h.appointment_id=NEW.appointment_id AND a.revision=h.appointment_revision
      AND NOT EXISTS(SELECT 1 FROM _calendar_effect_intents e WHERE e.scope_id=h.scope_id AND e.target_kind='appointment' AND e.target_id=h.appointment_id AND e.revision=h.appointment_revision))
    BEGIN SELECT RAISE(ABORT,'Private appointment lifecycle pointer is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_appointment_lifecycle_current_forward BEFORE UPDATE ON _calendar_appointment_lifecycle_current WHEN OLD.appointment_id IS NOT NEW.appointment_id OR
    (SELECT appointment_revision FROM _calendar_appointment_lifecycle_history WHERE id=NEW.lifecycle_id)<=(SELECT appointment_revision FROM _calendar_appointment_lifecycle_history WHERE id=OLD.lifecycle_id)
    BEGIN SELECT RAISE(ABORT,'Private appointment lifecycle pointer must advance'); END`);
  database.run(`CREATE TRIGGER calendar_appointment_lifecycle_terminal BEFORE UPDATE ON calendar_appointments WHEN EXISTS(
    SELECT 1 FROM _calendar_appointment_lifecycle_current p JOIN _calendar_appointment_lifecycle_history h ON h.id=p.lifecycle_id AND h.scope_id=p.scope_id AND h.appointment_id=p.appointment_id
    WHERE p.scope_id=OLD.scope_id AND p.appointment_id=OLD.id AND h.status IN ('completed','no-show','cancelled'))
    BEGIN SELECT RAISE(ABORT,'Private appointment lifecycle is terminal'); END`);
  database.run(`CREATE TRIGGER calendar_lifecycle_receipt_parent BEFORE INSERT ON _calendar_lifecycle_receipts WHEN
    json_extract(NEW.result_json,'$.operation') IS NOT 'lifecycle.policy-changed' OR json_extract(NEW.result_json,'$.id') IS NOT 'policy'
    OR json_extract(NEW.result_json,'$.revision') IS NOT COALESCE((SELECT policy_revision FROM _calendar_lifecycle_policy WHERE id='policy' AND scope_id=NEW.scope_id),1)
    BEGIN SELECT RAISE(ABORT,'Private lifecycle policy receipt is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_lifecycle_effect_parent BEFORE INSERT ON _calendar_lifecycle_effect_intents WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_lifecycle_receipts r JOIN _calendar_lifecycle_policy_history h ON h.scope_id=r.scope_id AND h.policy_revision=NEW.revision
    WHERE r.id=NEW.receipt_id AND r.scope_id=NEW.scope_id AND r.target_kind=NEW.target_kind AND r.target_id=NEW.target_id
      AND json_extract(r.result_json,'$.revision')=NEW.revision AND json_extract(r.result_json,'$.changed')=1)
    BEGIN SELECT RAISE(ABORT,'Private lifecycle policy receipt is inconsistent'); END`);
}
