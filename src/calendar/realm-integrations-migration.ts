/** Additive 010. Prior migrations/maps are immutable; no old effect is reinterpreted or backfilled. */
import type { Migration } from '../migrations/migrator';
import type { TableSchema } from '../sync/types';
import { CALENDAR_AVAILABILITY_POLICY_TABLES } from './realm-working-hours-migration';

const json = "TEXT NOT NULL CHECK(length(CAST(% AS BLOB))<=16384 AND json_valid(%) AND json_type(%)='object')";
const jsonColumn = (name: string) => json.replaceAll('%', name);
export const CALENDAR_INTEGRATION_ADDITIONS: Record<string, TableSchema> = {
  _calendar_integration_policy_history: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', rule_id: 'TEXT NOT NULL', epoch: 'INTEGER NOT NULL CHECK(epoch>0)',
    request_id: 'TEXT NOT NULL', digest: 'TEXT NOT NULL', policy_json: jsonColumn('policy_json'), source_id: 'TEXT NOT NULL', source_policy_hash: 'TEXT NOT NULL', created_ms: 'INTEGER NOT NULL CHECK(created_ms>=0)' },
  _calendar_integration_policy_current: { id: 'TEXT PRIMARY KEY CHECK(id=rule_id)', scope_id: 'TEXT NOT NULL', rule_id: 'TEXT NOT NULL',
    policy_id: 'TEXT NOT NULL REFERENCES _calendar_integration_policy_history(id)', epoch: 'INTEGER NOT NULL CHECK(epoch>0)',
    state: "TEXT NOT NULL CHECK(state IN ('activating','active','retired'))", registration_json: "TEXT CHECK(registration_json IS NULL OR (length(registration_json)<=1024 AND json_valid(registration_json) AND json_type(registration_json)='object'))" },
  _calendar_integration_policy_registrations: { id: 'TEXT PRIMARY KEY CHECK(id=policy_id)', scope_id: 'TEXT NOT NULL', policy_id: 'TEXT NOT NULL REFERENCES _calendar_integration_policy_history(id)', registration_json: jsonColumn('registration_json') },
  _calendar_integration_intents: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', owner_id: 'TEXT NOT NULL', policy_id: 'TEXT NOT NULL REFERENCES _calendar_integration_policy_history(id)',
    rule_id: 'TEXT NOT NULL', policy_epoch: 'INTEGER NOT NULL CHECK(policy_epoch>0)', source_effect_id: 'TEXT NOT NULL REFERENCES _calendar_effect_intents(id)',
    appointment_id: 'TEXT NOT NULL REFERENCES calendar_appointments(id)', appointment_revision: 'INTEGER NOT NULL CHECK(appointment_revision>0)', create_key: 'TEXT NOT NULL', cancel_key: 'TEXT NOT NULL',
    input_json: jsonColumn('input_json'), due_ms: 'INTEGER NOT NULL CHECK(due_ms BETWEEN 0 AND 253402300799999)', expires_ms: 'INTEGER NOT NULL CHECK(expires_ms>=due_ms AND expires_ms-due_ms<=2678400000)', initiated_by: 'TEXT NOT NULL' },
  _calendar_integration_dispatch: { id: 'TEXT PRIMARY KEY REFERENCES _calendar_integration_intents(id)', scope_id: 'TEXT NOT NULL', rule_id: 'TEXT NOT NULL', policy_epoch: 'INTEGER NOT NULL CHECK(policy_epoch>0)',
    appointment_id: 'TEXT NOT NULL', appointment_revision: 'INTEGER NOT NULL CHECK(appointment_revision>0)', eligibility: "TEXT NOT NULL CHECK(eligibility IN ('current','superseded','retired','expired'))",
    state: "TEXT NOT NULL CHECK(state IN ('pending','unknown','blocked','accepted','cancelled','suppressed'))", claim_nonce: 'TEXT', claim_generation: 'INTEGER NOT NULL CHECK(claim_generation>=0)',
    claim_until_ms: 'INTEGER CHECK((claim_nonce IS NULL)=(claim_until_ms IS NULL))', claim_previous_attempted: 'INTEGER NOT NULL CHECK(claim_previous_attempted IN (0,1))', create_attempted: 'INTEGER NOT NULL CHECK(create_attempted IN (0,1))',
    next_attempt_ms: 'INTEGER NOT NULL CHECK(next_attempt_ms>=0)', blocked_code: "TEXT CHECK(blocked_code IS NULL OR blocked_code IN ('JOBS_CAPACITY','JOBS_OUTCOME_UNKNOWN','JOBS_NOT_READY','JOBS_REVISION_CONFLICT','JOBS_DEFINITION_UNAVAILABLE','JOBS_AUTHORITY_RETIRED','CALENDAR_NOT_READY','INTEGRATION_RETRY'))" },
  _calendar_integration_receipts: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', intent_id: 'TEXT NOT NULL REFERENCES _calendar_integration_intents(id)',
    phase: "TEXT NOT NULL CHECK(phase IN ('create','cancel'))", command_key: 'TEXT NOT NULL', receipt_json: jsonColumn('receipt_json') },
  _calendar_integration_effect_admissions: { id: 'TEXT PRIMARY KEY CHECK(id=intent_id)', scope_id: 'TEXT NOT NULL', intent_id: 'TEXT NOT NULL REFERENCES _calendar_integration_intents(id)',
    execution_id: 'TEXT NOT NULL', nonce: 'TEXT NOT NULL', admitted_ms: 'INTEGER NOT NULL CHECK(admitted_ms>=0)', registration_json: jsonColumn('registration_json') },
  _calendar_integration_effect_outcomes: { id: 'TEXT PRIMARY KEY CHECK(id=admission_id)', scope_id: 'TEXT NOT NULL', admission_id: 'TEXT NOT NULL REFERENCES _calendar_integration_effect_admissions(id)',
    outcome: "TEXT NOT NULL CHECK(outcome='observed')", settled_ms: 'INTEGER NOT NULL CHECK(settled_ms>=0)' },
};
export const CALENDAR_INTEGRATION_TABLES: Record<string, TableSchema> = { ...CALENDAR_AVAILABILITY_POLICY_TABLES, ...CALENDAR_INTEGRATION_ADDITIONS };
for (const schema of Object.values(CALENDAR_INTEGRATION_ADDITIONS)) Object.freeze(schema);
Object.freeze(CALENDAR_INTEGRATION_ADDITIONS); Object.freeze(CALENDAR_INTEGRATION_TABLES);

export function migrateCalendarIntegrations(database: Parameters<Migration['up']>[0]): void {
  for (const sql of [
    'CREATE UNIQUE INDEX calendar_integration_policy_epoch ON _calendar_integration_policy_history(scope_id,rule_id,epoch)',
    'CREATE UNIQUE INDEX calendar_integration_install_key ON _calendar_integration_policy_history(scope_id,request_id)',
    'CREATE UNIQUE INDEX calendar_integration_current_rule ON _calendar_integration_policy_current(scope_id,rule_id)',
    'CREATE UNIQUE INDEX calendar_integration_intent_source ON _calendar_integration_intents(scope_id,rule_id,policy_epoch,source_effect_id)',
    'CREATE UNIQUE INDEX calendar_integration_create_key ON _calendar_integration_intents(scope_id,create_key)',
    'CREATE INDEX calendar_integration_appointment ON _calendar_integration_dispatch(scope_id,appointment_id,eligibility,appointment_revision,id)',
    'CREATE INDEX calendar_integration_ready ON _calendar_integration_dispatch(scope_id,claim_nonce,state,next_attempt_ms,id)',
    'CREATE INDEX calendar_integration_expired_claim ON _calendar_integration_dispatch(scope_id,claim_until_ms,id) WHERE claim_nonce IS NOT NULL',
    'CREATE INDEX calendar_integration_retired_policy ON _calendar_integration_dispatch(scope_id,rule_id,state,claim_nonce,blocked_code,policy_epoch,next_attempt_ms,id)',
    'CREATE UNIQUE INDEX calendar_integration_receipt_phase ON _calendar_integration_receipts(intent_id,phase)',
  ]) database.run(sql);
  const mutable = ['_calendar_integration_policy_current', '_calendar_integration_dispatch'];
  for (const table of Object.keys(CALENDAR_INTEGRATION_ADDITIONS)) {
    const duplicate = table === '_calendar_integration_policy_history' ? ' OR (scope_id=NEW.scope_id AND (request_id=NEW.request_id OR (rule_id=NEW.rule_id AND epoch=NEW.epoch)))'
      : table === '_calendar_integration_intents' ? ' OR (scope_id=NEW.scope_id AND rule_id=NEW.rule_id AND policy_epoch=NEW.policy_epoch AND source_effect_id=NEW.source_effect_id) OR (scope_id=NEW.scope_id AND create_key=NEW.create_key)'
      : table === '_calendar_integration_receipts' ? ' OR (intent_id=NEW.intent_id AND phase=NEW.phase)' : '';
    database.run(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=NEW.id${duplicate}) BEGIN SELECT RAISE(ABORT,'Private integration identity cannot be replaced'); END`);
    database.run(`CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private integration scope is inconsistent'); END`);
    database.run(`CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private integration history must be retained'); END`);
    if (!mutable.includes(table)) database.run(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Private integration evidence is immutable'); END`);
    else database.run(`CREATE TRIGGER ${table}_identity BEFORE UPDATE OF id,scope_id ON ${table} WHEN OLD.id IS NOT NEW.id OR OLD.scope_id IS NOT NEW.scope_id BEGIN SELECT RAISE(ABORT,'Private integration identity is immutable'); END`);
  }
  database.run(`CREATE TRIGGER calendar_integration_policy_source BEFORE INSERT ON _calendar_integration_policy_history WHEN
    json_extract(NEW.policy_json,'$.ruleId') IS NOT NEW.rule_id OR json_extract(NEW.policy_json,'$.adapter') IS NOT 'observation-v1'
    OR json_extract(NEW.policy_json,'$.source.identity.scopeId') IS NOT NEW.scope_id
    OR json_extract(NEW.policy_json,'$.source.identity.ownerId') IS NOT (SELECT owner_id FROM _calendar_owner WHERE id='application')
    OR json_type(NEW.policy_json,'$.dueOffsetMs') IS NOT 'integer' OR abs(json_extract(NEW.policy_json,'$.dueOffsetMs'))>2678400000
    OR json_type(NEW.policy_json,'$.maxLatenessMs') IS NOT 'integer' OR json_extract(NEW.policy_json,'$.maxLatenessMs') NOT BETWEEN 0 AND 2678400000
    BEGIN SELECT RAISE(ABORT,'Private integration policy is inconsistent'); END`);
  for (const operation of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER calendar_integration_current_parent_${operation.toLowerCase()} BEFORE ${operation} ON _calendar_integration_policy_current WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_integration_policy_history h WHERE h.id=NEW.policy_id AND h.scope_id=NEW.scope_id AND h.rule_id=NEW.rule_id AND h.epoch=NEW.epoch)
    OR (NEW.state='active' AND NOT EXISTS(SELECT 1 FROM _calendar_integration_policy_registrations r WHERE r.id=NEW.policy_id AND r.scope_id=NEW.scope_id AND r.registration_json=NEW.registration_json))
    BEGIN SELECT RAISE(ABORT,'Private integration policy pointer is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_integration_current_initial BEFORE INSERT ON _calendar_integration_policy_current WHEN NEW.epoch<>1 OR NEW.state<>'activating' OR NEW.registration_json IS NOT NULL BEGIN SELECT RAISE(ABORT,'Private integration policy must start dormant'); END`);
  database.run(`CREATE TRIGGER calendar_integration_current_forward BEFORE UPDATE ON _calendar_integration_policy_current WHEN OLD.rule_id IS NOT NEW.rule_id OR NOT (
    (NEW.epoch=OLD.epoch+1 AND NEW.policy_id<>OLD.policy_id AND NEW.state='activating' AND NEW.registration_json IS NULL)
    OR (NEW.epoch=OLD.epoch AND NEW.policy_id=OLD.policy_id AND ((OLD.state='activating' AND NEW.state='active' AND NEW.registration_json IS NOT NULL)
      OR (OLD.state IN ('activating','active') AND NEW.state='retired' AND OLD.registration_json IS NEW.registration_json))))
    BEGIN SELECT RAISE(ABORT,'Private integration policy transition is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_integration_registration_parent BEFORE INSERT ON _calendar_integration_policy_registrations WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_integration_policy_history h JOIN _calendar_integration_policy_current p ON p.policy_id=h.id AND p.scope_id=h.scope_id
    WHERE h.id=NEW.policy_id AND h.scope_id=NEW.scope_id AND p.state='activating'
      AND json_extract(NEW.registration_json,'$.id')=h.source_id AND json_extract(NEW.registration_json,'$.policyHash')=h.source_policy_hash)
    OR json_extract(NEW.registration_json,'$.state') IS NOT 'active' OR json_type(NEW.registration_json,'$.generation') IS NOT 'integer'
    OR json_extract(NEW.registration_json,'$.generation')<1 OR json_type(NEW.registration_json,'$.revision') IS NOT 'integer' OR json_extract(NEW.registration_json,'$.revision')<1
    OR (SELECT count(*) FROM json_each(NEW.registration_json))<>5
    BEGIN SELECT RAISE(ABORT,'Private integration registration is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_integration_intent_parent BEFORE INSERT ON _calendar_integration_intents WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_integration_policy_history h JOIN _calendar_integration_policy_current p ON p.policy_id=h.id AND p.scope_id=h.scope_id
    JOIN calendar_appointments a ON a.scope_id=h.scope_id AND a.id=NEW.appointment_id
    JOIN _calendar_effect_intents e ON e.scope_id=a.scope_id AND e.target_kind='appointment' AND e.target_id=a.id AND e.revision=a.revision
    WHERE h.id=NEW.policy_id AND h.scope_id=NEW.scope_id AND h.rule_id=NEW.rule_id AND h.epoch=NEW.policy_epoch AND p.state IN ('activating','active')
      AND a.revision=NEW.appointment_revision AND e.id=NEW.source_effect_id AND NEW.due_ms=a.start_ms+json_extract(h.policy_json,'$.dueOffsetMs')
      AND NEW.expires_ms=NEW.due_ms+json_extract(h.policy_json,'$.maxLatenessMs'))
    OR NEW.owner_id IS NOT (SELECT owner_id FROM _calendar_owner WHERE id='application') OR NEW.create_key<>'cal-create:'||NEW.id OR NEW.cancel_key<>'cal-cancel:'||NEW.id
    OR json_extract(NEW.input_json,'$.kind') IS NOT 'calendar-observation-v1' OR json_extract(NEW.input_json,'$.intentId') IS NOT NEW.id
    OR json_extract(NEW.input_json,'$.appointmentRevision') IS NOT NEW.appointment_revision OR json_extract(NEW.input_json,'$.policyEpoch') IS NOT NEW.policy_epoch
    OR (SELECT count(*) FROM json_each(NEW.input_json))<>4
    BEGIN SELECT RAISE(ABORT,'Private integration source intent is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_integration_dispatch_parent BEFORE INSERT ON _calendar_integration_dispatch WHEN NOT EXISTS(SELECT 1 FROM _calendar_integration_intents i
    WHERE i.id=NEW.id AND i.scope_id=NEW.scope_id AND i.rule_id=NEW.rule_id AND i.policy_epoch=NEW.policy_epoch AND i.appointment_id=NEW.appointment_id AND i.appointment_revision=NEW.appointment_revision)
    OR NEW.state<>'pending' OR NEW.eligibility<>'current' OR NEW.claim_generation<>0 OR NEW.claim_nonce IS NOT NULL OR NEW.create_attempted<>0
    BEGIN SELECT RAISE(ABORT,'Private integration dispatch parent is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_integration_dispatch_forward BEFORE UPDATE ON _calendar_integration_dispatch WHEN
    OLD.rule_id IS NOT NEW.rule_id OR OLD.policy_epoch IS NOT NEW.policy_epoch OR OLD.appointment_id IS NOT NEW.appointment_id OR OLD.appointment_revision IS NOT NEW.appointment_revision
    OR (NEW.create_attempted<OLD.create_attempted AND NOT (OLD.claim_nonce IS NOT NULL AND NEW.claim_nonce IS NULL AND OLD.claim_previous_attempted=0
      AND NEW.state IN ('pending','blocked') AND NEW.blocked_code IS NOT NULL AND NEW.blocked_code<>'JOBS_OUTCOME_UNKNOWN'
      AND NOT EXISTS(SELECT 1 FROM _calendar_integration_receipts r WHERE r.intent_id=NEW.id)))
    OR (OLD.eligibility<>'current' AND NEW.eligibility='current')
    OR NEW.claim_generation<OLD.claim_generation OR NEW.claim_generation>OLD.claim_generation+1
    OR (NEW.claim_generation=OLD.claim_generation+1 AND (NEW.claim_nonce IS NULL OR NEW.create_attempted<>1 OR NEW.state<>OLD.state))
    OR (NEW.claim_generation=OLD.claim_generation AND NEW.claim_nonce IS NOT OLD.claim_nonce AND NEW.claim_nonce IS NOT NULL)
    OR (OLD.state IN ('cancelled','suppressed') AND NEW.state<>OLD.state)
    OR (OLD.state='accepted' AND NEW.state NOT IN ('accepted','cancelled'))
    OR (NEW.state='accepted' AND NOT EXISTS(SELECT 1 FROM _calendar_integration_receipts r WHERE r.intent_id=NEW.id AND r.phase='create'))
    OR (NEW.state='cancelled' AND NOT EXISTS(SELECT 1 FROM _calendar_integration_receipts r WHERE r.intent_id=NEW.id AND r.phase='cancel'))
    OR (NEW.state='suppressed' AND (OLD.claim_previous_attempted<>0 OR EXISTS(SELECT 1 FROM _calendar_integration_receipts r WHERE r.intent_id=NEW.id)))
    BEGIN SELECT RAISE(ABORT,'Private integration dispatch transition is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_integration_receipt_parent BEFORE INSERT ON _calendar_integration_receipts WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_integration_intents i JOIN _calendar_integration_policy_history h ON h.id=i.policy_id AND h.scope_id=i.scope_id
    JOIN _calendar_integration_policy_registrations p ON p.policy_id=h.id AND p.scope_id=h.scope_id
    WHERE i.id=NEW.intent_id AND i.scope_id=NEW.scope_id AND NEW.command_key=CASE NEW.phase WHEN 'create' THEN i.create_key ELSE i.cancel_key END
      AND json_extract(NEW.receipt_json,'$.sourceId')=h.source_id AND json_extract(NEW.receipt_json,'$.policyGeneration')=json_extract(p.registration_json,'$.generation'))
    OR (NEW.phase='create' AND (json_extract(NEW.receipt_json,'$.control') IS NOT 'active' OR json_extract(NEW.receipt_json,'$.revision') IS NOT 1 OR json_extract(NEW.receipt_json,'$.generation') IS NOT 1))
    OR (NEW.phase='cancel' AND (json_extract(NEW.receipt_json,'$.control') IS NOT 'cancelled' OR NOT EXISTS(SELECT 1 FROM _calendar_integration_receipts r WHERE r.intent_id=NEW.intent_id AND r.phase='create')))
    OR (SELECT count(*) FROM json_each(NEW.receipt_json))<>8
    BEGIN SELECT RAISE(ABORT,'Private integration Jobs receipt is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_integration_admission_parent BEFORE INSERT ON _calendar_integration_effect_admissions WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_integration_intents i JOIN _calendar_integration_policy_current p ON p.policy_id=i.policy_id AND p.scope_id=i.scope_id
    JOIN _calendar_integration_policy_registrations r ON r.policy_id=i.policy_id AND r.scope_id=i.scope_id
    JOIN _calendar_integration_dispatch d ON d.id=i.id AND d.scope_id=i.scope_id
    JOIN calendar_appointments a ON a.id=i.appointment_id AND a.scope_id=i.scope_id
    WHERE i.id=NEW.intent_id AND i.scope_id=NEW.scope_id AND p.state='active' AND p.epoch=i.policy_epoch AND r.registration_json=NEW.registration_json
      AND d.eligibility='current' AND a.revision=i.appointment_revision AND a.status='confirmed' AND NEW.admitted_ms BETWEEN i.due_ms AND i.expires_ms
      AND NOT EXISTS(SELECT 1 FROM _calendar_appointment_lifecycle_current c JOIN _calendar_appointment_lifecycle_history h ON h.id=c.lifecycle_id
        WHERE c.scope_id=i.scope_id AND c.appointment_id=i.appointment_id AND h.status IN ('completed','no-show','cancelled')))
    BEGIN SELECT RAISE(ABORT,'Private integration effect admission is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_integration_outcome_parent BEFORE INSERT ON _calendar_integration_effect_outcomes WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_integration_effect_admissions a WHERE a.id=NEW.admission_id AND a.scope_id=NEW.scope_id)
    BEGIN SELECT RAISE(ABORT,'Private integration effect outcome is inconsistent'); END`);
}
