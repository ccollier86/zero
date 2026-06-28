/**
 * platform-doctor.ts
 *
 * Runs app-level Zero configuration checks. This file owns pure diagnostics
 * for createApp config; it does not import app servers, mutate databases, or
 * print CLI output.
 */

import path from 'node:path';

import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { hasAICapability } from '../ai/ai-provider-catalog';
import { parseAIModelReference } from '../ai/ai-model-aliases';
import type { AICapability, ResolvedAIConfig, ResolvedAIProviderConfig } from '../ai/ai-types';
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
  hint?: string;
  docs?: string;
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

const AI_ALIAS_CAPABILITIES: Record<string, AICapability> = {
  fast: 'text',
  smart: 'text',
  embedding: 'embeddings',
  image: 'images',
  transcription: 'transcription',
  speech: 'speech',
};

const VECTOR_SCOPE_METADATA_FIELDS = new Set([
  'namespace',
  'bucket',
  'tenantId',
  'ownerId',
  'userId',
  'source',
  'type',
  'createdAt',
  'updatedAt',
]);

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
    resolved = resolveConfig(config, env);
  } catch (error) {
    addFinding(findings, {
      severity: 'error',
      code: 'config.invalid',
      path: 'createApp',
      message: error instanceof Error ? error.message : 'createApp config could not be resolved.',
      hint: 'Fix the createApp config error first; follow-up doctor checks may be skipped until config resolves.',
    });
  }

  checkTableSchemas(config.tables, findings);

  if (resolved) {
    checkAuthAndEmail(resolved, findings, env);
    checkMigrations(resolved, findings);
    checkSyncPolicy(resolved, findings);
    checkAuthPublicPaths(resolved, findings);
    checkObservability(resolved, findings, env);
    checkAI(resolved, findings, env);
    checkVector(resolved, findings);
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
    addFinding(findings, {
      severity: 'error',
      code: 'auth.state_sync.requires_auth',
      path: 'stateSync',
      message: 'stateSync requires auth because server state is keyed by authenticated user id.',
      hint: 'Set auth: true or disable stateSync for unauthenticated apps.',
      docs: './docs/state-sync.md',
    });
  }

  if (config.storageDir !== undefined && (config.auth === false || config.auth === undefined)) {
    addFinding(findings, {
      severity: 'warning',
      code: 'storage.auth_required',
      path: 'storageDir',
      message: 'storageDir is configured, but platform storage only mounts when auth is enabled.',
      hint: 'Enable auth for built-in file storage, or remove storageDir if the app is not using platform storage.',
      docs: './docs/start-here.md#built-in-systems',
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

/** Verify auth redirects do not point users at a protected login route. */
function checkAuthPublicPaths(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFinding[]
): void {
  if (resolved.auth === false) return;
  if (isPathPublic(resolved.loginPath, resolved.publicPaths)) return;

  addFinding(findings, {
    severity: 'warning',
    code: 'auth.login_path.not_public',
    path: 'publicPaths',
    message: `loginPath "${resolved.loginPath}" is not included in publicPaths, so unauthenticated users may be redirected to a protected route.`,
    hint: `Add "${resolved.loginPath}" to publicPaths or change loginPath to an existing public login route.`,
    docs: './docs/start-here.md#auth-defaults',
  });
}

/** Validate observability runtime and endpoint access policy against env/auth. */
function checkObservability(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFinding[],
  env: Record<string, string | undefined>
): void {
  const config = resolved.observability;
  if (config === false || config?.enabled === false) {
    if (isProduction(env)) {
      addFinding(findings, {
        severity: 'warning',
        code: 'observability.disabled.production',
        path: 'observability',
        message: 'Observability is disabled in a production environment.',
        hint: 'Leave observability enabled or install a custom sink so production errors and warnings have a routed destination.',
        docs: './docs/observability.md',
      });
    }
    return;
  }

  const endpoint = config?.endpoint;
  if (endpoint === false || endpoint?.enabled === false) return;

  const readMode = endpoint?.read ?? (resolved.auth !== false ? 'admin' : 'development');
  if (resolved.auth === false && (readMode === 'admin' || readMode === 'admin-or-dev')) {
    addFinding(findings, {
      severity: 'warning',
      code: 'observability.endpoint.requires_auth',
      path: 'observability.endpoint.read',
      message: `Observability endpoint read mode "${readMode}" requires auth, but auth is disabled.`,
      hint: 'Enable auth, use read: "development" for local-only reads, or provide a custom read callback.',
      docs: './docs/observability.md#default-http-endpoint',
    });
  }

  if (isProduction(env) && readMode === 'development') {
    addFinding(findings, {
      severity: 'warning',
      code: 'observability.endpoint.development_read_production',
      path: 'observability.endpoint.read',
      message: 'Observability endpoint read access is development-only while NODE_ENV is production.',
      hint: 'Use auth with the default admin read mode, set read: "admin", or provide a custom read callback.',
      docs: './docs/observability.md#default-http-endpoint',
    });
  }

  if (config?.store === false) {
    addFinding(findings, {
      severity: 'warning',
      code: 'observability.endpoint.store_disabled',
      path: 'observability.store',
      message: 'The observability endpoint is enabled, but the readable event store is disabled.',
      hint: 'Enable the default store, provide a custom PlatformEventStore, or disable observability.endpoint.',
      docs: './docs/observability.md#default-http-endpoint',
    });
  }
}

/** Validate AI provider activation, model aliases, and status endpoint policy. */
function checkAI(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFinding[],
  env: Record<string, string | undefined>
): void {
  if (resolved.ai === false) return;

  const providers = Object.values(resolved.ai.providers);
  if (!providers.some((provider) => provider.active)) {
    addFinding(findings, {
      severity: 'warning',
      code: 'ai.providers.none_active',
      path: 'ai.providers',
      message: 'AI is enabled, but no provider is active.',
      hint: 'Set a supported provider API key in the environment, add an explicit active provider, or set ai: false.',
      docs: './docs/ai-providers.md',
    });
  }

  for (const provider of providers) {
    checkAIProvider(provider, findings);
  }

  for (const [alias, model] of Object.entries(resolved.ai.aliases)) {
    const capability = AI_ALIAS_CAPABILITIES[alias] ?? 'text';
    checkAIModelReference(resolved.ai, alias, model, capability, `ai.aliases.${alias}`, findings);
  }

  const statusEndpoint = resolved.ai.statusEndpoint;
  if (!statusEndpoint.enabled) return;

  const readMode = statusEndpoint.read ?? (resolved.auth !== false ? 'admin' : 'development');
  if (resolved.auth === false && (readMode === 'admin' || readMode === 'admin-or-dev')) {
    addFinding(findings, {
      severity: 'warning',
      code: 'ai.status_endpoint.requires_auth',
      path: 'ai.statusEndpoint.read',
      message: `AI status endpoint read mode "${readMode}" requires auth, but auth is disabled.`,
      hint: 'Enable auth, use read: "development" for local-only reads, or provide a custom read callback.',
      docs: './docs/ai.md#status',
    });
  }

  if (isProduction(env) && readMode === 'development') {
    addFinding(findings, {
      severity: 'warning',
      code: 'ai.status_endpoint.development_read_production',
      path: 'ai.statusEndpoint.read',
      message: 'AI status endpoint read access is development-only while NODE_ENV is production.',
      hint: 'Use auth with the default admin read mode, set read: "admin", or provide a custom read callback.',
      docs: './docs/ai.md#status',
    });
  }
}

/** Emit focused provider readiness guidance for explicit AI providers. */
function checkAIProvider(
  provider: ResolvedAIProviderConfig,
  findings: PlatformDoctorFinding[]
): void {
  if (provider.active || provider.source !== 'config') return;

  if (provider.type === 'openai-compatible' && !provider.baseURL) {
    addFinding(findings, {
      severity: 'warning',
      code: 'ai.provider.base_url_missing',
      path: `ai.providers.${provider.id}.baseURL`,
      message: `AI provider "${provider.id}" is openai-compatible but has no baseURL, so it is inactive.`,
      hint: 'Set baseURL in the provider config or use a built-in provider id with a known default base URL.',
      docs: './docs/ai-providers.md#base-urls',
    });
    return;
  }

  if (provider.type === 'custom' && provider.reason === 'missing_custom_provider_adapter') {
    addFinding(findings, {
      severity: 'warning',
      code: 'ai.provider.custom_adapter_missing',
      path: `ai.providers.${provider.id}.adapter`,
      message: `AI provider "${provider.id}" is custom but has no AI SDK adapter, so it is inactive.`,
      hint: 'Provide an adapter object or adapter factory, for example one built with ai.customProvider().',
      docs: './docs/ai-providers.md#custom-provider-adapters',
    });
    return;
  }

  addFinding(findings, {
    severity: 'warning',
    code: 'ai.provider.inactive',
    path: `ai.providers.${provider.id}`,
    message: `AI provider "${provider.id}" is configured but inactive${provider.reason ? ` (${provider.reason})` : ''}.`,
    hint: 'Provide the required API key/base URL, or set this provider to false if it should stay disabled.',
    docs: './docs/ai-providers.md',
  });
}

/** Validate local vector index layout, scoping metadata, and AI bridge readiness. */
function checkVector(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFinding[]
): void {
  if (resolved.vector === false) return;

  if (resolved.ai === false) {
    addFinding(findings, {
      severity: 'info',
      code: 'vector.ai.disabled',
      path: 'vector',
      message: 'Vector storage is enabled without AI. The app must provide embeddings itself before upserting records.',
      hint: 'Enable ai: true to use createAIVectorBridge(), or keep AI disabled and pass vectors manually.',
      docs: './docs/vector.md',
    });
  } else {
    checkVectorEmbeddingAlias(resolved.ai, findings);
  }

  const pathsByIndex = new Map<string, string[]>();
  for (const index of Object.values(resolved.vector.indexes)) {
    const normalizedPath = normalizeDiskPath(index.path);
    pathsByIndex.set(normalizedPath, [...(pathsByIndex.get(normalizedPath) ?? []), index.name]);

    if (pathsOverlap(index.path, resolved.storageDir)) {
      addFinding(findings, {
        severity: 'warning',
        code: 'vector.index.path_overlaps_storage',
        path: `vector.indexes.${index.name}.path`,
        message: `Vector index "${index.name}" path overlaps storageDir.`,
        hint: 'Keep zvec collection paths separate from platform file storage directories.',
        docs: './docs/vector.md#enable-vectors',
      });
    }

    if (pathsOverlap(index.path, resolved.outDir)) {
      addFinding(findings, {
        severity: 'warning',
        code: 'vector.index.path_overlaps_build_output',
        path: `vector.indexes.${index.name}.path`,
        message: `Vector index "${index.name}" path overlaps the client build output directory.`,
        hint: 'Move vector data under a durable data directory such as ./data/vector.',
        docs: './docs/vector.md#enable-vectors',
      });
    }

    if (index.readOnly) {
      addFinding(findings, {
        severity: 'warning',
        code: 'vector.index.read_only',
        path: `vector.indexes.${index.name}.readOnly`,
        message: `Vector index "${index.name}" is read-only, so upsert/delete operations will fail at runtime.`,
        hint: 'Use readOnly only for prebuilt collections that the app never mutates.',
        docs: './docs/vector.md#enable-vectors',
      });
    }

    if (index.dimensions > 4096) {
      addFinding(findings, {
        severity: 'warning',
        code: 'vector.index.dimensions_high',
        path: `vector.indexes.${index.name}.dimensions`,
        message: `Vector index "${index.name}" uses ${index.dimensions} dimensions, which may increase memory and query cost.`,
        hint: 'Confirm the dimensions match the embedding model and are intentional.',
        docs: './docs/vector.md#enable-vectors',
      });
    }

    for (const field of Object.values(index.metadata)) {
      if (!field.indexed && VECTOR_SCOPE_METADATA_FIELDS.has(field.name)) {
        addFinding(findings, {
          severity: 'warning',
          code: 'vector.metadata.scope_field_unindexed',
          path: `vector.indexes.${index.name}.metadata.${field.name}`,
          message: `Vector metadata field "${field.name}" is commonly used for scoping/filtering but is not indexed.`,
          hint: 'Keep scope/filter metadata indexed when it appears in search filters.',
          docs: './docs/vector.md#filters',
        });
      }
    }
  }

  for (const [diskPath, indexes] of pathsByIndex) {
    if (indexes.length <= 1) continue;
    addFinding(findings, {
      severity: 'error',
      code: 'vector.index.path_duplicate',
      path: 'vector.indexes',
      message: `Vector indexes ${indexes.map((name) => `"${name}"`).join(', ')} share the same path "${diskPath}".`,
      hint: 'Give each vector index its own collection path.',
      docs: './docs/vector.md#enable-vectors',
    });
  }
}

/** Verify vector bridge calls have a usable embeddings-capable AI alias. */
function checkVectorEmbeddingAlias(
  ai: ResolvedAIConfig,
  findings: PlatformDoctorFinding[]
): void {
  const embeddingModel = ai.aliases.embedding;
  if (!embeddingModel) {
    addFinding(findings, {
      severity: 'warning',
      code: 'vector.embedding_alias.missing',
      path: 'ai.aliases.embedding',
      message: 'Vector storage is enabled with AI, but no embedding alias is configured.',
      hint: 'Set ZERO_AI_EMBEDDING_MODEL or configure ai.aliases.embedding to an active embeddings-capable provider/model.',
      docs: './docs/vector.md#ai-bridge',
    });
    return;
  }

  checkAIModelReference(
    ai,
    'embedding',
    embeddingModel,
    'embeddings',
    'ai.aliases.embedding',
    findings,
    {
      codePrefix: 'vector.embedding_alias',
      docs: './docs/vector.md#ai-bridge',
    }
  );
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

/** Validate a provider/model reference without instantiating provider clients. */
function checkAIModelReference(
  ai: ResolvedAIConfig,
  alias: string,
  model: string,
  capability: AICapability,
  findingPath: string,
  findings: PlatformDoctorFinding[],
  options: { codePrefix?: string; docs?: string } = {}
): void {
  const parsed = parseAIModelReference(model);
  const codePrefix = options.codePrefix ?? 'ai.alias';
  const docs = options.docs ?? './docs/ai-providers.md#aliases';

  if (!parsed) {
    addFinding(findings, {
      severity: 'warning',
      code: `${codePrefix}.invalid_model_reference`,
      path: findingPath,
      message: `AI alias "${alias}" must reference a provider-qualified model id, but got "${model}".`,
      hint: 'Use the format provider/model, for example openai/gpt-4o-mini.',
      docs,
    });
    return;
  }

  const provider = ai.providers[parsed.providerId];
  if (!provider) {
    addFinding(findings, {
      severity: 'warning',
      code: `${codePrefix}.provider_missing`,
      path: findingPath,
      message: `AI alias "${alias}" points at provider "${parsed.providerId}", but that provider is not configured.`,
      hint: 'Set the provider API key so env auto-detection can register it, or add it to ai.providers.',
      docs,
    });
    return;
  }

  if (!provider.active) {
    addFinding(findings, {
      severity: 'warning',
      code: `${codePrefix}.provider_inactive`,
      path: findingPath,
      message: `AI alias "${alias}" points at inactive provider "${provider.id}"${provider.reason ? ` (${provider.reason})` : ''}.`,
      hint: 'Provide the required provider credentials/settings, choose a different active provider, or remove the alias.',
      docs,
    });
    return;
  }

  if (!hasAICapability(provider.capabilities, capability)) {
    addFinding(findings, {
      severity: 'warning',
      code: `${codePrefix}.capability_unsupported`,
      path: findingPath,
      message: `AI alias "${alias}" points at "${provider.id}", but that provider does not advertise ${capability} support.`,
      hint: `Choose a model from a provider with ${capability} capability, or override the provider capabilities if a custom adapter supports it.`,
      docs,
    });
  }
}

/** Append a structured doctor finding. */
function addFinding(
  findings: PlatformDoctorFinding[],
  finding: PlatformDoctorFinding
): void {
  findings.push(finding);
}

/** Return whether auth middleware should treat a route as public. */
function isPathPublic(pathname: string, publicPaths: readonly string[]): boolean {
  return publicPaths.some((publicPath) => {
    if (publicPath === '/') return true;
    return pathname === publicPath || pathname.startsWith(`${trimTrailingSlash(publicPath)}/`);
  });
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') && value.length > 1 ? value.slice(0, -1) : value;
}

/** Return whether two relative or absolute disk paths overlap. */
function pathsOverlap(left: string, right: string): boolean {
  const a = normalizeDiskPath(left);
  const b = normalizeDiskPath(right);
  return a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`);
}

/** Normalize disk paths for doctor comparisons without touching the file system. */
function normalizeDiskPath(value: string): string {
  return path.resolve(value);
}

/** Return whether the supplied env map represents production mode. */
function isProduction(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === 'production';
}

function usesResend(config: EmailConfig): boolean {
  const provider = config.provider ?? 'resend';
  return provider === 'resend';
}

function isDuration(value: string): boolean {
  return /^\d+(s|m|h|d)$/.test(value);
}
