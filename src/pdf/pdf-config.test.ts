/**
 * pdf-config.test.ts
 *
 * Verifies secure PDF defaults and configuration validation without launching
 * a browser.
 */

import { describe, expect, test } from 'bun:test';

import { PdfError } from './pdf-error';
import { mergePdfPrintOptions, resolvePdfConfig } from './pdf-config';

describe('resolvePdfConfig', () => {
  test('keeps PDF opt-in and applies secure browser defaults', () => {
    expect(resolvePdfConfig(undefined, {})).toBe(false);

    const config = resolvePdfConfig(true, {});
    expect(config).not.toBe(false);
    if (config === false) return;

    expect(config.browser.headless).toBe(true);
    expect(config.browser.javaScriptEnabled).toBe(false);
    expect(config.resources.remote).toBe('deny');
    expect(config.resources.blockPrivateNetworks).toBe(true);
    expect(config.defaults.printBackground).toBe(true);
    expect(config.defaults.preferCSSPageSize).toBe(true);
    expect(config.limits.maxConcurrency).toBe(2);
  });

  test('reads an explicit Chromium path from env', () => {
    const config = resolvePdfConfig(true, {
      ZERO_PDF_EXECUTABLE_PATH: '/opt/chromium',
    });
    expect(config).not.toBe(false);
    if (config !== false) expect(config.browser.executablePath).toBe('/opt/chromium');
  });

  test('normalizes allowed origins and rejects invalid limits', () => {
    const config = resolvePdfConfig({
      resources: {
        remote: 'allowlist',
        allowedOrigins: ['https://assets.example.com/path'],
      },
    }, {});
    expect(config).not.toBe(false);
    if (config !== false) {
      expect(config.resources.allowedOrigins.has('https://assets.example.com')).toBe(true);
    }

    expect(() => resolvePdfConfig({ limits: { maxConcurrency: 0 } }, {})).toThrow(PdfError);
    expect(() => resolvePdfConfig({ defaults: { scale: 3 } }, {})).toThrow(PdfError);
  });

  test('rejects malformed runtime security configuration instead of coercing it', () => {
    expect(() => resolvePdfConfig({
      browser: { javaScriptEnabled: 'false' as unknown as boolean },
    }, {})).toThrow(PdfError);
    expect(() => resolvePdfConfig({
      resources: { deniedBehavior: 'errors' as 'error' },
    }, {})).toThrow(PdfError);
    expect(() => resolvePdfConfig({
      resources: { allowedOrigins: 'https://example.com' as unknown as string[] },
    }, {})).toThrow(PdfError);
  });
});

describe('mergePdfPrintOptions', () => {
  test('lets custom dimensions replace a default named format', () => {
    const options = mergePdfPrintOptions(
      { format: 'Letter', printBackground: true },
      { width: '5in', height: '7in' }
    );

    expect(options.format).toBeUndefined();
    expect(options.width).toBe('5in');
    expect(options.height).toBe('7in');
    expect(options.printBackground).toBe(true);
  });

  test('merges individual margin overrides', () => {
    expect(mergePdfPrintOptions(
      { margin: { top: '1in', bottom: '1in' } },
      { margin: { bottom: '0.5in' } }
    ).margin).toEqual({ top: '1in', bottom: '0.5in' });
  });
});
