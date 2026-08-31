/**
 * pdf-types.ts
 *
 * Defines framework-neutral contracts for PDF rendering, browser policy, and
 * storage composition. This file intentionally contains no Playwright or
 * Elysia runtime code.
 */

import type { FileInfo } from '../storage/types';

/** Common page formats accepted by Chromium. Custom dimensions remain supported. */
export type PdfPageFormat =
  | 'Letter'
  | 'Legal'
  | 'Tabloid'
  | 'Ledger'
  | 'A0'
  | 'A1'
  | 'A2'
  | 'A3'
  | 'A4'
  | 'A5'
  | 'A6';

/** CSS-compatible PDF page margins. Numbers are interpreted as CSS pixels. */
export interface PdfMargins {
  top?: string | number;
  right?: string | number;
  bottom?: string | number;
  left?: string | number;
}

/** Print options accepted by Zero's browser renderer. */
export interface PdfPrintOptions {
  /** Named paper format. Cannot be combined with width/height. Default: Letter. */
  format?: PdfPageFormat | string;
  /** Custom paper width such as `8.5in`. */
  width?: string | number;
  /** Custom paper height such as `11in`. */
  height?: string | number;
  /** Print in landscape orientation. Default: false. */
  landscape?: boolean;
  /** Include CSS backgrounds and colors. Default: true. */
  printBackground?: boolean;
  /** Let CSS `@page` size override the configured paper size. Default: true. */
  preferCSSPageSize?: boolean;
  /** Scale between 0.1 and 2. Default: 1. */
  scale?: number;
  /** Print only selected page ranges, for example `1-3, 5`. */
  pageRanges?: string;
  /** Page margins. */
  margin?: PdfMargins;
  /** Display Chromium header and footer templates. */
  displayHeaderFooter?: boolean;
  /** Header HTML. Scripts are never executed. */
  headerTemplate?: string;
  /** Footer HTML. Scripts are never executed. */
  footerTemplate?: string;
  /** Generate a tagged, accessibility-aware PDF. Default: true. */
  tagged?: boolean;
  /** Embed the document outline. Default: false. */
  outline?: boolean;
}

/** Remote-resource access mode used while Chromium renders app HTML. */
export type PdfRemoteResourceMode = 'deny' | 'same-origin' | 'allowlist' | 'allow';

/** Behavior when document markup requests a blocked resource. */
export type PdfDeniedResourceBehavior = 'error' | 'omit';

/** App-facing resource security policy. */
export interface PdfResourcePolicyConfig {
  /** Remote HTTP(S) access. Default: deny. */
  remote?: PdfRemoteResourceMode;
  /** Exact HTTP(S) origins accepted in allowlist mode. */
  allowedOrigins?: readonly string[];
  /** Fail the render or omit blocked resources. Default: error. */
  deniedBehavior?: PdfDeniedResourceBehavior;
  /** Permit inline `data:` resources. Default: true. */
  allowDataUrls?: boolean;
  /** Permit `blob:` resources. Default: false. */
  allowBlobUrls?: boolean;
  /** Reject obvious loopback/private-network hosts. Default: true. */
  blockPrivateNetworks?: boolean;
}

/** Fully normalized resource policy consumed by a renderer adapter. */
export interface ResolvedPdfResourcePolicy {
  remote: PdfRemoteResourceMode;
  allowedOrigins: ReadonlySet<string>;
  deniedBehavior: PdfDeniedResourceBehavior;
  allowDataUrls: boolean;
  allowBlobUrls: boolean;
  blockPrivateNetworks: boolean;
}

/** Chromium process settings. */
export interface PdfBrowserConfig {
  /** Explicit Chromium executable. Defaults to Playwright's managed browser. */
  executablePath?: string;
  /** Run without a visible browser window. Default: true. */
  headless?: boolean;
  /** Additional Chromium launch arguments for a controlled deployment. */
  launchArgs?: readonly string[];
  /** Browser startup timeout in milliseconds. Default: 30 seconds. */
  launchTimeoutMs?: number;
  /** Allow document JavaScript. Default: false. Enable only for trusted HTML. */
  javaScriptEnabled?: boolean;
}

/** Normalized Chromium settings consumed by the default adapter. */
export interface ResolvedPdfBrowserConfig {
  executablePath?: string;
  headless: boolean;
  launchArgs: readonly string[];
  launchTimeoutMs: number;
  javaScriptEnabled: boolean;
}

/** Resource and concurrency limits for PDF work. */
export interface PdfLimitsConfig {
  /** Maximum UTF-8 HTML, metadata, and header/footer template size. Default: 2 MiB. */
  maxHtmlBytes?: number;
  /** Maximum UTF-8 supplemental CSS size. Default: 512 KiB. */
  maxCssBytes?: number;
  /** Maximum generated PDF size. Default: 25 MiB. */
  maxOutputBytes?: number;
  /** Maximum total render time. Default: 30 seconds. */
  timeoutMs?: number;
  /** Maximum simultaneous Chromium renders. Default: 2. */
  maxConcurrency?: number;
  /** Maximum queued renders. Default: 50. */
  maxQueue?: number;
}

/** Fully normalized PDF limits. */
export interface ResolvedPdfLimits extends Required<PdfLimitsConfig> {}

/** Top-level PDF configuration accepted by `createApp()`. */
export interface PdfConfig {
  /** Replace Chromium with an app-owned renderer adapter. */
  renderer?: PdfRenderer;
  /** Chromium settings used by the default renderer. */
  browser?: PdfBrowserConfig;
  /** Resource-fetch policy applied to every render. */
  resources?: PdfResourcePolicyConfig;
  /** Default print options merged with each render request. */
  defaults?: PdfPrintOptions;
  /** Input, output, timeout, and concurrency limits. */
  limits?: PdfLimitsConfig;
  /** Wait for `document.fonts.ready` before printing. Default: true. */
  waitForFonts?: boolean;
}

/** Fully normalized PDF runtime configuration. */
export interface ResolvedPdfConfig {
  enabled: true;
  renderer?: PdfRenderer;
  browser: ResolvedPdfBrowserConfig;
  resources: ResolvedPdfResourcePolicy;
  defaults: PdfPrintOptions;
  limits: ResolvedPdfLimits;
  waitForFonts: boolean;
}

/** Optional metadata applied when Zero wraps an HTML fragment as a document. */
export interface PdfDocumentMetadata {
  title?: string;
  lang?: string;
}

/** One HTML-to-PDF request. */
export interface PdfRenderInput {
  /** Full HTML document or an HTML fragment. */
  html: string;
  /** Supplemental print/web CSS inserted into the document head. */
  css?: string;
  /** Base HTTP(S) URL used to resolve relative resources. */
  baseUrl?: string;
  /** Metadata used when wrapping a fragment or filling a missing title/lang. */
  document?: PdfDocumentMetadata;
  /** Per-document print options merged over configured defaults. */
  options?: PdfPrintOptions;
  /** Optional lower render timeout; cannot exceed the configured limit. */
  timeoutMs?: number;
}

/** Normalized render request passed from PdfService to a renderer adapter. */
export interface PreparedPdfRenderInput {
  html: string;
  baseUrl?: string;
  options: PdfPrintOptions;
  resources: ResolvedPdfResourcePolicy;
  timeoutMs: number;
  waitForFonts: boolean;
}

/** Raw output returned by a renderer adapter. */
export interface PdfRendererResult {
  bytes: Uint8Array;
  renderer: string;
}

/** Optional renderer readiness information. */
export interface PdfRendererStatus {
  name: string;
  ready: boolean;
}

/**
 * Replaceable HTML-to-PDF adapter boundary.
 *
 * Implementations receive normalized, bounded requests and must return PDF
 * bytes. `close()` must release any browser/process resources they own.
 */
export interface PdfRenderer {
  readonly name: string;
  render(input: PreparedPdfRenderInput): Promise<PdfRendererResult>;
  close(): Promise<void>;
  status?(): PdfRendererStatus;
}

/** Stable application-facing result returned by `PdfService.render()`. */
export interface PdfRenderResult {
  bytes: Uint8Array;
  contentType: 'application/pdf';
  size: number;
  renderer: string;
}

/** Storage destination used by `PdfService.renderToStorage()`. */
export interface PdfStorageTarget {
  driveId: string;
  path: string;
  /** User recorded as the object creator. Defaults to null for system work. */
  createdBy?: string | null;
  /** Replace an existing object at the same path. Default: false. */
  overwrite?: boolean;
  /** Make the stored PDF publicly readable. Default: false. */
  public?: boolean;
  /** App-owned storage metadata. */
  metadata?: Record<string, unknown>;
}

/** Internal write request consumed by the narrow storage adapter boundary. */
export interface PdfStorageWriteInput extends PdfStorageTarget {
  bytes: Uint8Array;
  renderer: string;
}

/** Minimal storage dependency consumed by PdfService. */
export interface PdfStorageWriter {
  write(input: PdfStorageWriteInput): Promise<FileInfo>;
}

/** Result returned after rendering and storing a PDF. */
export interface PdfStoredResult extends PdfRenderResult {
  file: FileInfo;
}

/** Public-safe PDF runtime status. */
export interface PdfServiceStatus {
  renderer: string;
  ready: boolean;
  active: number;
  queued: number;
  closed: boolean;
}
