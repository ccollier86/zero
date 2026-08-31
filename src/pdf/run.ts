/**
 * run.ts
 *
 * Human-facing CLI for installing and inspecting Zero's PDF browser runtime.
 * Console output is intentional here; reusable operations live in
 * pdf-browser-install.ts.
 */

import { getPdfBrowserInstallStatus, installPdfBrowser } from './pdf-browser-install';

/** Run `zero pdf` command arguments and return a process exit code. */
export async function runPdfCli(args: string[]): Promise<number> {
  const command = args[0] ?? 'status';
  if (command === '--help' || command === '-h' || command === 'help') {
    printUsage();
    return 0;
  }

  if (command === 'status') {
    const status = await getPdfBrowserInstallStatus();
    console.log(status.installed ? 'Chromium is installed.' : 'Chromium is not installed.');
    console.log(status.executablePath);
    return status.installed ? 0 : 1;
  }

  if (command === 'install') {
    await installPdfBrowser({ withDependencies: args.includes('--with-deps') });
    const status = await getPdfBrowserInstallStatus();
    console.log(`Chromium ready: ${status.executablePath}`);
    return 0;
  }

  console.error(`Unknown PDF command: ${command}`);
  printUsage();
  return 1;
}

function printUsage(): void {
  console.log('Usage: zero pdf <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  install       Install the pinned Chromium browser');
  console.log('  status        Check the managed Chromium executable');
  console.log('');
  console.log('Options:');
  console.log('  --with-deps   Ask Playwright to install Linux system dependencies');
}
