/**
 * platform-doctor-ai-vector.ts
 *
 * Pure diagnostics for AI provider/model readiness and local vector index
 * configuration, including the optional AI embeddings bridge.
 */

import path from 'node:path';

import { parseAIModelReference } from '../ai/ai-model-aliases';
import { hasAICapability } from '../ai/ai-provider-catalog';
import type {
  AICapability,
  ResolvedAIConfig,
  ResolvedAIProviderConfig,
} from '../ai/ai-types';
import type { ResolvedConfig } from '../frontend/server/types';
import {
  addPlatformDoctorFinding as addFinding,
  type PlatformDoctorFindingSink,
} from './platform-doctor-contracts';

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

/** Validate AI provider activation, model aliases, and status endpoint policy. */
export function checkAI(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
  env: Record<string, string | undefined>,
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

/** Validate local vector index layout, scoping metadata, and AI bridge readiness. */
export function checkVector(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
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

/** Emit focused provider readiness guidance for explicit AI providers. */
function checkAIProvider(
  provider: ResolvedAIProviderConfig,
  findings: PlatformDoctorFindingSink,
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

/** Verify vector bridge calls have a usable embeddings-capable AI alias. */
function checkVectorEmbeddingAlias(
  ai: ResolvedAIConfig,
  findings: PlatformDoctorFindingSink,
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
    },
  );
}

/** Validate a provider/model reference without instantiating provider clients. */
function checkAIModelReference(
  ai: ResolvedAIConfig,
  alias: string,
  model: string,
  capability: AICapability,
  findingPath: string,
  findings: PlatformDoctorFindingSink,
  options: { codePrefix?: string; docs?: string } = {},
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

function isProduction(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === 'production';
}
