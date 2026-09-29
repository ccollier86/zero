/**
 * platform-doctor-pdf.ts
 *
 * Pure PDF browser provisioning and remote-resource security diagnostics.
 */

import { existsSync } from 'node:fs';

import type { ResolvedConfig } from '../frontend/server/types';
import {
  addPlatformDoctorFinding as addFinding,
  type PlatformDoctorFindingSink,
} from './platform-doctor-contracts';

/** Validate PDF browser provisioning and deliberate resource security choices. */
export function checkPdf(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
): void {
  if (resolved.pdf === false) return;
  const pdf = resolved.pdf;

  if (!pdf.renderer && pdf.browser.executablePath && !existsSync(pdf.browser.executablePath)) {
    addFinding(findings, {
      severity: 'error',
      code: 'pdf.browser.executable_missing',
      path: 'pdf.browser.executablePath',
      message: `The configured PDF Chromium executable does not exist: ${pdf.browser.executablePath}`,
      hint: 'Fix ZERO_PDF_EXECUTABLE_PATH or remove it and run `zero pdf install`.',
      docs: './docs/pdf.md#browser-installation',
    });
  } else if (!pdf.renderer && !pdf.browser.executablePath) {
    addFinding(findings, {
      severity: 'info',
      code: 'pdf.browser.managed',
      path: 'pdf',
      message: 'PDF uses Playwright-managed Chromium. Verify the deploy image with `zero pdf status`.',
      hint: 'Run `zero pdf install` during image/build provisioning when status reports it missing.',
      docs: './docs/pdf.md#browser-installation',
    });
  }

  if (pdf.resources.remote === 'allowlist' && pdf.resources.allowedOrigins.size === 0) {
    addFinding(findings, {
      severity: 'warning',
      code: 'pdf.resources.allowlist_empty',
      path: 'pdf.resources.allowedOrigins',
      message: 'PDF remote resource mode is allowlist, but no origins are configured.',
      hint: 'Add exact trusted origins or use remote: "deny" for fully inline documents.',
      docs: './docs/pdf.md#resource-security',
    });
  }

  if (pdf.resources.remote === 'allow') {
    addFinding(findings, {
      severity: 'warning',
      code: 'pdf.resources.remote_unrestricted',
      path: 'pdf.resources.remote',
      message: 'PDF rendering allows arbitrary remote HTTP(S) resources.',
      hint: 'Prefer an exact origin allowlist to reduce SSRF and document-tracking risk.',
      docs: './docs/pdf.md#resource-security',
    });
  }

  if (!pdf.resources.blockPrivateNetworks) {
    addFinding(findings, {
      severity: 'warning',
      code: 'pdf.resources.private_network_allowed',
      path: 'pdf.resources.blockPrivateNetworks',
      message: 'PDF rendering may request loopback or private-network resources.',
      hint: 'Keep private-network blocking enabled unless the renderer runs in an isolated trusted network.',
      docs: './docs/pdf.md#resource-security',
    });
  }

  if (pdf.browser.javaScriptEnabled) {
    addFinding(findings, {
      severity: 'warning',
      code: 'pdf.browser.javascript_enabled',
      path: 'pdf.browser.javaScriptEnabled',
      message: 'PDF document JavaScript is enabled.',
      hint: 'Only enable JavaScript for trusted app-owned HTML; never pass unsanitized user markup.',
      docs: './docs/pdf.md#resource-security',
    });
  }
}
