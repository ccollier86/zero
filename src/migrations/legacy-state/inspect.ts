/** Read-only source admission and deterministic plan; no destination is created. */
import { LegacyStateMigrationError, failLegacyState, type LegacyStateMigrationInput, type LegacyStateMigrationPlan, type LegacyTableEvidence } from './contracts';
import { fileSha256, sourceFile } from './files';
import { assertLegacyIntegrity, closeLegacyRead, legacyRowsEvidence, legacySchemaSha256, legacyTableColumns, openLegacyRead, sha256, validLegacyIdentifier } from './evidence';
import { assertLegacySystemSchema, LEGACY_DERIVED_TABLES, LEGACY_LEDGER_TABLES, LEGACY_SYSTEM_VERSIONS, legacySystemTables, targetMigrationRegistrySha256 } from './catalog';
import { admitLegacyLedgers } from './ledger';
import { LEGACY_APPLICATION_RUNTIME_TABLES, LEGACY_OPTIONAL_RUNTIME_TABLES } from './runtime-state';

export async function planLegacyStateMigration(input: LegacyStateMigrationInput): Promise<LegacyStateMigrationPlan> {
  try { return await inspect(input); } catch (error) {
    if (error instanceof LegacyStateMigrationError) throw error;
    failLegacyState('LEGACY_STATE_SOURCE_INVALID');
  }
}

async function inspect(input: LegacyStateMigrationInput): Promise<LegacyStateMigrationPlan> {
  if (!input || input.sourceFormat !== 'zero-1.3-single-combined' || input.offlineSource !== true
    || !/^[a-f0-9]{64}$/.test(input.sourceSha256) || !Array.isArray(input.applicationTables)
    || input.applicationTables.length > 1000 || input.applicationTables.some(table => !validLegacyIdentifier(table))
    || new Set(input.applicationTables).size !== input.applicationTables.length
    || !input.applicationMigrationChecksums || typeof input.applicationMigrationChecksums !== 'object'
    || Array.isArray(input.applicationMigrationChecksums)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input.applicationMigrationChecksums))
    || Object.keys(input.applicationMigrationChecksums).length > 10000) failLegacyState('LEGACY_STATE_INPUT_INVALID');
  const path = sourceFile(input.sourcePath);
  if (await fileSha256(path) !== input.sourceSha256) failLegacyState('LEGACY_STATE_SOURCE_CHANGED');
  const db = openLegacyRead(path);
  try {
    assertLegacyIntegrity(db);
    const system = new Set(legacySystemTables()), app = new Set(input.applicationTables);
    const runtime = new Set<string>(LEGACY_APPLICATION_RUNTIME_TABLES);
    const ledger = new Set<string>(LEGACY_LEDGER_TABLES), derived = new Set<string>(LEGACY_DERIVED_TABLES);
    if ([...app].some(table => system.has(table) || runtime.has(table) || ledger.has(table) || derived.has(table) || table.startsWith('_auth_') || table.startsWith('_zero_'))) failLegacyState('LEGACY_STATE_INPUT_INVALID');
    const schemas = db.query<{ name: string; sql: string }, []>("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all();
    const found = new Set(schemas.map(table => table.name));
    if ([...app].some(table => !found.has(table))) failLegacyState('LEGACY_STATE_UNKNOWN_TABLE');
    // Mandatory baseline tables exist; runtime generations are optional on never-used installs.
    if ([...system].some(table => !(LEGACY_OPTIONAL_RUNTIME_TABLES as readonly string[]).includes(table) && !found.has(table))) failLegacyState('LEGACY_STATE_SOURCE_UNSUPPORTED');
    const tables: LegacyTableEvidence[] = [];
    for (const { name, sql } of schemas) {
      if (!validLegacyIdentifier(name) || /^CREATE\s+VIRTUAL\s+TABLE/i.test(sql)) failLegacyState('LEGACY_STATE_SOURCE_UNSUPPORTED');
      const owner = system.has(name) ? 'system' : runtime.has(name) ? 'application-runtime' : app.has(name) ? 'application' : ledger.has(name) ? 'ledger' : derived.has(name) ? 'derived' : null;
      if (!owner) failLegacyState('LEGACY_STATE_UNKNOWN_TABLE');
      if (owner === 'system' || owner === 'application-runtime') assertLegacySystemSchema(db, name);
      if ((owner === 'ledger' || owner === 'derived') && db.query("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND tbl_name=?").get(name)) failLegacyState('LEGACY_STATE_SOURCE_UNSUPPORTED');
      tables.push({ table: name, owner, columns: legacyTableColumns(db, name), schemaSha256: legacySchemaSha256(db, name), ...legacyRowsEvidence(db, name) });
    }
    const applicationMigrationVersions = admitLegacyLedgers(db, input.applicationMigrationChecksums);
    const applicationViews = db.query<{ name: string }, []>("SELECT name FROM sqlite_schema WHERE type='view' ORDER BY name").all().map(row => row.name);
    if (applicationViews.some(name => !validLegacyIdentifier(name))) failLegacyState('LEGACY_STATE_SOURCE_UNSUPPORTED');
    const body = { version: 1 as const, kind: 'zero.legacy-state-plan' as const, sourceFormat: input.sourceFormat,
      sourceSha256: input.sourceSha256, targetRegistrySha256: targetMigrationRegistrySha256(), tables,
      systemMigrationVersions: [...LEGACY_SYSTEM_VERSIONS], applicationMigrationVersions, applicationViews,
      pendingWorkflowCount: Number((db.query("SELECT COUNT(*) AS total FROM workflow_instances WHERE status NOT IN ('completed','failed','cancelled')").get() as { total: bigint }).total) };
    const plan = { ...body, fingerprint: sha256(JSON.stringify(body)) };
    if (sourceFile(path) !== path || await fileSha256(path) !== input.sourceSha256) failLegacyState('LEGACY_STATE_SOURCE_CHANGED');
    return Object.freeze(plan);
  } finally { closeLegacyRead(db); }
}
