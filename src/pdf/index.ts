/** Server-only public entry point for Zero's PDF rendering subsystem. */

export {
  mergePdfPrintOptions,
  resolvePdfConfig,
  resolvePrintOptions,
  type PdfEnv,
} from './pdf-config';
export { composePdfDocument } from './pdf-document';
export {
  getPdfBrowserInstallStatus,
  installPdfBrowser,
  type PdfBrowserInstallStatus,
} from './pdf-browser-install';
export { PdfError, type PdfErrorCode } from './pdf-error';
export { createPdfPlugin, getPdfService, requirePdfService } from './pdf.plugin';
export { PdfService, type PdfServiceOptions } from './pdf-service';
export { ZeroPdfStorageWriter, type PdfStorageServiceGetter } from './pdf-storage-writer';
export { PlaywrightPdfRenderer } from './playwright-pdf-renderer';
export {
  evaluatePdfResource,
  sanitizePdfResourceUrl,
  type PdfResourceDecision,
} from './pdf-resource-policy';
export type {
  PdfBrowserConfig,
  PdfConfig,
  PdfDeniedResourceBehavior,
  PdfDocumentMetadata,
  PdfLimitsConfig,
  PdfMargins,
  PdfPageFormat,
  PdfPrintOptions,
  PdfRemoteResourceMode,
  PdfRenderInput,
  PdfRenderer,
  PdfRendererResult,
  PdfRendererStatus,
  PdfRenderResult,
  PdfResourcePolicyConfig,
  PdfServiceStatus,
  PdfStorageTarget,
  PdfStorageWriter,
  PdfStorageWriteInput,
  PdfStoredResult,
  PreparedPdfRenderInput,
  ResolvedPdfBrowserConfig,
  ResolvedPdfConfig,
  ResolvedPdfLimits,
  ResolvedPdfResourcePolicy,
} from './pdf-types';
