/** Additive 012. Registration commands have a source-local immutable intent before crossing into Jobs. */
import type { Migration } from '../migrations/migrator';
import type { TableSchema } from '../sync/types';
import { CALENDAR_INTEGRATION_OWNERSHIP_TABLES } from './realm-integration-ownership-migration';

const registrationJson = "TEXT CHECK(% IS NULL OR (length(%)<=1024 AND json_valid(%) AND json_type(%)='object'))";
const registrationColumn = (name: string) => registrationJson.replaceAll('%', name);
const failure = "TEXT CHECK(last_failure IS NULL OR last_failure IN ('JOBS_CAPACITY','JOBS_OUTCOME_UNKNOWN','JOBS_NOT_READY','JOBS_REVISION_CONFLICT','JOBS_DEFINITION_UNAVAILABLE','JOBS_AUTHORITY_RETIRED','CALENDAR_NOT_READY','INTEGRATION_RETRY'))";
export const CALENDAR_INTEGRATION_CONTROL_ADDITIONS: Record<string, TableSchema> = {
  _calendar_integration_controls: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', owner_id: 'TEXT NOT NULL', policy_id: 'TEXT NOT NULL REFERENCES _calendar_integration_policy_history(id)',
    rule_id: 'TEXT NOT NULL', epoch: 'INTEGER NOT NULL CHECK(epoch>0)', action: "TEXT NOT NULL CHECK(action IN ('activate','retire'))", jobs_key: 'TEXT NOT NULL',
    expected_jobs_revision: "INTEGER NOT NULL CHECK(expected_jobs_revision>=0 AND (action<>'retire' OR expected_jobs_revision>0))",
    expected_registration_json: registrationColumn('expected_registration_json'), created_ms: 'INTEGER NOT NULL CHECK(created_ms>=0)' },
  _calendar_integration_control_results: { id: 'TEXT PRIMARY KEY CHECK(id=control_id)', scope_id: 'TEXT NOT NULL', control_id: 'TEXT NOT NULL REFERENCES _calendar_integration_controls(id)',
    state: "TEXT NOT NULL CHECK(state IN ('accepted','absent'))", registration_json: registrationColumn('registration_json'),
    settled_ms: "INTEGER NOT NULL CHECK(settled_ms>=0 AND ((state='accepted')=(registration_json IS NOT NULL)))" },
  _calendar_integration_control_attempts: { id: 'TEXT PRIMARY KEY REFERENCES _calendar_integration_controls(id)', scope_id: 'TEXT NOT NULL',
    rule_id: 'TEXT NOT NULL', result_id: 'TEXT REFERENCES _calendar_integration_control_results(id) CHECK(result_id IS NULL OR result_id=id)', last_failure: failure, next_attempt_ms: 'INTEGER NOT NULL CHECK(next_attempt_ms>=0)' },
  _calendar_integration_registered_sources: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', rule_id: 'TEXT NOT NULL REFERENCES _calendar_integration_rule_sources(id)' },
};
export const CALENDAR_INTEGRATION_CONTROL_TABLES: Record<string, TableSchema> = { ...CALENDAR_INTEGRATION_OWNERSHIP_TABLES, ...CALENDAR_INTEGRATION_CONTROL_ADDITIONS };
for (const schema of Object.values(CALENDAR_INTEGRATION_CONTROL_ADDITIONS)) Object.freeze(schema);
Object.freeze(CALENDAR_INTEGRATION_CONTROL_ADDITIONS); Object.freeze(CALENDAR_INTEGRATION_CONTROL_TABLES);

export function migrateCalendarIntegrationControls(database: Parameters<Migration['up']>[0]): void {
  // Keep the literal inside this immutable migration function: hashMigration()
  // fingerprints its body, not values closed over from a mutable source module.
  const originalRegistrationGuard = `CREATE TRIGGER calendar_integration_registration_parent BEFORE INSERT ON _calendar_integration_policy_registrations WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_integration_policy_history h JOIN _calendar_integration_policy_current p ON p.policy_id=h.id AND p.scope_id=h.scope_id
    WHERE h.id=NEW.policy_id AND h.scope_id=NEW.scope_id AND p.state='activating'
      AND json_extract(NEW.registration_json,'$.id')=h.source_id AND json_extract(NEW.registration_json,'$.policyHash')=h.source_policy_hash)
    OR json_extract(NEW.registration_json,'$.state') IS NOT 'active' OR json_type(NEW.registration_json,'$.generation') IS NOT 'integer'
    OR json_extract(NEW.registration_json,'$.generation')<1 OR json_type(NEW.registration_json,'$.revision') IS NOT 'integer' OR json_extract(NEW.registration_json,'$.revision')<1
    OR (SELECT count(*) FROM json_each(NEW.registration_json))<>5
    BEGIN SELECT RAISE(ABORT,'Private integration registration is inconsistent'); END`;
  const prior = database.query<{ sql: string | null }, []>("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='calendar_integration_registration_parent' AND tbl_name='_calendar_integration_policy_registrations'").get();
  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  if (!prior?.sql || normalize(prior.sql) !== normalize(originalRegistrationGuard)) throw new Error('Calendar control journal found an unexpected historical registration guard.');
  for (const sql of [
    'CREATE UNIQUE INDEX calendar_integration_control_action ON _calendar_integration_controls(policy_id,action)',
    'CREATE UNIQUE INDEX calendar_integration_control_jobs_key ON _calendar_integration_controls(scope_id,jobs_key)',
    'CREATE INDEX calendar_integration_control_pending ON _calendar_integration_control_attempts(scope_id,result_id,next_attempt_ms,id)',
    'CREATE INDEX calendar_integration_control_rule_pending ON _calendar_integration_control_attempts(scope_id,rule_id,result_id,next_attempt_ms,id)',
    'CREATE UNIQUE INDEX calendar_integration_registered_rule ON _calendar_integration_registered_sources(scope_id,rule_id)',
  ]) database.run(sql);
  for (const table of Object.keys(CALENDAR_INTEGRATION_CONTROL_ADDITIONS)) {
    const duplicate = table === '_calendar_integration_controls' ? ' OR (policy_id=NEW.policy_id AND action=NEW.action) OR (scope_id=NEW.scope_id AND jobs_key=NEW.jobs_key)' : '';
    database.run(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=NEW.id${duplicate}) BEGIN SELECT RAISE(ABORT,'Private integration control identity cannot be replaced'); END`);
    database.run(`CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private integration control scope is inconsistent'); END`);
    database.run(`CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private integration control history must be retained'); END`);
    if (table !== '_calendar_integration_control_attempts') database.run(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Private integration control evidence is immutable'); END`);
    else database.run(`CREATE TRIGGER ${table}_identity BEFORE UPDATE OF id,scope_id ON ${table} WHEN OLD.id IS NOT NEW.id OR OLD.scope_id IS NOT NEW.scope_id BEGIN SELECT RAISE(ABORT,'Private integration control identity is immutable'); END`);
  }
  database.run(`CREATE TRIGGER calendar_integration_control_parent BEFORE INSERT ON _calendar_integration_controls WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_integration_policy_history h JOIN _calendar_integration_policy_current p ON p.rule_id=h.rule_id AND p.scope_id=h.scope_id
    JOIN _calendar_integration_rule_sources b ON b.rule_id=h.rule_id AND b.scope_id=h.scope_id AND b.source_id=h.source_id
    WHERE h.id=NEW.policy_id AND h.scope_id=NEW.scope_id AND h.rule_id=NEW.rule_id AND h.epoch=NEW.epoch AND p.policy_id=h.id
      AND ((NEW.action='activate' AND p.state IN ('activating','active')) OR (NEW.action='retire' AND p.state='retired'))
      AND ((NEW.expected_registration_json IS NULL AND NEW.expected_jobs_revision=0 AND NEW.action='activate')
        OR (json_extract(NEW.expected_registration_json,'$.id')=h.source_id
          AND json_extract(NEW.expected_registration_json,'$.revision')=NEW.expected_jobs_revision)))
    OR NEW.owner_id IS NOT (SELECT owner_id FROM _calendar_owner WHERE id='application') OR NEW.jobs_key<>'calendar-control:'||NEW.action||':'||NEW.id
    OR (NEW.expected_registration_json IS NOT NULL AND ((SELECT count(*) FROM json_each(NEW.expected_registration_json))<>5
      OR json_type(NEW.expected_registration_json,'$.state') IS NOT 'text' OR json_extract(NEW.expected_registration_json,'$.state') NOT IN ('active','retired')
      OR json_type(NEW.expected_registration_json,'$.generation') IS NOT 'integer' OR json_extract(NEW.expected_registration_json,'$.generation')<1
      OR json_type(NEW.expected_registration_json,'$.revision') IS NOT 'integer' OR json_extract(NEW.expected_registration_json,'$.revision')<1
      OR json_type(NEW.expected_registration_json,'$.policyHash') IS NOT 'text' OR length(json_extract(NEW.expected_registration_json,'$.policyHash'))<>64
      OR json_extract(NEW.expected_registration_json,'$.policyHash') GLOB '*[^a-f0-9]*'))
    BEGIN SELECT RAISE(ABORT,'Private integration control parent is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_integration_control_attempt_parent BEFORE INSERT ON _calendar_integration_control_attempts WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_integration_controls c WHERE c.id=NEW.id AND c.scope_id=NEW.scope_id AND c.rule_id=NEW.rule_id AND c.created_ms=NEW.next_attempt_ms)
    OR NEW.result_id IS NOT NULL OR NEW.last_failure IS NOT NULL BEGIN SELECT RAISE(ABORT,'Private integration control retry parent is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_integration_control_result_parent BEFORE INSERT ON _calendar_integration_control_results WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_integration_controls c JOIN _calendar_integration_policy_history h ON h.id=c.policy_id AND h.scope_id=c.scope_id
    JOIN _calendar_integration_policy_current p ON p.rule_id=c.rule_id AND p.scope_id=c.scope_id
    JOIN _calendar_integration_control_attempts a ON a.id=c.id AND a.scope_id=c.scope_id
    WHERE c.id=NEW.control_id AND c.scope_id=NEW.scope_id AND a.result_id IS NULL
      AND ((NEW.state='absent' AND c.action='activate' AND (p.policy_id<>c.policy_id OR p.state='retired'))
        OR (NEW.state='accepted' AND json_extract(NEW.registration_json,'$.id')=h.source_id
          AND json_extract(NEW.registration_json,'$.revision')=CASE WHEN c.expected_registration_json IS NULL THEN 1
            WHEN (c.action='activate' AND json_extract(c.expected_registration_json,'$.state')='active' AND json_extract(c.expected_registration_json,'$.policyHash')=h.source_policy_hash)
              OR (c.action='retire' AND json_extract(c.expected_registration_json,'$.state')='retired') THEN c.expected_jobs_revision ELSE c.expected_jobs_revision+1 END
          AND ((c.action='activate' AND json_extract(NEW.registration_json,'$.state')='active' AND json_extract(NEW.registration_json,'$.policyHash')=h.source_policy_hash
            AND json_extract(NEW.registration_json,'$.generation')=CASE WHEN c.expected_registration_json IS NULL THEN 1
              WHEN json_extract(c.expected_registration_json,'$.state')='active' AND json_extract(c.expected_registration_json,'$.policyHash')=h.source_policy_hash
                THEN json_extract(c.expected_registration_json,'$.generation') ELSE json_extract(c.expected_registration_json,'$.generation')+1 END)
            OR (c.action='retire' AND json_extract(NEW.registration_json,'$.state')='retired'
              AND json_extract(NEW.registration_json,'$.generation')=json_extract(c.expected_registration_json,'$.generation')
              AND json_extract(NEW.registration_json,'$.policyHash')=json_extract(c.expected_registration_json,'$.policyHash'))))))
    OR (NEW.state='accepted' AND ((SELECT count(*) FROM json_each(NEW.registration_json))<>5
      OR json_type(NEW.registration_json,'$.generation') IS NOT 'integer' OR json_extract(NEW.registration_json,'$.generation')<1
      OR json_type(NEW.registration_json,'$.revision') IS NOT 'integer' OR json_extract(NEW.registration_json,'$.revision')<1))
    BEGIN SELECT RAISE(ABORT,'Private integration control result is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_integration_control_retry_forward BEFORE UPDATE ON _calendar_integration_control_attempts WHEN
    OLD.rule_id IS NOT NEW.rule_id OR (OLD.result_id IS NOT NULL AND (NEW.result_id IS NOT OLD.result_id OR NEW.last_failure IS NOT OLD.last_failure OR NEW.next_attempt_ms IS NOT OLD.next_attempt_ms))
    OR (NEW.result_id IS NULL AND EXISTS(SELECT 1 FROM _calendar_integration_control_results r WHERE r.id=NEW.id))
    OR (NEW.result_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM _calendar_integration_control_results r WHERE r.id=NEW.result_id AND r.control_id=NEW.id AND r.scope_id=NEW.scope_id))
    OR NEW.next_attempt_ms<OLD.next_attempt_ms BEGIN SELECT RAISE(ABORT,'Private integration control retry transition is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_integration_control_result_publish AFTER INSERT ON _calendar_integration_control_results BEGIN
    UPDATE _calendar_integration_control_attempts SET result_id=NEW.id WHERE id=NEW.control_id AND scope_id=NEW.scope_id; END`);
  database.run(`CREATE TRIGGER calendar_integration_registered_parent BEFORE INSERT ON _calendar_integration_registered_sources WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_integration_rule_sources b WHERE b.source_id=NEW.id AND b.scope_id=NEW.scope_id AND b.rule_id=NEW.rule_id
      AND (EXISTS(SELECT 1 FROM _calendar_integration_policy_history h JOIN _calendar_integration_policy_registrations r ON r.policy_id=h.id AND r.scope_id=h.scope_id
        WHERE h.scope_id=b.scope_id AND h.rule_id=b.rule_id AND h.source_id=b.source_id)
        OR EXISTS(SELECT 1 FROM _calendar_integration_controls c WHERE c.scope_id=b.scope_id AND c.rule_id=b.rule_id AND json_extract(c.expected_registration_json,'$.id')=b.source_id)
        OR EXISTS(SELECT 1 FROM _calendar_integration_controls c JOIN _calendar_integration_control_results r ON r.control_id=c.id AND r.scope_id=c.scope_id
          WHERE c.scope_id=b.scope_id AND c.rule_id=b.rule_id AND r.state='accepted' AND json_extract(r.registration_json,'$.id')=b.source_id)))
    BEGIN SELECT RAISE(ABORT,'Private integration registered source lacks retained evidence'); END`);
  database.run(`INSERT INTO _calendar_integration_registered_sources(id,scope_id,rule_id) SELECT b.source_id,b.scope_id,b.rule_id FROM _calendar_integration_rule_sources b WHERE EXISTS(
    SELECT 1 FROM _calendar_integration_policy_history h JOIN _calendar_integration_policy_registrations r ON r.policy_id=h.id AND r.scope_id=h.scope_id
    WHERE h.scope_id=b.scope_id AND h.rule_id=b.rule_id AND h.source_id=b.source_id)`);
  database.run(`CREATE TRIGGER calendar_integration_registration_presence AFTER INSERT ON _calendar_integration_policy_registrations BEGIN
    INSERT INTO _calendar_integration_registered_sources(id,scope_id,rule_id) SELECT h.source_id,h.scope_id,h.rule_id FROM _calendar_integration_policy_history h
    WHERE h.id=NEW.policy_id AND NOT EXISTS(SELECT 1 FROM _calendar_integration_registered_sources s WHERE s.id=h.source_id); END`);
  database.run(`CREATE TRIGGER calendar_integration_control_capture_presence AFTER INSERT ON _calendar_integration_controls WHEN NEW.expected_registration_json IS NOT NULL BEGIN
    INSERT INTO _calendar_integration_registered_sources(id,scope_id,rule_id) SELECT h.source_id,h.scope_id,h.rule_id FROM _calendar_integration_policy_history h
    WHERE h.id=NEW.policy_id AND NOT EXISTS(SELECT 1 FROM _calendar_integration_registered_sources s WHERE s.id=h.source_id); END`);
  database.run(`CREATE TRIGGER calendar_integration_control_accepted_presence AFTER INSERT ON _calendar_integration_control_results WHEN NEW.state='accepted' BEGIN
    INSERT INTO _calendar_integration_registered_sources(id,scope_id,rule_id) SELECT h.source_id,h.scope_id,h.rule_id FROM _calendar_integration_controls c
    JOIN _calendar_integration_policy_history h ON h.id=c.policy_id AND h.scope_id=c.scope_id
    WHERE c.id=NEW.control_id AND NOT EXISTS(SELECT 1 FROM _calendar_integration_registered_sources s WHERE s.id=h.source_id); END`);
  database.run('DROP TRIGGER calendar_integration_registration_parent');
  database.run(`CREATE TRIGGER calendar_integration_registration_parent BEFORE INSERT ON _calendar_integration_policy_registrations WHEN NOT EXISTS(
    SELECT 1 FROM _calendar_integration_policy_history h WHERE h.id=NEW.policy_id AND h.scope_id=NEW.scope_id
      AND json_extract(NEW.registration_json,'$.id')=h.source_id AND json_extract(NEW.registration_json,'$.policyHash')=h.source_policy_hash
      AND (EXISTS(SELECT 1 FROM _calendar_integration_policy_current p WHERE p.policy_id=h.id AND p.scope_id=h.scope_id AND p.state='activating')
        OR EXISTS(SELECT 1 FROM _calendar_integration_controls c JOIN _calendar_integration_control_results r ON r.control_id=c.id AND r.scope_id=c.scope_id
          WHERE c.policy_id=h.id AND c.scope_id=h.scope_id AND c.action='activate' AND r.state='accepted' AND r.registration_json=NEW.registration_json)))
    OR json_extract(NEW.registration_json,'$.state') IS NOT 'active' OR json_type(NEW.registration_json,'$.generation') IS NOT 'integer'
    OR json_extract(NEW.registration_json,'$.generation')<1 OR json_type(NEW.registration_json,'$.revision') IS NOT 'integer' OR json_extract(NEW.registration_json,'$.revision')<1
    OR (SELECT count(*) FROM json_each(NEW.registration_json))<>5 BEGIN SELECT RAISE(ABORT,'Private integration registration is inconsistent'); END`);
}
