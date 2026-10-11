/** Read-only optional visualization schema diagnostics. No provider/native collection startup. */
import type { ResolvedConfig } from '../frontend/server/types';
import type { PlatformDoctorFindingSink } from './platform-doctor-contracts';
import { withDoctorDatabase } from './platform-doctor-system-database-inspection';
import { vectorVisualizationSchemaReady } from '../vector/visualization-admission';
import { databaseReceiptSchemaReady } from '../databases/database-receipt-schema';
export function checkVectorVisualizationState(config: ResolvedConfig, findings: PlatformDoctorFindingSink, projectRoot: string): void {
  if (config.vectorVisualization === false) return;
  withDoctorDatabase(config.systemDb, projectRoot, 'systemDb', findings, database => {
    const ready = vectorVisualizationSchemaReady({ prepare: sql => database.query(sql) }) && databaseReceiptSchemaReady({ prepare: sql => database.query(sql) });
    findings.push({ severity: ready ? 'info' : config.migrate ? 'warning' : 'error',
      code: ready ? 'vector.visualization.schema_ready' : 'vector.visualization.schema_not_ready', path: 'vectorVisualization',
      message: ready ? 'Vector visualization SYSTEM schema is ready.' : 'Vector visualization SYSTEM schema is missing or differs from the admitted contract.',
      hint: ready ? 'Progress uses SYSTEM Sync; native vector records remain in their configured scoped index.' : 'Enable managed migrations or run admitVectorVisualizationSchema on the owning SYSTEM ReactiveDB. Do not add this optional feature to the managed core migration ledger. Conflicting objects require explicit reconciliation; migrate:false never repairs them.',
      docs: './docs-next/backend/vector/visualizations.md' });
  });
}
