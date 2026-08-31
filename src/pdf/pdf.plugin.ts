/**
 * pdf.plugin.ts
 *
 * Integrates PdfService with Elysia lifecycle and request decoration. This
 * plugin owns service registration/cleanup only and exposes no HTTP routes.
 */

import { Elysia } from 'elysia';

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { PdfError } from './pdf-error';
import { PdfService, type PdfServiceOptions } from './pdf-service';
import type { ResolvedPdfConfig } from './pdf-types';

let activePdfService: PdfService | null = null;

/** Options accepted by the named PDF Elysia plugin. */
export interface PdfPluginConfig extends PdfServiceOptions {
  config: ResolvedPdfConfig;
  service?: PdfService;
}

/**
 * Create the PDF lifecycle plugin.
 *
 * The plugin decorates Elysia context with `pdf`, starts no browser until the
 * first render, and closes any renderer process during app shutdown.
 */
export function createPdfPlugin(options: PdfPluginConfig) {
  const service = options.service ?? new PdfService(options.config, options);
  activePdfService = service;

  return new Elysia({ name: 'zero-platform-pdf' })
    .decorate('pdf', service)
    .onStart(() => {
      emitPlatformCode(OBS_CODES.PDF_CONFIGURED, {
        metadata: {
          renderer: service.status().renderer,
          remoteResources: options.config.resources.remote,
          maxConcurrency: options.config.limits.maxConcurrency,
        },
      });
    })
    .onStop(async () => {
      await service.close();
      if (activePdfService === service) activePdfService = null;
      emitPlatformCode(OBS_CODES.PDF_STOPPED, {
        metadata: { renderer: service.status().renderer },
      });
    });
}

/** Return the process-wide PDF service, or null when PDF is disabled/not mounted. */
export function getPdfService(): PdfService | null {
  return activePdfService;
}

/** Return the active PDF service or throw a stable disabled error. */
export function requirePdfService(): PdfService {
  const service = getPdfService();
  if (!service) {
    throw new PdfError('PDF is not enabled. Set `pdf: true` in zero.config.ts.', 'PDF_DISABLED');
  }
  return service;
}
