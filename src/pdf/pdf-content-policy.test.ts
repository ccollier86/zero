/** Verifies CSP construction and first-head injection for PDF documents. */

import { describe, expect, test } from 'bun:test';

import { resolvePdfConfig } from './pdf-config';
import {
  applyPdfContentPolicy,
  buildPdfContentSecurityPolicy,
} from './pdf-content-policy';

describe('PDF content security policy', () => {
  test('allows configured inline resources while disabling scripts and workers', () => {
    const config = resolvePdfConfig(true, {});
    if (config === false) throw new Error('Expected PDF config.');

    const policy = buildPdfContentSecurityPolicy(undefined, config.resources, false);
    expect(policy).toContain('img-src http: https: data:');
    expect(policy).toContain("script-src 'none'");
    expect(policy).toContain("worker-src 'none'");
    expect(policy).not.toContain('blob:');
  });

  test('injects policy before existing head resources', () => {
    const config = resolvePdfConfig({ resources: { allowDataUrls: false } }, {});
    if (config === false) throw new Error('Expected PDF config.');
    const html = applyPdfContentPolicy(
      '<html><head><link rel="stylesheet" href="https://example.com/app.css"></head></html>',
      'https://example.com/',
      config.resources,
      false
    );

    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<link'));
    expect(html).not.toContain('data:');
    expect(html).toContain('base-uri https://example.com');
  });
});
