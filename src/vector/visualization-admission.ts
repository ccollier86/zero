/** Exact, non-destructive optional schema admission, shared by bootstrap and doctor. */
import type { ReactiveDB } from '../sync/reactive-db';
import { runSynchronousMigrationHandler } from '../migrations/migration-handler-boundary';
import { VectorError } from './vector-error';
import { VECTOR_VISUALIZATION_SCHEMA_OBJECTS, vectorVisualizationMigration } from './visualization-migration';
import { VECTOR_VISUALIZATION_MAPS_TABLE, VECTOR_VISUALIZATION_OPERATIONS_TABLE, VECTOR_VISUALIZATION_FEED_TABLE,
  VECTOR_VISUALIZATION_MAP_SCHEMA, VECTOR_VISUALIZATION_OPERATION_SCHEMA, VECTOR_VISUALIZATION_FEED_SCHEMA } from './visualization-schema';

const objects = VECTOR_VISUALIZATION_SCHEMA_OBJECTS;
const normalize = (value: string) => value.replace(/IF\s+NOT\s+EXISTS/gi, '').replace(/\s+/g, '').replace(/;$/, '').toLowerCase();
/** Read-only exact-shape check; no provider, DDL or migration-history access. */
export function vectorVisualizationSchemaReady(db: Pick<ReactiveDB, 'prepare'>): boolean {
  return objects.every(object => {
    const stmt = db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?');
    try { const actual = stmt.get(object.name) as { type: string; sql: string } | null;
      return actual?.type === object.type && typeof actual.sql === 'string' && normalize(actual.sql) === normalize(object.sql);
    } finally { stmt.finalize(); }
  });
}
/** Admit existing tables, or atomically install their fixed DDL only with explicit bootstrap authority. */
export function admitVectorVisualizationSchema(db: ReactiveDB, installAllowed: boolean): void {
  if (!vectorVisualizationSchemaReady(db) && installAllowed) {
    // Match Zero's existing optional SYSTEM-feature admission: additive fixed
    // DDL is atomic and does not mutate the release-wide core migration ledger.
    // A private one-entry Migrator would reject core history, and its foreign
    // recorded version would prevent the next core bootstrap from starting.
    db.transaction(() => {
      for (const object of objects) {
        const stmt = db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?');
        try { const actual = stmt.get(object.name) as { type: string; sql: string } | null;
          if (actual && (actual.type !== object.type || typeof actual.sql !== 'string' || normalize(actual.sql) !== normalize(object.sql))) throw new VectorError('VECTOR_CONFIG_INVALID', 'Vector visualization schema conflicts with an existing object; reconcile explicitly.');
        } finally { stmt.finalize(); }
      }
      runSynchronousMigrationHandler(vectorVisualizationMigration.up, db.getRawDatabase(), 'up', vectorVisualizationMigration);
      if (!vectorVisualizationSchemaReady(db)) throw new VectorError('VECTOR_CONFIG_INVALID', 'Vector visualization schema installation did not match the admitted contract.');
    });
  }
  if (!vectorVisualizationSchemaReady(db)) throw new VectorError('VECTOR_CONFIG_INVALID', 'Vector visualization schema is not provisioned. Enable migrations or provision through fixed-schema admission first.');
  db.defineTable(VECTOR_VISUALIZATION_OPERATIONS_TABLE, VECTOR_VISUALIZATION_OPERATION_SCHEMA);
  db.defineTable(VECTOR_VISUALIZATION_MAPS_TABLE, VECTOR_VISUALIZATION_MAP_SCHEMA);
  db.defineTable(VECTOR_VISUALIZATION_FEED_TABLE, VECTOR_VISUALIZATION_FEED_SCHEMA);
}
