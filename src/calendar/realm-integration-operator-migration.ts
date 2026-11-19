/** Additive 015. Initiating actor receipts remain separate from native Jobs/control evidence. */
import type { Migration } from '../migrations/migrator';
import type { TableSchema } from '../sync/types';
import { CALENDAR_INTEGRATION_INSPECTION_TABLES } from './realm-integration-inspection-migration';

const hash = (name: string) => `TEXT NOT NULL CHECK(length(${name})=64 AND ${name} NOT GLOB '*[^a-f0-9]*')`;
export const CALENDAR_INTEGRATION_OPERATOR_ADDITIONS: Record<string, TableSchema> = {
  _calendar_integration_operator_requests: {
    id: "TEXT PRIMARY KEY CHECK(length(id)=64 AND id NOT GLOB '*[^a-f0-9]*')", scope_id: 'TEXT NOT NULL CHECK(length(scope_id) BETWEEN 1 AND 263)',
    owner_id: 'TEXT NOT NULL CHECK(length(owner_id) BETWEEN 1 AND 128)', principal: 'TEXT NOT NULL CHECK(length(principal) BETWEEN 1 AND 256)',
    user_id: 'TEXT NOT NULL CHECK(length(user_id) BETWEEN 1 AND 128)', request_id: 'TEXT NOT NULL CHECK(length(request_id) BETWEEN 1 AND 128)', digest: hash('digest'),
    action: "TEXT NOT NULL CHECK(action IN ('retire','reactivate'))", rule_id: 'TEXT NOT NULL CHECK(length(rule_id) BETWEEN 1 AND 64)',
    selected_policy_id: hash('selected_policy_id') + ' REFERENCES _calendar_integration_policy_history(id)', selected_epoch: 'INTEGER NOT NULL CHECK(selected_epoch BETWEEN 1 AND 9007199254740990)', selected_digest: hash('selected_digest'),
    policy_id: hash('policy_id') + ' REFERENCES _calendar_integration_policy_history(id)', policy_epoch: 'INTEGER NOT NULL CHECK(policy_epoch BETWEEN 1 AND 9007199254740991)', policy_digest: hash('policy_digest'),
    local_state: "TEXT NOT NULL CHECK(local_state IN ('retired','activating'))", changed: `INTEGER NOT NULL CHECK(changed IN (0,1)
      AND ((action='retire' AND local_state='retired' AND policy_id=selected_policy_id AND policy_epoch=selected_epoch AND policy_digest=selected_digest)
        OR (action='reactivate' AND local_state='activating' AND changed=1 AND policy_epoch=selected_epoch+1)))`,
    accepted_ms: 'INTEGER NOT NULL CHECK(accepted_ms BETWEEN 0 AND 8640000000000000)',
  },
};
export const CALENDAR_INTEGRATION_OPERATOR_TABLES: Record<string, TableSchema> = { ...CALENDAR_INTEGRATION_INSPECTION_TABLES, ...CALENDAR_INTEGRATION_OPERATOR_ADDITIONS };
for (const schema of Object.values(CALENDAR_INTEGRATION_OPERATOR_ADDITIONS)) Object.freeze(schema);
Object.freeze(CALENDAR_INTEGRATION_OPERATOR_ADDITIONS); Object.freeze(CALENDAR_INTEGRATION_OPERATOR_TABLES);

export function migrateCalendarIntegrationOperator(database: Parameters<Migration['up']>[0]): void {
  database.run('CREATE UNIQUE INDEX calendar_integration_operator_request_identity ON _calendar_integration_operator_requests(scope_id,principal,request_id)');
  database.run("CREATE UNIQUE INDEX calendar_integration_operator_retirement ON _calendar_integration_operator_requests(scope_id,selected_policy_id) WHERE action='retire' AND changed=1");
  database.run(`CREATE TRIGGER calendar_integration_operator_no_replace BEFORE INSERT ON _calendar_integration_operator_requests
    WHEN EXISTS(SELECT 1 FROM _calendar_integration_operator_requests WHERE id=NEW.id OR (scope_id=NEW.scope_id AND principal=NEW.principal AND request_id=NEW.request_id))
    BEGIN SELECT RAISE(ABORT,'Private operator request cannot be replaced'); END`);
  database.run(`CREATE TRIGGER calendar_integration_operator_immutable BEFORE UPDATE ON _calendar_integration_operator_requests
    BEGIN SELECT RAISE(ABORT,'Private operator request is immutable'); END`);
  database.run(`CREATE TRIGGER calendar_integration_operator_retain BEFORE DELETE ON _calendar_integration_operator_requests
    BEGIN SELECT RAISE(ABORT,'Private operator request must be retained'); END`);
  database.run(`CREATE TRIGGER calendar_integration_operator_parent BEFORE INSERT ON _calendar_integration_operator_requests WHEN
    NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id AND owner_id=NEW.owner_id)
    OR NOT EXISTS(SELECT 1 FROM _calendar_integration_policy_history selected
      JOIN _calendar_integration_policy_history result ON result.scope_id=selected.scope_id AND result.rule_id=selected.rule_id AND result.source_id=selected.source_id
      JOIN _calendar_integration_policy_current current ON current.scope_id=result.scope_id AND current.rule_id=result.rule_id AND current.policy_id=result.id AND current.epoch=result.epoch
      WHERE selected.id=NEW.selected_policy_id AND selected.scope_id=NEW.scope_id AND selected.rule_id=NEW.rule_id
        AND selected.epoch=NEW.selected_epoch AND selected.digest=NEW.selected_digest AND result.id=NEW.policy_id
        AND result.epoch=NEW.policy_epoch AND result.digest=NEW.policy_digest AND current.state=NEW.local_state)
    BEGIN SELECT RAISE(ABORT,'Private operator request source is inconsistent'); END`);
  // Keep one shared human request-key namespace without changing historical migration closures/maps.
  for (const legacy of ['_calendar_receipts', '_calendar_block_receipts', '_calendar_hold_receipts', '_calendar_location_receipts', '_calendar_type_receipts', '_calendar_lifecycle_receipts']) {
    database.run(`CREATE TRIGGER ${legacy}_operator_cross BEFORE INSERT ON ${legacy}
      WHEN EXISTS(SELECT 1 FROM _calendar_integration_operator_requests WHERE scope_id=NEW.scope_id AND principal=NEW.principal AND request_id=NEW.request_id)
      BEGIN SELECT RAISE(ABORT,'Private calendar request identity cannot be reused'); END`);
    database.run(`CREATE TRIGGER calendar_integration_operator_cross_${legacy} BEFORE INSERT ON _calendar_integration_operator_requests
      WHEN EXISTS(SELECT 1 FROM ${legacy} WHERE scope_id=NEW.scope_id AND principal=NEW.principal AND request_id=NEW.request_id)
      BEGIN SELECT RAISE(ABORT,'Private calendar request identity cannot be reused'); END`);
  }
}
