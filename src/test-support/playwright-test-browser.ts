/**
 * Process-local Chromium lifecycle for Bun browser tests.
 *
 * Bun executes multiple test files in one process. Repeatedly starting and
 * stopping Playwright's driver in that process can leave a later
 * `chromium.launch()` waiting indefinitely on macOS. Browser suites lease one
 * shared process instead. A short idle window lets the next suite reuse it,
 * while still guaranteeing that focused test runs close Chromium and exit.
 */

import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';

const IDLE_CLOSE_MS = 5_000;
const LAUNCH_TIMEOUT_MS = 30_000;

let activeBrowser: Browser | undefined;
let activeLeases = 0;
let launchPromise: Promise<Browser> | undefined;
let closePromise: Promise<void> | undefined;
let idleCloseTimer: ReturnType<typeof setTimeout> | undefined;

export const playwrightTestBrowserAvailable = existsSync(chromium.executablePath());

export interface PlaywrightTestBrowserLease {
  readonly browser: Browser;
  release(): void;
}

export async function acquirePlaywrightTestBrowser(): Promise<PlaywrightTestBrowserLease> {
  if (!playwrightTestBrowserAvailable) {
    throw new Error('Playwright Chromium is not installed');
  }

  cancelIdleClose();
  activeLeases += 1;

  try {
    if (closePromise) await closePromise;
    const browser = await connectedBrowser();
    let released = false;
    return {
      browser,
      release() {
        if (released) return;
        released = true;
        releaseBrowserLease();
      },
    };
  } catch (cause) {
    releaseBrowserLease();
    throw cause;
  }
}

async function connectedBrowser(): Promise<Browser> {
  if (activeBrowser?.isConnected()) return activeBrowser;
  activeBrowser = undefined;

  if (!launchPromise) {
    const pendingLaunch = chromium.launch({
      headless: true,
      timeout: LAUNCH_TIMEOUT_MS,
    });
    launchPromise = pendingLaunch;
    void pendingLaunch.then(
      (browser) => {
        activeBrowser = browser;
        browser.on('disconnected', () => {
          if (activeBrowser === browser) activeBrowser = undefined;
        });
        // A launch can settle after its waiting test hook has already failed
        // and released the final lease. Retire that late browser normally.
        if (activeLeases === 0) scheduleIdleClose();
      },
      () => undefined,
    ).finally(() => {
      if (launchPromise === pendingLaunch) launchPromise = undefined;
    });
  }

  return launchPromise;
}

function releaseBrowserLease(): void {
  activeLeases = Math.max(0, activeLeases - 1);
  if (activeLeases > 0) return;

  cancelIdleClose();
  scheduleIdleClose();
}

function scheduleIdleClose(): void {
  if (activeLeases > 0 || idleCloseTimer) return;
  idleCloseTimer = setTimeout(() => {
    idleCloseTimer = undefined;
    if (activeLeases > 0 || closePromise) return;

    const browser = activeBrowser;
    activeBrowser = undefined;
    if (!browser?.isConnected()) return;

    const pendingClose = browser.close().catch(() => {
      // A disconnected browser is already closed from the test process's
      // perspective. The next lease will launch a clean replacement.
    });
    closePromise = pendingClose;
    void pendingClose.finally(() => {
      if (closePromise === pendingClose) closePromise = undefined;
    });
  }, IDLE_CLOSE_MS);
}

function cancelIdleClose(): void {
  if (!idleCloseTimer) return;
  clearTimeout(idleCloseTimer);
  idleCloseTimer = undefined;
}
