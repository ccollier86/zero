/**
 * pdf-browser-install.ts
 *
 * Locates and installs the Playwright-managed Chromium binary used by Zero's
 * default PDF adapter. This file owns process invocation only; CLI output and
 * PDF rendering live elsewhere.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PdfError } from './pdf-error';

/** Public-safe status for the Playwright-managed Chromium executable. */
export interface PdfBrowserInstallStatus {
  installed: boolean;
  executablePath: string;
}

/** Return the expected managed Chromium path and whether it exists. */
export async function getPdfBrowserInstallStatus(): Promise<PdfBrowserInstallStatus> {
  const runtimePackage = ['play', 'wright'].join('');
  const { chromium } = await import(runtimePackage) as typeof import('playwright');
  const executablePath = chromium.executablePath();
  return {
    installed: existsSync(executablePath),
    executablePath,
  };
}

/** Install the Chromium revision pinned by Zero's Playwright dependency. */
export async function installPdfBrowser(options: { withDependencies?: boolean } = {}): Promise<void> {
  const packageJson = import.meta.resolve('playwright/package.json');
  const cliPath = fileURLToPath(new URL('./cli.js', packageJson));
  const args = [process.execPath, cliPath, 'install'];
  if (options.withDependencies) args.push('--with-deps');
  args.push('chromium');

  const child = Bun.spawn(args, {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: Bun.env,
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new PdfError(
      `Chromium installation failed with exit code ${exitCode}.`,
      'PDF_BROWSER_UNAVAILABLE',
      { exitCode }
    );
  }
}
