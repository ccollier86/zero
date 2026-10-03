/**
 * Exercises the compact table search's focus, clear, keyboard, controlled
 * value, and reduced-motion lifecycle in a real browser.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';

import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import {
  acquirePlaywrightTestBrowser,
  playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
// Launching and driving a real Chromium process can be CPU-starved when Bun
// runs the full suite in parallel. Keep a bounded browser-specific budget so
// Bun does not time out a still-running case and let suite teardown close the
// shared browser underneath the remaining cases.
const BROWSER_HOOK_TIMEOUT_MS = 60_000;
const BROWSER_TEST_TIMEOUT_MS = 60_000;

let browser: Browser | undefined;
let browserLease: PlaywrightTestBrowserLease | undefined;
let buildDir: string | undefined;
let bundlePath: string | undefined;
let stylesheetPath: string | undefined;

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  browserLease = await acquirePlaywrightTestBrowser();
  browser = browserLease.browser;

  const scratchRoot = join(process.cwd(), '.zero');
  await mkdir(scratchRoot, { recursive: true });
  buildDir = await mkdtemp(join(scratchRoot, 'data-table-search-browser-'));
  const entrypoint = join(buildDir, 'entry.tsx');
  bundlePath = join(buildDir, 'bundle.js');
  const componentPath = join(import.meta.dir, 'data-table-search.tsx');

  await writeFile(entrypoint, browserFixtureSource(componentPath));
  const result = await Bun.build({
    entrypoints: [entrypoint],
    root: process.cwd(),
    outdir: buildDir,
    naming: 'bundle.js',
    target: 'browser',
    format: 'iife',
  });
  if (!result.success) {
    throw new Error(result.logs.map((log) => log.message).join('\n'));
  }
  stylesheetPath = (
    await buildPlatformStyles(buildDir, join(buildDir, 'missing-app'))
  ).cssPath;

}, BROWSER_HOOK_TIMEOUT_MS);

afterAll(async () => {
  try {
    if (buildDir) await rm(buildDir, { recursive: true, force: true });
  } finally {
    browserLease?.release();
  }
}, BROWSER_HOOK_TIMEOUT_MS);

describe('DataTableSearch browser lifecycle', () => {
  browserTest('expands on focus, persists with a value, clears, and collapses with Escape', async () => {
    const page = await openHarness();
    try {
      const root = page.locator('[data-slot="data-table-search"]');
      const input = page.getByRole('searchbox', { name: 'Search records' });

      expect(await root.getAttribute('data-open')).toBe('false');
      await input.click();
      await waitForOpen(page, true);

      await input.fill('Ada');
      await input.evaluate((element) => (element as HTMLInputElement).blur());
      await page.waitForFunction(() => (
        document.querySelector('[role="searchbox"]')?.getAttribute('value') === 'Ada'
      ));
      expect(await root.getAttribute('data-open')).toBe('true');

      const clear = page.getByRole('button', { name: 'Clear search' });
      await clear.click();
      expect(await input.inputValue()).toBe('');
      expect(await input.evaluate((element) => document.activeElement === element)).toBe(true);

      await input.press('Escape');
      await waitForOpen(page, false);
      expect(await input.evaluate((element) => document.activeElement === element)).toBe(false);
    } finally {
      await closePage(page);
    }
  }, BROWSER_TEST_TIMEOUT_MS);

  browserTest('clears a populated field before collapsing it', async () => {
    const page = await openHarness();
    try {
      await page.evaluate(() => window.__tableSearchHarness.setValue('pending'));
      const root = page.locator('[data-slot="data-table-search"]');
      const input = page.getByRole('searchbox', { name: 'Search records' });
      await input.click();

      await page.evaluate(() => window.__tableSearchHarness.preventEscape(true));
      await input.press('Escape');
      expect(await input.inputValue()).toBe('pending');

      await page.evaluate(() => window.__tableSearchHarness.preventEscape(false));
      await input.press('Enter');
      expect(await page.evaluate(() => window.__tableSearchHarness.submitCount())).toBe(0);

      await input.press('Escape');
      expect(await input.inputValue()).toBe('');
      expect(await root.getAttribute('data-open')).toBe('true');

      await input.press('Escape');
      await waitForOpen(page, false);
    } finally {
      await closePage(page);
    }
  }, BROWSER_TEST_TIMEOUT_MS);

  browserTest('honors reduced motion while retaining the same interaction contract', async () => {
    if (!browser || !bundlePath) throw new Error('DataTableSearch browser harness was not initialized');
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    try {
      await mountHarness(page);
      const root = page.locator('[data-slot="data-table-search"]');
      const input = page.getByRole('searchbox', { name: 'Search records' });

      await page.waitForFunction(() => (
        document.querySelector('[data-slot="data-table-search"]')
          ?.getAttribute('data-reduced-motion') === 'true'
      ));
      await input.click();
      await waitForOpen(page, true);
      expect(await root.getAttribute('data-reduced-motion')).toBe('true');
      await input.fill('reduced');
      expect(await input.inputValue()).toBe('reduced');
    } finally {
      await closePage(page);
    }
  }, BROWSER_TEST_TIMEOUT_MS);

  browserTest('caps the expanded surface inside a narrow toolbar', async () => {
    if (!browser) throw new Error('DataTableSearch browser harness was not initialized');
    const page = await browser.newPage({ viewport: { width: 220, height: 240 } });
    try {
      await mountHarness(page);
      const root = page.locator('[data-slot="data-table-search"]');
      const input = page.getByRole('searchbox', { name: 'Search records' });

      await input.click();
      await waitForOpen(page, true);
      await page.waitForTimeout(450);

      expect(await root.evaluate((element) => (element as HTMLElement).style.maxWidth))
        .toBe('100%');
      expect(await input.locator('..').evaluate(
        (element) => (element as HTMLElement).style.maxWidth,
      )).toBe('calc(100% - 38px)');
    } finally {
      await closePage(page);
    }
  }, BROWSER_TEST_TIMEOUT_MS);

  browserTest('uses the native card palette in light and dark themes', async () => {
    const page = await openHarness();
    try {
      const light = await readSearchThemeColors(page);

      expect(light.colorScheme).toBe('light');
      expect(light.surface).toBe(light.expectedSurface);
      expect(light.foreground).toBe(light.expectedForeground);
      expect(light.placeholder).toBe(light.expectedPlaceholder);

      await page.evaluate(() => document.documentElement.classList.add('dark'));
      const dark = await readSearchThemeColors(page);

      expect(dark.colorScheme).toBe('dark');
      expect(dark.surface).toBe(dark.expectedSurface);
      expect(dark.foreground).toBe(dark.expectedForeground);
      expect(dark.placeholder).toBe(dark.expectedPlaceholder);
      expect(dark.surface).not.toBe(light.surface);
      expect(dark.foreground).not.toBe(light.foreground);
    } finally {
      await closePage(page);
    }
  }, BROWSER_TEST_TIMEOUT_MS);
});

async function openHarness(): Promise<Page> {
  if (!browser) throw new Error('DataTableSearch browser harness was not initialized');
  const page = await browser.newPage();
  await mountHarness(page);
  return page;
}

async function closePage(page: Page): Promise<void> {
  if (page.isClosed()) return;

  try {
    await page.close();
  } catch (error) {
    // Bun can begin suite teardown after a timed-out test while that test's
    // finally block is still unwinding. Do not let Playwright's resulting
    // already-disposed-context error obscure the original timeout. All other
    // close failures remain visible.
    if (!isAlreadyDisposedContextError(error)) throw error;
  }
}

function isAlreadyDisposedContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Target page, context or browser has been closed')
    || (
      message.includes('Target.disposeBrowserContext')
      && message.toLowerCase().includes('failed to find context')
    );
}

async function mountHarness(page: Page): Promise<void> {
  if (!bundlePath || !stylesheetPath) {
    throw new Error('DataTableSearch browser harness was not initialized');
  }
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ path: stylesheetPath });
  await page.addScriptTag({ path: bundlePath });
  await page.waitForFunction(() => typeof window.__tableSearchHarness === 'object');
}

async function readSearchThemeColors(page: Page): Promise<{
  colorScheme: string;
  surface: string;
  foreground: string;
  placeholder: string;
  expectedSurface: string;
  expectedForeground: string;
  expectedPlaceholder: string;
}> {
  return page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[role="searchbox"]');
    const surface = input?.parentElement;
    if (!input || !surface) throw new Error('Expected the table search surface');

    const tokenProbe = document.createElement('span');
    tokenProbe.style.backgroundColor = 'var(--card)';
    tokenProbe.style.color = 'var(--card-foreground)';
    tokenProbe.style.borderColor = 'var(--muted-foreground)';
    document.body.append(tokenProbe);

    const rootStyle = getComputedStyle(document.documentElement);
    const surfaceStyle = getComputedStyle(surface);
    const probeStyle = getComputedStyle(tokenProbe);
    const values = {
      colorScheme: rootStyle.colorScheme,
      surface: surfaceStyle.backgroundColor,
      foreground: surfaceStyle.color,
      placeholder: getComputedStyle(input, '::placeholder').color,
      expectedSurface: probeStyle.backgroundColor,
      expectedForeground: probeStyle.color,
      expectedPlaceholder: probeStyle.borderColor,
    };

    tokenProbe.remove();
    return values;
  });
}

async function waitForOpen(page: Page, open: boolean): Promise<void> {
  await page.waitForFunction((expected) => (
    document.querySelector('[data-slot="data-table-search"]')
      ?.getAttribute('data-open') === String(expected)
  ), open);
}

function browserFixtureSource(componentPath: string): string {
  return `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { DataTableSearch } from ${JSON.stringify(componentPath)};

const root = createRoot(document.getElementById('root'));
let currentValue = '';
let preventEscape = false;
let submissions = 0;

function render() {
  root.render(React.createElement('form', {
    onSubmit(event) {
      event.preventDefault();
      submissions += 1;
    },
  }, React.createElement(DataTableSearch, {
      value: currentValue,
      label: 'Search records',
      onValueChange(value) {
        currentValue = value;
        render();
      },
      onKeyDown(event) {
        if (preventEscape && event.key === 'Escape') event.preventDefault();
      },
    })));
}

window.__tableSearchHarness = {
  setValue(value) {
    currentValue = value;
    render();
  },
  preventEscape(value) {
    preventEscape = value;
    render();
  },
  submitCount() {
    return submissions;
  },
};

render();
`;
}

declare global {
  interface Window {
    __tableSearchHarness: {
      setValue(value: string): void;
      preventEscape(value: boolean): void;
      submitCount(): number;
    };
  }
}
