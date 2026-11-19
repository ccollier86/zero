/** Additive 013. Keep all historical migration closures and declaration maps intact. */
import type { Migration } from '../migrations/migrator';
import type { TableSchema } from '../sync/types';
import { CALENDAR_INTEGRATION_CONTROL_TABLES } from './realm-integration-controls-migration';

export const CALENDAR_INTEGRATION_QUEUE_ADDITIONS: Record<string, TableSchema> = {
  _calendar_integration_queue_cursor: { id: "TEXT PRIMARY KEY CHECK(id='dispatch')", scope_id: 'TEXT NOT NULL', next_class: 'INTEGER NOT NULL CHECK(next_class IN (0,1,2))' },
};
export const CALENDAR_INTEGRATION_QUEUE_TABLES: Record<string, TableSchema> = { ...CALENDAR_INTEGRATION_CONTROL_TABLES, ...CALENDAR_INTEGRATION_QUEUE_ADDITIONS };
for (const schema of Object.values(CALENDAR_INTEGRATION_QUEUE_ADDITIONS)) Object.freeze(schema);
Object.freeze(CALENDAR_INTEGRATION_QUEUE_ADDITIONS); Object.freeze(CALENDAR_INTEGRATION_QUEUE_TABLES);

export function migrateCalendarIntegrationQueue(database: Parameters<Migration['up']>[0]): void {
  database.run(`CREATE TRIGGER calendar_integration_queue_no_replace BEFORE INSERT ON _calendar_integration_queue_cursor
    WHEN EXISTS(SELECT 1 FROM _calendar_integration_queue_cursor WHERE id=NEW.id)
    BEGIN SELECT RAISE(ABORT,'Private integration queue cursor cannot be replaced'); END`);
  database.run(`CREATE TRIGGER calendar_integration_queue_scope BEFORE INSERT ON _calendar_integration_queue_cursor
    WHEN NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id)
    BEGIN SELECT RAISE(ABORT,'Private integration queue scope is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_integration_queue_identity BEFORE UPDATE OF id,scope_id ON _calendar_integration_queue_cursor
    WHEN OLD.id IS NOT NEW.id OR OLD.scope_id IS NOT NEW.scope_id
    BEGIN SELECT RAISE(ABORT,'Private integration queue identity is immutable'); END`);
  database.run(`CREATE TRIGGER calendar_integration_queue_retain BEFORE DELETE ON _calendar_integration_queue_cursor
    BEGIN SELECT RAISE(ABORT,'Private integration queue cursor must be retained'); END`);
}
