/**
 * pdf-error.ts
 *
 * Defines stable PDF domain failures shared by configuration, rendering, and
 * storage composition. This file does not launch a browser or emit events.
 */

/** Stable error codes returned by Zero's PDF subsystem. */
export type PdfErrorCode =
  | 'PDF_CONFIG_INVALID'
  | 'PDF_DISABLED'
  | 'PDF_INPUT_INVALID'
  | 'PDF_LIMIT_EXCEEDED'
  | 'PDF_QUEUE_FULL'
  | 'PDF_QUEUE_TIMEOUT'
  | 'PDF_BROWSER_UNAVAILABLE'
  | 'PDF_RESOURCE_DENIED'
  | 'PDF_RENDER_TIMEOUT'
  | 'PDF_RENDER_FAILED'
  | 'PDF_OUTPUT_INVALID'
  | 'PDF_STORAGE_UNAVAILABLE'
  | 'PDF_STORAGE_FAILED'
  | 'PDF_SERVICE_CLOSED';

/**
 * Domain error produced by PDF configuration, rendering, or storage work.
 *
 * `details` must contain operational metadata only. Never attach source HTML,
 * rendered document text, secrets, or URL query strings.
 */
export class PdfError extends Error {
  constructor(
    message: string,
    readonly code: PdfErrorCode,
    readonly details: Record<string, unknown> = {},
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'PdfError';
  }
}
