/**
 * pdf-service.ts
 *
 * Orchestrates validated HTML-to-PDF work across a renderer, bounded queue,
 * and optional storage writer. This service is framework-independent and does
 * not depend on Elysia request context.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { mergePdfPrintOptions } from './pdf-config';
import { composePdfDocument } from './pdf-document';
import { PdfError } from './pdf-error';
import { PdfRenderQueue } from './pdf-render-queue';
import { ZeroPdfStorageWriter } from './pdf-storage-writer';
import { PlaywrightPdfRenderer } from './playwright-pdf-renderer';
import type {
  PdfRenderInput,
  PdfRenderResult,
  PdfRenderer,
  PdfServiceStatus,
  PdfStorageTarget,
  PdfStorageWriter,
  PdfStoredResult,
  ResolvedPdfConfig,
} from './pdf-types';

const PDF_SIGNATURE = new TextEncoder().encode('%PDF-');

/** Constructor dependencies for PdfService. */
export interface PdfServiceOptions {
  renderer?: PdfRenderer;
  storage?: PdfStorageWriter;
}

/** High-level Zero API for rendering and optionally storing browser-grade PDFs. */
export class PdfService {
  private readonly renderer: PdfRenderer;
  private readonly storage: PdfStorageWriter;
  private readonly queue: PdfRenderQueue;
  private closed = false;

  constructor(
    private readonly config: ResolvedPdfConfig,
    options: PdfServiceOptions = {}
  ) {
    this.renderer = options.renderer
      ?? config.renderer
      ?? new PlaywrightPdfRenderer(config.browser);
    this.storage = options.storage ?? new ZeroPdfStorageWriter();
    this.queue = new PdfRenderQueue(config.limits.maxConcurrency, config.limits.maxQueue);
  }

  /** Render HTML/CSS into in-memory PDF bytes under configured limits and policy. */
  async render(input: PdfRenderInput): Promise<PdfRenderResult> {
    this.assertOpen();
    validateRenderInput(input, this.config);
    const timeoutMs = resolveRequestTimeout(input.timeoutMs, this.config.limits.timeoutMs);
    const document = composePdfDocument(input);
    const options = mergePdfPrintOptions(this.config.defaults, input.options);
    validateComposedInputSize(input, options, this.config.limits.maxHtmlBytes);
    const startedAt = performance.now();

    emitPlatformCode(OBS_CODES.PDF_RENDER_STARTED, {
      metadata: {
        renderer: this.renderer.name,
        htmlBytes: utf8Length(input.html),
        cssBytes: utf8Length(input.css ?? ''),
      },
    });

    try {
      const output = await this.queue.run(
        (remainingMs) => this.renderer.render({
          html: document.html,
          baseUrl: document.baseUrl,
          options,
          resources: this.config.resources,
          timeoutMs: remainingMs,
          waitForFonts: this.config.waitForFonts,
        }),
        timeoutMs
      );
      validatePdfOutput(output.bytes, this.config.limits.maxOutputBytes);

      const result: PdfRenderResult = {
        bytes: output.bytes,
        contentType: 'application/pdf',
        size: output.bytes.byteLength,
        renderer: output.renderer,
      };
      emitPlatformCode(OBS_CODES.PDF_RENDER_COMPLETED, {
        metadata: {
          renderer: result.renderer,
          size: result.size,
          elapsedMs: Math.round(performance.now() - startedAt),
        },
      });
      return result;
    } catch (error) {
      const normalized = normalizePdfError(error);
      emitPlatformCode(OBS_CODES.PDF_RENDER_FAILED, {
        error: normalized,
        metadata: {
          renderer: this.renderer.name,
          code: normalized.code,
          elapsedMs: Math.round(performance.now() - startedAt),
        },
      });
      throw normalized;
    }
  }

  /** Render a PDF and write it through Zero's storage service in one operation. */
  async renderToStorage(
    input: PdfRenderInput,
    target: PdfStorageTarget
  ): Promise<PdfStoredResult> {
    validateStorageTarget(target);
    const rendered = await this.render(input);
    try {
      const file = await this.storage.write({
        ...target,
        bytes: rendered.bytes,
        renderer: rendered.renderer,
      });
      emitPlatformCode(OBS_CODES.PDF_STORED, {
        metadata: {
          renderer: rendered.renderer,
          driveId: target.driveId,
          path: target.path,
          size: rendered.size,
        },
      });
      return { ...rendered, file };
    } catch (error) {
      const normalized = normalizePdfStorageError(error);
      emitPlatformCode(OBS_CODES.PDF_STORAGE_FAILED, {
        error: normalized,
        metadata: {
          renderer: rendered.renderer,
          driveId: target.driveId,
          path: target.path,
          code: normalized.code,
        },
      });
      throw normalized;
    }
  }

  /** Return public-safe queue and renderer readiness state. */
  status(): PdfServiceStatus {
    const renderer = this.renderer.status?.();
    return {
      renderer: renderer?.name ?? this.renderer.name,
      ready: renderer?.ready ?? !this.closed,
      active: this.queue.active,
      queued: this.queue.queued,
      closed: this.closed,
    };
  }

  /** Release renderer resources. Safe to call more than once. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.queue.close();
    await this.renderer.close();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new PdfError('The PDF service is closed.', 'PDF_SERVICE_CLOSED');
    }
  }
}

function validateRenderInput(input: PdfRenderInput, config: ResolvedPdfConfig): void {
  if (!input || typeof input.html !== 'string' || input.html.trim().length === 0) {
    throw new PdfError('PDF html must be a non-empty string.', 'PDF_INPUT_INVALID', { field: 'html' });
  }
  assertByteLimit('html', utf8Length(input.html), config.limits.maxHtmlBytes);
  if (input.css !== undefined && typeof input.css !== 'string') {
    throw new PdfError('PDF css must be a string.', 'PDF_INPUT_INVALID', { field: 'css' });
  }
  if (input.baseUrl !== undefined && typeof input.baseUrl !== 'string') {
    throw new PdfError('PDF baseUrl must be a string.', 'PDF_INPUT_INVALID', { field: 'baseUrl' });
  }
  if (input.document !== undefined) {
    if (!input.document || typeof input.document !== 'object' || Array.isArray(input.document)) {
      throw new PdfError('PDF document metadata must be an object.', 'PDF_INPUT_INVALID', {
        field: 'document',
      });
    }
    assertOptionalString(input.document.title, 'document.title');
    assertOptionalString(input.document.lang, 'document.lang');
  }
  if (
    input.options !== undefined
    && (!input.options || typeof input.options !== 'object' || Array.isArray(input.options))
  ) {
    throw new PdfError('PDF print options must be an object.', 'PDF_INPUT_INVALID', {
      field: 'options',
    });
  }
  assertByteLimit('css', utf8Length(input.css ?? ''), config.limits.maxCssBytes);
}

function validateComposedInputSize(
  input: PdfRenderInput,
  options: PdfRenderInput['options'],
  maximum: number
): void {
  assertOptionalString(options?.headerTemplate, 'options.headerTemplate');
  assertOptionalString(options?.footerTemplate, 'options.footerTemplate');
  const actual = [
    input.html,
    input.baseUrl,
    input.document?.title,
    input.document?.lang,
    options?.headerTemplate,
    options?.footerTemplate,
  ].reduce((total, value) => total + utf8Length(value ?? ''), 0);
  assertByteLimit('HTML and template content', actual, maximum);
}

function validateStorageTarget(target: PdfStorageTarget): void {
  if (!target?.driveId?.trim()) {
    throw new PdfError('PDF storage driveId is required.', 'PDF_INPUT_INVALID', { field: 'storage.driveId' });
  }
  if (!target.path?.trim()) {
    throw new PdfError('PDF storage path is required.', 'PDF_INPUT_INVALID', { field: 'storage.path' });
  }
}

function validatePdfOutput(bytes: Uint8Array, maxOutputBytes: number): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < PDF_SIGNATURE.length) {
    throw new PdfError('The PDF renderer returned no valid output.', 'PDF_OUTPUT_INVALID');
  }
  assertByteLimit('output', bytes.byteLength, maxOutputBytes);
  for (let index = 0; index < PDF_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PDF_SIGNATURE[index]) {
      throw new PdfError('The renderer output is not a PDF document.', 'PDF_OUTPUT_INVALID');
    }
  }
}

function resolveRequestTimeout(value: number | undefined, maximum: number): number {
  if (value === undefined) return maximum;
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new PdfError(
      `PDF timeoutMs must be a positive integer no greater than ${maximum}.`,
      'PDF_LIMIT_EXCEEDED',
      { field: 'timeoutMs', maximum }
    );
  }
  return value;
}

function assertByteLimit(field: string, actual: number, maximum: number): void {
  if (actual <= maximum) return;
  throw new PdfError(
    `PDF ${field} exceeds the configured byte limit.`,
    'PDF_LIMIT_EXCEEDED',
    { field, actual, maximum }
  );
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertOptionalString(value: unknown, field: string): asserts value is string | undefined {
  if (value === undefined || typeof value === 'string') return;
  throw new PdfError(`PDF ${field} must be a string.`, 'PDF_INPUT_INVALID', { field });
}

function normalizePdfError(error: unknown): PdfError {
  if (error instanceof PdfError) return error;
  return new PdfError('PDF rendering failed.', 'PDF_RENDER_FAILED', {}, { cause: error });
}

function normalizePdfStorageError(error: unknown): PdfError {
  if (error instanceof PdfError) return error;
  return new PdfError('PDF storage failed.', 'PDF_STORAGE_FAILED', {}, { cause: error });
}
