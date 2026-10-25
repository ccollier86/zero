/** Public, offline-only legacy state migration contract. No app runtime is started. */
export interface LegacyStateMigrationInput {
  /** Supported source is the consolidated single-tenant 1.3 schema, migrations 001–007. */
  readonly sourceFormat: 'zero-1.3-single-combined';
  /** Operator attestation: this is an authorized, quiescent private backup, not a live mount. */
  readonly offlineSource: true;
  readonly sourcePath: string;
  /** Exact approved backup bytes, not a digest inferred during apply. */
  readonly sourceSha256: string;
  /** Complete app-owned table inventory; framework tables cannot be reclassified. */
  readonly applicationTables: readonly string[];
  /** Approved immutable app migration version → checksum inventory. No code is executed. */
  readonly applicationMigrationChecksums: Readonly<Record<string, string>>;
}

export interface LegacyTableEvidence {
  readonly table: string;
  readonly columns: readonly string[];
  readonly rows: number;
  readonly schemaSha256: string;
  readonly rowsSha256: string;
  readonly owner: 'system' | 'application' | 'ledger' | 'derived';
}

export interface LegacyStateMigrationPlan {
  readonly version: 1;
  readonly kind: 'zero.legacy-state-plan';
  readonly sourceFormat: LegacyStateMigrationInput['sourceFormat'];
  readonly sourceSha256: string;
  readonly targetRegistrySha256: string;
  readonly tables: readonly LegacyTableEvidence[];
  readonly systemMigrationVersions: readonly string[];
  readonly applicationMigrationVersions: readonly string[];
  readonly applicationViews: readonly string[];
  /** Preserved nonterminal work cannot acquire execution permission by being copied. */
  readonly pendingWorkflowCount: number;
  readonly fingerprint: string;
}

export interface StageLegacyStateMigrationInput extends LegacyStateMigrationInput {
  readonly expectedPlanFingerprint: string;
  /** New directory under a private canonical parent. Existing generations are never overwritten. */
  readonly outputDirectory: string;
  /** Explicitly start new reactive streams; old mixed streams remain in the retained source backup. */
  readonly resetReactiveHistory: true;
}

export interface StagedLegacyStateMigration {
  readonly version: 1;
  readonly kind: 'zero.legacy-state-staged';
  readonly planFingerprint: string;
  readonly sourceSha256: string;
  readonly systemDatabase: { readonly path: string; readonly sha256: string };
  readonly applicationDatabase: { readonly path: string; readonly sha256: string };
  /** Staged output is not authorization to boot effects or cut over production. */
  readonly requiresApplicationAcceptance: true;
  readonly workflowRecovery: 'requires-reviewed-authority' | 'no-pending-work';
}

export const LEGACY_STATE_MIGRATION_CODES = [
  'LEGACY_STATE_INPUT_INVALID', 'LEGACY_STATE_SOURCE_INVALID',
  'LEGACY_STATE_SOURCE_CHANGED', 'LEGACY_STATE_SOURCE_UNSUPPORTED',
  'LEGACY_STATE_INTEGRITY_FAILED', 'LEGACY_STATE_UNKNOWN_TABLE',
  'LEGACY_STATE_LEDGER_INVALID', 'LEGACY_STATE_PLAN_CHANGED',
  'LEGACY_STATE_DESTINATION_INVALID', 'LEGACY_STATE_PRESERVATION_FAILED',
  'LEGACY_STATE_STAGE_FAILED', 'LEGACY_STATE_MANIFEST_INVALID',
] as const;
export type LegacyStateMigrationCode = typeof LEGACY_STATE_MIGRATION_CODES[number];
export type LegacyStateMigrationPhase = 'plan' | 'copy' | 'partition-system' | 'partition-application' | 'verify-split' | 'upgrade-system' | 'snapshot' | 'verify-upgrade' | 'manifest';

/** Safe errors never attach source rows, SQL bindings, hashes, secrets or filesystem causes. */
export class LegacyStateMigrationError extends Error {
  readonly code: LegacyStateMigrationCode;
  readonly phase?: LegacyStateMigrationPhase;
  constructor(code: LegacyStateMigrationCode, phase?: LegacyStateMigrationPhase) { super(code); this.name = 'LegacyStateMigrationError'; this.code = code; this.phase = phase; }
}

export function failLegacyState(code: LegacyStateMigrationCode): never { throw new LegacyStateMigrationError(code); }
