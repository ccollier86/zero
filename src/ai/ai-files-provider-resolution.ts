/** Hosted-files capability resolution for an active Zero AI registry. */

import type { FilesV4 } from '@ai-sdk/provider';

import { AIError } from './ai-errors';
import type { AIRegistry, ResolvedAIFilesProvider } from './ai-registry';
import type {
  AIFilesProviderStatus,
  AIProviderFileOperations,
  ResolvedAIConfig,
  ResolvedAIProviderConfig,
} from './ai-types';

/** Resolve a provider-hosted files interface. */
export function resolveFilesProvider(
  registry: AIRegistry,
  requestedProvider: string | undefined,
  defaultProvider: string | null | undefined,
): ResolvedAIFilesProvider {
  const providerId = requestedProvider?.trim() || defaultProvider?.trim();
  if (!providerId) {
    throw new AIError(
      'No AI files provider was selected. Configure ai.filesProvider or provide a provider id.',
      'AI_PROVIDER_NOT_CONFIGURED',
      400,
    );
  }

  const provider = registry.providers[providerId];
  if (!provider) {
    throw new AIError(
      `AI files provider "${providerId}" is not configured.`,
      'AI_PROVIDER_NOT_CONFIGURED',
      400,
    );
  }
  if (!provider.active || !registry.providerInstances[provider.id]) {
    throw new AIError(
      `AI files provider "${providerId}" is not active: ${provider.reason ?? 'not configured'}.`,
      'AI_PROVIDER_NOT_ACTIVE',
      503,
    );
  }
  if (!provider.capabilities.files) {
    throw new AIError(
      `AI provider "${providerId}" does not support hosted file uploads.`,
      'AI_CAPABILITY_NOT_SUPPORTED',
      400,
    );
  }

  const files = getProviderFiles(registry, providerId);
  if (!files) {
    throw new AIError(
      `AI provider "${providerId}" does not expose the AI SDK hosted-files interface.`,
      'AI_CAPABILITY_NOT_SUPPORTED',
      400,
    );
  }

  return {
    provider,
    files,
    operations: fileOperations(provider, files),
    ...(registry.emitCode === undefined ? {} : { emitCode: registry.emitCode }),
  };
}

/** Return public-safe readiness for the configured hosted-files provider. */
export function getAIFilesProviderStatus(
  config: ResolvedAIConfig,
  registry: AIRegistry,
): AIFilesProviderStatus | null {
  const providerId = config.filesProvider;
  if (!providerId) return null;

  const unavailable = (
    reason: string,
    operations: AIProviderFileOperations = emptyFileOperations(),
  ): AIFilesProviderStatus => ({ providerId, active: false, reason, operations });
  const provider = config.providers[providerId];
  if (!provider) return unavailable('provider_not_configured');
  if (!provider.active || !registry.providerInstances[providerId]) {
    return unavailable(provider.reason ?? 'provider_not_active');
  }
  if (!provider.capabilities.files) {
    return unavailable('capability_files_not_supported');
  }

  const files = getProviderFiles(registry, providerId);
  if (!files) return unavailable('files_api_unavailable');
  const operations = fileOperations(provider, files);
  if (!operations.upload) return unavailable('files_upload_unavailable', operations);
  return { providerId, active: true, reason: null, operations };
}

function getProviderFiles(registry: AIRegistry, providerId: string): FilesV4 | null {
  try {
    return registry.registry.files(providerId);
  } catch {
    return null;
  }
}

function fileOperations(
  provider: ResolvedAIProviderConfig,
  files: FilesV4,
): AIProviderFileOperations {
  return {
    upload: Boolean(provider.capabilities.files && typeof files.uploadFile === 'function'),
    metadata: Boolean(
      provider.capabilities.fileMetadata && typeof files.getFileMetadata === 'function'
    ),
    download: Boolean(
      provider.capabilities.fileDownload && typeof files.downloadFile === 'function'
    ),
    delete: Boolean(provider.capabilities.fileDelete && typeof files.deleteFile === 'function'),
  };
}

function emptyFileOperations(): AIProviderFileOperations {
  return { upload: false, metadata: false, download: false, delete: false };
}
