/** Do not let ordinary recovery invalidate or execute preserved, unadmitted legacy work. */
import type { ReactiveDB } from '../sync/reactive-db';
import { WorkflowError } from './workflow-error';

export function assertNoLegacyWorkflowMigrationHold(db: Pick<ReactiveDB, 'prepare'>): void {
  const exists = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='_workflow_legacy_migration_holds'");
  try { if (!exists.get()) return; } finally { exists.finalize(); }
  const held = db.prepare(`SELECT 1 FROM _workflow_legacy_migration_holds AS held
    JOIN workflow_instances AS run ON run.instance_id = held.instance_id
    WHERE run.status NOT IN ('completed','failed','cancelled') LIMIT 1`);
  try {
    if (held.get()) throw new WorkflowError(
      'Imported legacy workflows require reviewed execution authority before recovery. Keep workflows disabled during isolated conversion.',
      'WORKFLOW_LEGACY_MIGRATION_REQUIRED', 409, false);
  } finally { held.finalize(); }
}
