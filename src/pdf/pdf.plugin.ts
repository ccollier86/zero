/**
 * pdf.plugin.ts
 *
 * Integrates PdfService with Elysia lifecycle and request decoration. This
 * plugin owns service registration/cleanup only and exposes no HTTP routes.
 */

import { Elysia } from 'elysia';

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, emitPlatformCodeTo } from '../observability/sink';
import { PdfError } from './pdf-error';
import { PdfService, type PdfServiceOptions } from './pdf-service';
import { ZeroPdfStorageWriter } from './pdf-storage-writer';
import type { ResolvedPdfConfig } from './pdf-types';
import { CompatibilityProviderRegistry } from '../runtime/compatibility-provider-registry';
import { ZERO_OBSERVABILITY_RUNTIME, ZERO_PDF_SERVICE, ZERO_STORAGE_SERVICE } from '../runtime/service-keys';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';

const pdfProviders = new CompatibilityProviderRegistry<PdfService>('PDF service');

/** Options accepted by the named PDF Elysia plugin. */
export interface PdfPluginConfig extends PdfServiceOptions {
  config: ResolvedPdfConfig;
  service?: PdfService;
  runtime?: ZeroAppRuntime;
  onServiceCreated?: (service: PdfService) => void;
}

/**
 * Create the PDF lifecycle plugin.
 *
 * The plugin decorates Elysia context with `pdf`, starts no browser until the
 * first render, and closes any renderer process during app shutdown.
 */
export function createPdfPlugin(options: PdfPluginConfig) {
  const runtime = options.runtime;
  const observability = runtime?.require(ZERO_OBSERVABILITY_RUNTIME) ?? null;
  const emitCode: typeof emitPlatformCode = observability
    ? (definition, event) => emitPlatformCodeTo(observability, definition, event)
    : options.emitCode ?? emitPlatformCode;
  const storage = options.storage ?? (runtime
    ? new ZeroPdfStorageWriter(() => runtime.get(ZERO_STORAGE_SERVICE))
    : undefined);
  const service = options.service ?? new PdfService(options.config, { ...options, storage, emitCode });
  const owner = {};
  let started = false;
  const registration = pdfProviders.register(owner, () => started ? service : null);
  let cleanupPromise: Promise<void> | null = null;
  const cleanup = (): Promise<void> => cleanupPromise ??= (async () => {
    try {
      await service.close();
    } finally {
      started = false;
      runtime?.clear(ZERO_PDF_SERVICE, service);
      registration.unregister();
    }
  })();
  try {
    // Install teardown ownership before publishing to any caller-controlled callback.
    runtime?.addCleanup(cleanup);
    runtime?.set(ZERO_PDF_SERVICE, service);
    options.onServiceCreated?.(service);
  } catch (error) {
    void cleanup().catch(() => {
      emitCode(OBS_CODES.APP_LIFECYCLE_FAILED, {
        error: new Error('PDF startup cleanup failed.'),
        metadata: { phase: 'start', plugin: 'zero-platform-pdf' },
      });
    });
    throw new PdfError('PDF service composition failed.', 'PDF_CONFIG_INVALID', {
      stage: 'composition',
    }, { cause: error });
  }

  return new Elysia({ name: 'zero-platform-pdf' })
    .decorate('pdf', service)
    .onStart(() => {
      started = true;
      emitCode(OBS_CODES.PDF_CONFIGURED, {
        metadata: {
          renderer: service.status().renderer,
          remoteResources: options.config.resources.remote,
          maxConcurrency: options.config.limits.maxConcurrency,
        },
      });
    })
    .onStop(async () => {
      await cleanup();
      emitCode(OBS_CODES.PDF_STOPPED, {
        metadata: { renderer: service.status().renderer },
      });
    });
}

/** Return the process-wide PDF service, or null when PDF is disabled/not mounted. */
export function getPdfService(): PdfService | null {
  return pdfProviders.get();
}

/** Return the active PDF service or throw a stable disabled error. */
export function requirePdfService(): PdfService {
  const service = getPdfService();
  if (!service) {
    throw new PdfError('PDF is not enabled. Set `pdf: true` in zero.config.ts.', 'PDF_DISABLED');
  }
  return service;
}
