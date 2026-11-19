/** Additive 014. Never alter the 001–013 closures or complete historical declaration maps. */
import type { Migration } from '../migrations/migrator';
import type { TableSchema } from '../sync/types';
import { CALENDAR_INTEGRATION_QUEUE_TABLES } from './realm-integration-queue-migration';

export const CALENDAR_INTEGRATION_INSPECTION_ADDITIONS: Record<string, TableSchema> = {
  // A derived presence set, not new effect evidence or a disposable history table.
  _calendar_integration_pending_effects: { id: 'TEXT PRIMARY KEY REFERENCES _calendar_integration_effect_admissions(id)', scope_id: 'TEXT NOT NULL' },
};
export const CALENDAR_INTEGRATION_INSPECTION_TABLES: Record<string, TableSchema> = { ...CALENDAR_INTEGRATION_QUEUE_TABLES, ...CALENDAR_INTEGRATION_INSPECTION_ADDITIONS };
for (const schema of Object.values(CALENDAR_INTEGRATION_INSPECTION_ADDITIONS)) Object.freeze(schema);
Object.freeze(CALENDAR_INTEGRATION_INSPECTION_ADDITIONS); Object.freeze(CALENDAR_INTEGRATION_INSPECTION_TABLES);

export function migrateCalendarIntegrationInspection(database: Parameters<Migration['up']>[0]): void {
  database.run('CREATE INDEX calendar_integration_inspection_state ON _calendar_integration_dispatch(scope_id,state,id)');
  database.run('CREATE INDEX calendar_integration_pending_effect_scope ON _calendar_integration_pending_effects(scope_id,id)');
  database.run(`CREATE TRIGGER calendar_integration_pending_effect_no_replace BEFORE INSERT ON _calendar_integration_pending_effects
    WHEN EXISTS(SELECT 1 FROM _calendar_integration_pending_effects WHERE id=NEW.id)
    BEGIN SELECT RAISE(ABORT,'Private integration pending effect cannot be replaced'); END`);
  database.run(`CREATE TRIGGER calendar_integration_pending_effect_parent BEFORE INSERT ON _calendar_integration_pending_effects
    WHEN NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id)
      OR NOT EXISTS(SELECT 1 FROM _calendar_integration_effect_admissions WHERE id=NEW.id AND scope_id=NEW.scope_id)
      OR EXISTS(SELECT 1 FROM _calendar_integration_effect_outcomes WHERE id=NEW.id)
    BEGIN SELECT RAISE(ABORT,'Private integration pending effect is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_integration_pending_effect_immutable BEFORE UPDATE ON _calendar_integration_pending_effects
    BEGIN SELECT RAISE(ABORT,'Private integration pending effect identity is immutable'); END`);
  database.run(`CREATE TRIGGER calendar_integration_pending_effect_settlement BEFORE DELETE ON _calendar_integration_pending_effects
    WHEN NOT EXISTS(SELECT 1 FROM _calendar_integration_effect_outcomes WHERE id=OLD.id AND scope_id=OLD.scope_id)
    BEGIN SELECT RAISE(ABORT,'Private integration pending effect requires settlement'); END`);
  // The only historical anti-join is the explicit migration, never an inspection read.
  database.run(`INSERT INTO _calendar_integration_pending_effects(id,scope_id)
    SELECT a.id,a.scope_id FROM _calendar_integration_effect_admissions a
    WHERE NOT EXISTS(SELECT 1 FROM _calendar_integration_effect_outcomes o WHERE o.id=a.id)`);
  database.run(`CREATE TRIGGER calendar_integration_admission_pending AFTER INSERT ON _calendar_integration_effect_admissions
    BEGIN INSERT INTO _calendar_integration_pending_effects(id,scope_id) VALUES(NEW.id,NEW.scope_id); END`);
  database.run(`CREATE TRIGGER calendar_integration_outcome_pending BEFORE INSERT ON _calendar_integration_effect_outcomes
    WHEN NOT EXISTS(SELECT 1 FROM _calendar_integration_pending_effects WHERE id=NEW.admission_id AND scope_id=NEW.scope_id)
    BEGIN SELECT RAISE(ABORT,'Private integration pending effect is missing'); END`);
  database.run(`CREATE TRIGGER calendar_integration_outcome_settled AFTER INSERT ON _calendar_integration_effect_outcomes
    BEGIN DELETE FROM _calendar_integration_pending_effects WHERE id=NEW.admission_id AND scope_id=NEW.scope_id; END`);
}
