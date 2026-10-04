/** Browser coverage for awaited editing, retry, deduplication, and scope aborts. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import {
  acquirePlaywrightTestBrowser,
  playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const TEST_TIMEOUT = 60_000;
let browser: Browser | undefined;
let browserLease: PlaywrightTestBrowserLease | undefined;
let buildDir: string | undefined;
let bundlePath: string | undefined;

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  browserLease = await acquirePlaywrightTestBrowser();
  browser = browserLease.browser;
  const repositoryRoot = join(import.meta.dir, '../../..');
  const scratchRoot = join(repositoryRoot, '.zero');
  await mkdir(scratchRoot, { recursive: true });
  buildDir = await mkdtemp(join(scratchRoot, 'editable-cell-browser-'));
  const entrypoint = join(buildDir, 'entry.tsx');
  bundlePath = join(buildDir, 'bundle.js');
  await writeFile(entrypoint, fixtureSource(join(
    repositoryRoot,
    'src/components/data-table/editable-cell.tsx',
  )));
  const result = await Bun.build({
    entrypoints: [entrypoint],
    root: repositoryRoot,
    outdir: buildDir,
    naming: 'bundle.js',
    target: 'browser',
    format: 'iife',
    plugins: [{
      name: 'standalone-table-auth-boundary',
      setup(build) {
        build.onResolve({ filter: /frontend\/client\/(client-context|authorization-scope-hooks)$/ }, (args) => ({
          path: args.path.endsWith('client-context') ? 'client-context' : 'authorization-boundary',
          namespace: 'table-test',
        }));
        build.onLoad({ filter: /.*/, namespace: 'table-test' }, (args) => ({
          loader: 'js',
          contents: args.path === 'client-context'
            ? 'export function useClientMaybe(){ return null; }'
            : `export function useAuthorizationScopeBoundary(){
                return { key:'standalone', scopeKey:'standalone', dataRevision:0,
                  stable:true, ready:true, phase:'idle' };
              }`,
        }));
      },
    }],
  });
  if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n'));
}, TEST_TIMEOUT);

afterAll(async () => {
  try {
    if (buildDir) await rm(buildDir, { recursive: true, force: true });
  } finally {
    browserLease?.release();
  }
}, TEST_TIMEOUT);

describe('EditableCell browser lifecycle', () => {
  browserTest('awaits acceptance, deduplicates Enter/blur, and retries safely', async () => {
    const page = await openHarness();
    try {
      await beginEdit(page);
      const input = editorInput(page);
      await input.fill('Grace');
      await input.press('Tab');
      await input.evaluate((element) => (element as HTMLInputElement).blur());
      await waitForSaveState(page, 'pending');

      expect(await page.evaluate(() => window.__editableCellHarness.saves())).toBe(1);
      expect(await input.isDisabled()).toBe(true);
      expect(await page.getByRole('button', { name: 'Next cell' }).evaluate(
        (element) => document.activeElement === element,
      )).toBe(false);

      await page.evaluate(() => window.__editableCellHarness.resolve());
      await page.waitForFunction(() => window.__editableCellHarness.refreshes() === 1);
      expect(await editorInput(page).isVisible()).toBe(true);
      expect(await page.locator('[data-slot="editable-cell-editor"]').getAttribute('data-save-state'))
        .toBe('pending');
      expect(await page.getByRole('button', { name: 'Next cell' }).evaluate(
        (element) => document.activeElement === element,
      )).toBe(false);
      await page.evaluate(() => window.__editableCellHarness.resolveRefresh());
      await page.waitForFunction(() => window.__editableCellHarness.value() === 'Grace');
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Next cell');

      await page.evaluate(() => window.__editableCellHarness.mode('failure'));
      await page.evaluate(() => window.__editableCellHarness.refreshMode('immediate'));
      await beginEdit(page);
      await editorInput(page).fill('Rejected draft');
      await editorInput(page).press('Tab');
      await waitForSaveState(page, 'error');

      expect(await page.getByRole('alert').textContent())
        .toContain('The change could not be saved. Try again.');
      expect(await page.locator('body').textContent()).not.toContain('private server detail');
      expect(await editorInput(page).isVisible()).toBe(true);

      await page.evaluate(() => window.__editableCellHarness.mode('pending'));
      await page.getByRole('button', { name: /Retry/ }).click();
      await waitForSaveState(page, 'pending');
      expect(await page.evaluate(() => window.__editableCellHarness.saves())).toBe(3);
      await page.evaluate(() => window.__editableCellHarness.resolve());
      await page.waitForFunction(() => window.__editableCellHarness.value() === 'Rejected draft');
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT);

  browserTest('aborts pending work when the explicit source boundary changes', async () => {
    const page = await openHarness();
    try {
      await beginEdit(page);
      await editorInput(page).fill('Stale write');
      await editorInput(page).press('Enter');
      await waitForSaveState(page, 'pending');

      await page.evaluate(() => window.__editableCellHarness.scope('tenant:beta'));
      await page.waitForFunction(() => window.__editableCellHarness.signalAborted());
      expect(await page.evaluate(() => window.__editableCellHarness.value())).toBe('Ada');

      await page.evaluate(() => window.__editableCellHarness.resolve());
      await page.waitForTimeout(0);
      expect(await page.evaluate(() => window.__editableCellHarness.value())).toBe('Ada');
      expect(await page.locator('[data-save-state="error"]').count()).toBe(0);
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT);

  browserTest('aborts pending work immediately when the table unmounts', async () => {
    const page = await openHarness();
    try {
      await beginEdit(page);
      await editorInput(page).fill('Unmounted write');
      await editorInput(page).press('Enter');
      await waitForSaveState(page, 'pending');

      await page.evaluate(() => window.__editableCellHarness.unmount());
      await page.waitForFunction(() => window.__editableCellHarness.signalAborted());
      await page.evaluate(() => window.__editableCellHarness.resolve());
      await page.waitForTimeout(0);
      expect(await page.evaluate(() => window.__editableCellHarness.value())).toBe('Ada');
      expect(await page.locator('#root').textContent()).toBe('');
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT);
});

async function openHarness(): Promise<Page> {
  if (!browser || !bundlePath) throw new Error('Browser harness unavailable');
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ path: bundlePath });
  await page.waitForFunction(() => typeof window.__editableCellHarness === 'object');
  return page;
}

async function beginEdit(page: Page): Promise<void> {
  await page.locator('[data-slot="editable-cell-display"]').click();
  await editorInput(page).waitFor({ state: 'visible' });
}

function editorInput(page: Page) {
  return page.locator('[data-slot="editable-cell-editor"] input').first();
}

async function waitForSaveState(page: Page, state: string): Promise<void> {
  await page.waitForFunction((expected) => (
    document.querySelector('[data-slot="editable-cell-editor"]')
      ?.getAttribute('data-save-state') === expected
  ), state);
}

function fixtureSource(componentPath: string): string {
  return `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { EditableCell } from ${JSON.stringify(componentPath)};

let value = 'Ada';
let editing = false;
let scope = 'tenant:alpha';
let saveMode = 'pending';
let saveCount = 0;
let pendingResolve = null;
let refreshMode = 'pending';
let refreshCount = 0;
let pendingRefreshResolve = null;
let lastSignal = null;
const root = createRoot(document.getElementById('root'));

async function save(_rowId, _columnId, next, context) {
  saveCount += 1;
  lastSignal = context?.signal ?? null;
  if (saveMode === 'failure') throw new Error('private server detail');
  await new Promise((resolve) => { pendingResolve = resolve; });
  if (context?.signal.aborted) return;
  value = next;
}

async function refresh() {
  refreshCount += 1;
  if (refreshMode === 'pending') {
    await new Promise((resolve) => { pendingRefreshResolve = resolve; });
  }
}

function render() {
  root.render(React.createElement(React.StrictMode, null,
    React.createElement('div', null,
      React.createElement(EditableCell, {
        value,
        rowId: 'row-1',
        columnId: 'name',
        fieldMeta: { type: 'text', label: 'Name', required: true },
        isEditing: editing,
        mutationBoundaryKey: scope,
        onRefresh: refresh,
        onStartEdit: () => { editing = true; render(); },
        onSave: save,
        onAccepted: () => { editing = false; render(); },
        onCancel: () => { editing = false; render(); },
        onTabNext: () => document.querySelector('[aria-label="Next cell"]')?.focus(),
      }),
      React.createElement('button', { type: 'button', 'aria-label': 'Next cell' }, 'Next'),
    ),
  ));
}

window.__editableCellHarness = {
  saves: () => saveCount,
  refreshes: () => refreshCount,
  value: () => value,
  signalAborted: () => lastSignal?.aborted === true,
  mode: (next) => { saveMode = next; },
  resolve: () => { const resolve = pendingResolve; pendingResolve = null; resolve?.(); },
  resolveRefresh: () => {
    const resolve = pendingRefreshResolve;
    pendingRefreshResolve = null;
    resolve?.();
  },
  refreshMode: (next) => { refreshMode = next; },
  scope: (next) => { scope = next; render(); },
  unmount: () => root.unmount(),
};
render();
`;
}

declare global {
  interface Window {
    __editableCellHarness: {
      saves(): number;
      refreshes(): number;
      value(): string;
      signalAborted(): boolean;
      mode(value: 'pending' | 'failure'): void;
      resolve(): void;
      resolveRefresh(): void;
      refreshMode(value: 'pending' | 'immediate'): void;
      scope(value: string): void;
      unmount(): void;
    };
  }
}
