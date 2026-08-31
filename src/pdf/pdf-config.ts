/**
 * pdf-config.ts
 *
 * Normalizes and validates PDF app configuration. This file owns policy and
 * numeric defaults only; it does not launch Chromium or render documents.
 */

import { PdfError } from './pdf-error';
import type {
  PdfConfig,
  PdfPrintOptions,
  PdfResourcePolicyConfig,
  ResolvedPdfConfig,
  ResolvedPdfResourcePolicy,
} from './pdf-types';

const MIB = 1024 * 1024;
const DEFAULT_LIMITS = {
  maxHtmlBytes: 2 * MIB,
  maxCssBytes: 512 * 1024,
  maxOutputBytes: 25 * MIB,
  timeoutMs: 30_000,
  maxConcurrency: 2,
  maxQueue: 50,
} as const;

/** Environment map accepted by the testable PDF config resolver. */
export type PdfEnv = Record<string, string | undefined>;

/**
 * Resolve `createApp({ pdf })` configuration.
 *
 * Returns false when omitted/disabled. `pdf: true` enables secure Chromium
 * defaults; an explicit renderer can replace Chromium through dependency
 * inversion without changing the PdfService API.
 */
export function resolvePdfConfig(
  input: boolean | PdfConfig | undefined,
  env: PdfEnv = Bun.env
): ResolvedPdfConfig | false {
  if (input === false || input === undefined) return false;
  if (input !== true && (!input || typeof input !== 'object' || Array.isArray(input))) {
    throw configError('pdf', 'PDF config must be true, false, or an object.');
  }
  const config: PdfConfig = input === true ? {} : input;
  assertOptionalObject(config.browser, 'pdf.browser');
  assertOptionalObject(config.resources, 'pdf.resources');
  assertOptionalObject(config.defaults, 'pdf.defaults');
  assertOptionalObject(config.limits, 'pdf.limits');
  validateRenderer(config.renderer);
  const defaults = mergePdfPrintOptions({
    format: 'Letter',
    printBackground: true,
    preferCSSPageSize: true,
    tagged: true,
  }, config.defaults);

  return {
    enabled: true,
    renderer: config.renderer,
    browser: {
      executablePath: cleanOptionalString(
        config.browser?.executablePath ?? env.ZERO_PDF_EXECUTABLE_PATH,
        'pdf.browser.executablePath'
      ),
      headless: optionalBoolean(config.browser?.headless, true, 'pdf.browser.headless'),
      launchArgs: stringArray(config.browser?.launchArgs, 'pdf.browser.launchArgs'),
      launchTimeoutMs: positiveInteger(
        config.browser?.launchTimeoutMs,
        30_000,
        'pdf.browser.launchTimeoutMs'
      ),
      javaScriptEnabled: optionalBoolean(
        config.browser?.javaScriptEnabled,
        false,
        'pdf.browser.javaScriptEnabled'
      ),
    },
    resources: resolveResourcePolicy(config.resources),
    defaults,
    limits: {
      maxHtmlBytes: positiveInteger(config.limits?.maxHtmlBytes, DEFAULT_LIMITS.maxHtmlBytes, 'pdf.limits.maxHtmlBytes'),
      maxCssBytes: positiveInteger(config.limits?.maxCssBytes, DEFAULT_LIMITS.maxCssBytes, 'pdf.limits.maxCssBytes'),
      maxOutputBytes: positiveInteger(config.limits?.maxOutputBytes, DEFAULT_LIMITS.maxOutputBytes, 'pdf.limits.maxOutputBytes'),
      timeoutMs: positiveInteger(config.limits?.timeoutMs, DEFAULT_LIMITS.timeoutMs, 'pdf.limits.timeoutMs'),
      maxConcurrency: positiveInteger(config.limits?.maxConcurrency, DEFAULT_LIMITS.maxConcurrency, 'pdf.limits.maxConcurrency'),
      maxQueue: nonNegativeInteger(config.limits?.maxQueue, DEFAULT_LIMITS.maxQueue, 'pdf.limits.maxQueue'),
    },
    waitForFonts: optionalBoolean(config.waitForFonts, true, 'pdf.waitForFonts'),
  };
}

/** Validate and copy per-document print options. */
export function resolvePrintOptions(options: PdfPrintOptions): PdfPrintOptions {
  if (options.format !== undefined && (options.width !== undefined || options.height !== undefined)) {
    throw configError('pdf.defaults', 'PDF format cannot be combined with custom width or height.');
  }
  if ((options.width === undefined) !== (options.height === undefined)) {
    throw configError('pdf.defaults', 'Custom PDF width and height must be provided together.');
  }
  if (options.scale !== undefined && (!Number.isFinite(options.scale) || options.scale < 0.1 || options.scale > 2)) {
    throw configError('pdf.defaults.scale', 'PDF scale must be between 0.1 and 2.');
  }
  if (options.pageRanges !== undefined && !/^[0-9,\-\s]*$/.test(options.pageRanges)) {
    throw configError('pdf.defaults.pageRanges', 'PDF pageRanges may contain only page numbers, commas, spaces, and dashes.');
  }

  return {
    ...options,
    margin: options.margin ? { ...options.margin } : undefined,
  };
}

/** Merge request print options over defaults without retaining conflicting paper dimensions. */
export function mergePdfPrintOptions(
  defaults: PdfPrintOptions,
  overrides: PdfPrintOptions = {}
): PdfPrintOptions {
  const merged: PdfPrintOptions = {
    ...defaults,
    ...overrides,
    margin: defaults.margin || overrides.margin
      ? { ...defaults.margin, ...overrides.margin }
      : undefined,
  };

  if ((overrides.width !== undefined || overrides.height !== undefined) && overrides.format === undefined) {
    delete merged.format;
  }
  if (overrides.format !== undefined) {
    delete merged.width;
    delete merged.height;
  }
  return resolvePrintOptions(merged);
}

function resolveResourcePolicy(config: PdfResourcePolicyConfig = {}): ResolvedPdfResourcePolicy {
  const allowedOrigins = new Set(stringArray(
    config.allowedOrigins,
    'pdf.resources.allowedOrigins'
  ).map(normalizeOrigin));
  return {
    remote: enumValue(
      config.remote,
      ['deny', 'same-origin', 'allowlist', 'allow'] as const,
      'deny',
      'pdf.resources.remote'
    ),
    allowedOrigins,
    deniedBehavior: enumValue(
      config.deniedBehavior,
      ['error', 'omit'] as const,
      'error',
      'pdf.resources.deniedBehavior'
    ),
    allowDataUrls: optionalBoolean(config.allowDataUrls, true, 'pdf.resources.allowDataUrls'),
    allowBlobUrls: optionalBoolean(config.allowBlobUrls, false, 'pdf.resources.allowBlobUrls'),
    blockPrivateNetworks: optionalBoolean(
      config.blockPrivateNetworks,
      true,
      'pdf.resources.blockPrivateNetworks'
    ),
  };
}

function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
    if (url.username || url.password) throw new Error('credentials are not allowed');
    return url.origin;
  } catch {
    throw configError('pdf.resources.allowedOrigins', `Invalid HTTP(S) origin: ${value}`);
  }
}

function positiveInteger(value: number | undefined, fallback: number, path: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw configError(path, `${path} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value: number | undefined, fallback: number, path: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0) {
    throw configError(path, `${path} must be a non-negative integer.`);
  }
  return value;
}

function cleanOptionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw configError(path, `${path} must be a string.`);
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalBoolean(value: unknown, fallback: boolean, path: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw configError(path, `${path} must be a boolean.`);
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw configError(path, `${path} must be an array of strings.`);
  }
  return [...value];
}

function enumValue<const TValue extends string>(
  value: unknown,
  values: readonly TValue[],
  fallback: TValue,
  path: string
): TValue {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !values.includes(value as TValue)) {
    throw configError(path, `${path} must be one of: ${values.join(', ')}.`);
  }
  return value as TValue;
}

function assertOptionalObject(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configError(path, `${path} must be an object.`);
  }
}

function validateRenderer(renderer: PdfConfig['renderer']): void {
  if (renderer === undefined) return;
  if (
    !renderer
    || typeof renderer !== 'object'
    || typeof renderer.name !== 'string'
    || renderer.name.trim().length === 0
    || typeof renderer.render !== 'function'
    || typeof renderer.close !== 'function'
  ) {
    throw configError(
      'pdf.renderer',
      'pdf.renderer must provide a non-empty name plus render() and close() methods.'
    );
  }
}

function configError(path: string, message: string): PdfError {
  return new PdfError(message, 'PDF_CONFIG_INVALID', { path });
}
