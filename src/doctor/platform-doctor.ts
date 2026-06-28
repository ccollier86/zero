/**
 * platform-doctor.ts
 *
 * Runs app-level Zero configuration checks. This file owns pure diagnostics
 * for createApp config; it does not import app servers, mutate databases, or
 * print CLI output.
 */

import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import type { AuthBehaviorConfig } from '../auth/types';
import type { EmailConfig } from '../email/types';
import type { TableSchema } from '../sync/types';
import { resolveConfig, type AppConfig, type AppTableInput, type ResolvedConfig } from '../frontend/server/types';

export type PlatformDoctorSeverity = 'info' | 'warning' | 'error';

/** Structured finding emitted by the platform doctor. */
export interface PlatformDoctorFinding {
  severity: PlatformDoctorSeverity;
  code: string;
  message: string;
  path?: string;
}

/** Platform doctor result. */
export interface PlatformDoctorReport {
  findings: PlatformDoctorFinding[];
  ok: boolean;
}

/** Options that affect doctor pass/fail policy. */
export interface PlatformDoctorOptions {
  /** Treat warnings as failures. Useful in CI. */
  strict?: boolean;
  /** Environment values used for provider checks. Defaults to process.env. */
  env?: Record<string, string | undefined>;
}

/**
 * Run platform-level checks against a createApp config object.
 *
 * Warnings do not fail by default. Pass `strict: true` to make warnings fail
 * CI while preserving local developer velocity.
 */
export function runPlatformDoctor(
  config: AppConfig,
  options: PlatformDoctorOptions = {}
): PlatformDoctorReport {
  const findings: PlatformDoctorFinding[] = [];
  const env = options.env ?? process.env;

  checkPreResolutionConfig(config, findings);

  let resolved: ResolvedConfig | null = null;
  try {
    resolved = resolveConfig(config);
  } catch (error) {
    findings.push({
      severity: 'error',
      code: 'config.invalid',
      path: 'createApp',
      message: error instanceof Error ? error.message : 'createApp config could not be resolved.',
    });
  }

  checkTableSchemas(config.tables, findings);

  if (resolved) {
    checkAuthAndEmail(resolved, findings, env);
    checkMigrations(resolved, findings);
    checkSyncPolicy(resolved, findings);
  }

  const hasError = findings.some((finding) => finding.severity === 'error');
  const hasWarning = findings.some((finding) => finding.severity === 'warning');
  return {
    findings,
    ok: options.strict ? !hasError && !hasWarning : !hasError,
  };
}

function checkPreResolutionConfig(
  config: AppConfig,
  findings: PlatformDoctorFinding[]
): void {
  if (config.stateSync && (config.auth === false || config.auth === undefined)) {
    findings.push({
      severity: 'error',
      code: 'auth.state_sync.requires_auth',
      path: 'stateSync',
      message: 'stateSync requires auth because server state is keyed by authenticated user id.',
    });
  }
}

function checkTableSchemas(
  tables: Record<string, AppTableInput>,
  findings: PlatformDoctorFinding[]
): void {
  for (const [tableName, input] of Object.entries(tables)) {
    const schema = normalizeTableInput(input);
    const primaryColumns = findPrimaryKeyColumns(schema);
    const path = `tables.${tableName}`;

    if (primaryColumns.length === 0) {
      findings.push({
        severity: 'error',
        code: 'schema.primary_key.missing',
        path,
        message: `Table "${tableName}" has no primary key. ReactiveDB tables need one string sync primary key.`,
      });
    } else if (primaryColumns.length > 1) {
      findings.push({
        severity: 'error',
        code: 'schema.primary_key.composite',
        path,
        message: `Table "${tableName}" declares multiple primary-key columns. Use one sync primary key plus _identity for natural/composite identity.`,
      });
    }

    checkIdentity(tableName, schema, primaryColumns[0], findings);
  }
}

function checkAuthAndEmail(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFinding[],
  env: Record<string, string | undefined>
): void {
  if (resolved.auth === false) return;

  const authConfig = resolveAuthBehaviorConfig(resolved.auth as AuthBehaviorConfig);
  if (!isDuration(authConfig.accountEmails.actionTokenTTL)) {
    findings.push({
      severity: 'error',
      code: 'auth.action_token_ttl.invalid',
      path: 'auth.accountEmails.actionTokenTTL',
      message: 'auth.accountEmails.actionTokenTTL must use a duration like 15m, 1h, or 7d.',
    });
  }
  if (!isDuration(authConfig.accountEmails.requestCooldown)) {
    findings.push({
      severity: 'error',
      code: 'auth.account_email_cooldown.invalid',
      path: 'auth.accountEmails.requestCooldown',
      message: 'auth.accountEmails.requestCooldown must use a duration like 30s, 5m, or 1h.',
    });
  }

  const emailFeaturesEnabled = authConfig.accountEmails.adminCreatedUser ||
    authConfig.accountEmails.passwordReset ||
    authConfig.accountEmails.passwordChangedNotice;

  if (emailFeaturesEnabled && resolved.email === false) {
    findings.push({
      severity: 'warning',
      code: 'auth.email.disabled',
      path: 'auth.accountEmails',
      message: 'Auth account email flows are enabled, but createApp email is disabled. Disable those flows or configure email.',
    });
    return;
  }

  if (resolved.email === false) return;

  const emailConfig = resolved.email as EmailConfig;
  if (emailFeaturesEnabled && !resolved.app.publicUrl) {
    findings.push({
      severity: 'warning',
      code: 'auth.email.public_url_missing',
      path: 'app.publicUrl',
      message: 'Account emails need app.publicUrl so setup/reset links can be generated.',
    });
  }

  if (emailFeaturesEnabled && !emailConfig.from && !env.EMAIL_FROM) {
    findings.push({
      severity: 'warning',
      code: 'email.from_missing',
      path: 'email.from',
      message: 'Email delivery needs a default from address. Set email.from or EMAIL_FROM.',
    });
  }

  if (usesResend(emailConfig) && !emailConfig.resend?.apiKey && !env.RESEND_API_KEY) {
    findings.push({
      severity: 'warning',
      code: 'email.resend_api_key_missing',
      path: 'email.resend.apiKey',
      message: 'Resend is selected but no API key was found. Set email.resend.apiKey or RESEND_API_KEY.',
    });
  }
}

function checkMigrations(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFinding[]
): void {
  if (resolved.db.mode !== 'memory' && !resolved.migrate) {
    findings.push({
      severity: 'warning',
      code: 'migrations.startup.disabled',
      path: 'migrate',
      message: 'File-backed databases should run migrations on startup or through the migration CLI before deploy.',
    });
  }
}

function checkSyncPolicy(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFinding[]
): void {
  if (resolved.auth !== false && !resolved.syncPolicy) {
    findings.push({
      severity: 'warning',
      code: 'sync.auth_policy.open_app_tables',
      path: 'syncPolicy',
      message: 'Auth is enabled but no app syncPolicy is configured. App tables remain fast/open unless a policy is provided.',
    });
  }

  for (const [tableName, mode] of resolved.declaredSyncModes) {
    if (mode === 'lazy') {
      findings.push({
        severity: 'warning',
        code: 'sync.lazy.index_guidance',
        path: `tables.${tableName}`,
        message: `Table "${tableName}" is lazy synced. Add migration indexes for columns used by /api/data filters and sorting.`,
      });
    } else if (mode === 'auto') {
      findings.push({
        severity: 'info',
        code: 'sync.auto.index_guidance',
        path: `tables.${tableName}`,
        message: `Table "${tableName}" uses auto sync. If it becomes lazy, index frequent /api/data filter and sort columns.`,
      });
    }
  }
}

function normalizeTableInput(input: AppTableInput): TableSchema {
  return isWrappedTableInput(input) ? input.serverTable : input;
}

function isWrappedTableInput(
  input: AppTableInput
): input is { serverTable: TableSchema } {
  const serverTable = (input as { serverTable?: unknown }).serverTable;
  return Boolean(serverTable && typeof serverTable === 'object' && !Array.isArray(serverTable));
}

function findPrimaryKeyColumns(schema: TableSchema): string[] {
  return Object.entries(schema)
    .filter(([, value]) => typeof value === 'string' && /\bprimary\s+key\b/i.test(value))
    .map(([column]) => column);
}

function checkIdentity(
  tableName: string,
  schema: TableSchema,
  primaryKey: string | undefined,
  findings: PlatformDoctorFinding[]
): void {
  const identity = schema._identity;
  if (identity === undefined) return;

  if (!Array.isArray(identity)) {
    findings.push({
      severity: 'error',
      code: 'schema.identity.invalid',
      path: `tables.${tableName}._identity`,
      message: `Table "${tableName}" _identity must be an array of column names.`,
    });
    return;
  }

  const columns = new Set(
    Object.entries(schema)
      .filter(([key, value]) => key !== '_identity' && typeof value === 'string')
      .map(([key]) => key)
  );
  const seen = new Set<string>();

  for (const field of identity) {
    if (typeof field !== 'string' || field.length === 0) {
      findings.push({
        severity: 'error',
        code: 'schema.identity.invalid',
        path: `tables.${tableName}._identity`,
        message: `Table "${tableName}" _identity contains a non-string field.`,
      });
      continue;
    }
    if (seen.has(field)) {
      findings.push({
        severity: 'error',
        code: 'schema.identity.duplicate_field',
        path: `tables.${tableName}._identity`,
        message: `Table "${tableName}" repeats identity field "${field}".`,
      });
    }
    seen.add(field);
    if (!columns.has(field)) {
      findings.push({
        severity: 'error',
        code: 'schema.identity.missing_field',
        path: `tables.${tableName}._identity`,
        message: `Table "${tableName}" identity field "${field}" is not a declared column.`,
      });
    }
    if (primaryKey && field === primaryKey) {
      findings.push({
        severity: 'error',
        code: 'schema.identity.primary_key_field',
        path: `tables.${tableName}._identity`,
        message: `Table "${tableName}" identity field "${field}" cannot also be the sync primary key.`,
      });
    }
  }
}

function usesResend(config: EmailConfig): boolean {
  const provider = config.provider ?? 'resend';
  return provider === 'resend';
}

function isDuration(value: string): boolean {
  return /^\d+(s|m|h|d)$/.test(value);
}
