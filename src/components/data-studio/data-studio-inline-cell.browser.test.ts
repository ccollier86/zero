/** Real-browser coverage for Data Studio's non-negotiable inline-edit contract. */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import {
  acquirePlaywrightTestBrowser,
  playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';

const browserTest = test;
const TEST_TIMEOUT = 60_000;
let browser: Browser | undefined;
let browserLease: PlaywrightTestBrowserLease | undefined;
let buildDir: string | undefined;
let bundlePath: string | undefined;
let stylesheetPath: string | undefined;

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) throw new Error('Inline editor acceptance requires the existing Chromium fixture browser.');
  browserLease = await acquirePlaywrightTestBrowser();
  browser = browserLease.browser;
  const scratchRoot = '/Volumes/code-bank/tmp/scratch/zero-platform';
  await mkdir(scratchRoot, { recursive: true });
  buildDir = await mkdtemp(join(scratchRoot, 'data-studio-cell-browser-'));
  const entrypoint = join(buildDir, 'entry.tsx');
  bundlePath = join(buildDir, 'bundle.js');
  await Bun.write(entrypoint, fixtureSource(
    join(import.meta.dir, 'data-studio-inline-cell.tsx'),
    join(import.meta.dir, '../../frontend/client/data-studio-client.ts'),
  ));
  const builder = join(buildDir, 'build.ts');
  await Bun.write(builder, `const result = await Bun.build({
    entrypoints: [${JSON.stringify(entrypoint)}],
    root: ${JSON.stringify(process.cwd())},
    outdir: ${JSON.stringify(buildDir)},
    naming: 'bundle.js',
    target: 'browser',
    format: 'iife',
  });
  if (!result.success) { console.error(result.logs.map((log) => log.message).join('\\n')); process.exit(1); }`);
  const build = Bun.spawn({ cmd: [process.execPath, '--no-env-file', builder], cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, status] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
  if (status !== 0) throw new Error(`${stdout}\n${stderr}`);
  stylesheetPath = (await buildPlatformStyles(buildDir, join(buildDir, 'missing-app'))).cssPath;
}, TEST_TIMEOUT);

afterAll(async () => {
  try {
    if (buildDir) await rm(buildDir, { recursive: true, force: true });
  } finally {
    browserLease?.release();
  }
}, TEST_TIMEOUT);

describe('DataStudioInlineCell browser contract', () => {
  browserTest('preserves cell geometry and handles save, move, cancel, error, and conflict', async () => {
    const page = await openHarness();
    try {
      const cell = page.locator('[data-slot="data-studio-inline-cell"]');
      const editButton = () => page.getByRole('button', { name: /Edit Name/ });
      const before = await cell.boundingBox();
      if (!before) throw new Error('Expected the inline cell box');

      await editButton().click();
      const input = page.getByRole('textbox', { name: 'Edit Name' });
      const during = await cell.boundingBox();
      const editorStyle = await input.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          borderTop: style.borderTopWidth,
          borderRight: style.borderRightWidth,
          borderBottom: style.borderBottomWidth,
          borderLeft: style.borderLeftWidth,
        };
      });
      expect(during?.width).toBeCloseTo(before.width, 1);
      expect(during?.height).toBeCloseTo(before.height, 1);
      expect(editorStyle).toEqual({
        background: 'rgba(0, 0, 0, 0)',
        borderTop: '0px',
        borderRight: '0px',
        borderBottom: '0px',
        borderLeft: '0px',
      });

      await input.fill('discarded');
      await input.press('Escape');
      expect(await cell.textContent()).toContain('Ada');
      expect(await page.evaluate(() => window.__dataStudioCellHarness.commits())).toEqual([]);

      await editButton().click();
      await input.fill('Grace');
      await input.press('Tab');
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="data-studio-inline-cell"]')
          ?.getAttribute('data-save-state') === 'pending'
      ));
      expect(await cell.getAttribute('data-save-state')).toBe('pending');
      await page.evaluate(() => window.__dataStudioCellHarness.resolve());
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="data-studio-inline-cell"]')
          ?.getAttribute('data-save-state') === 'saved'
      ));
      expect(await cell.textContent()).toContain('Grace');
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Next cell');
      expect(await page.getByRole('button', { name: 'Next cell' }).evaluate(
        (element) => document.activeElement === element,
      )).toBe(true);

      await page.evaluate(() => window.__dataStudioCellHarness.setMode('error'));
      await editButton().click();
      await input.fill('broken');
      await input.press('Tab');
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="data-studio-inline-cell"]')
          ?.getAttribute('data-save-state') === 'error'
      ));
      expect(await cell.textContent()).toContain('Grace');
      expect(await editButton().evaluate((element) => document.activeElement === element)).toBe(true);

      await page.evaluate(() => window.__dataStudioCellHarness.setMode('conflict'));
      await editButton().click();
      await input.fill('stale');
      await input.press('Enter');
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="data-studio-inline-cell"]')
          ?.getAttribute('data-save-state') === 'conflict'
      ));
      expect(await cell.textContent()).toContain('Grace');
      expect(await page.evaluate(() => window.__dataStudioCellHarness.reloads())).toBe(2);
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT);

  browserTest('restores an authoritative refresh instead of rebasing a stale draft', async () => {
    const page = await openHarness();
    try {
      const cell = page.locator('[data-slot="data-studio-inline-cell"]');
      await page.getByRole('button', { name: /Edit Name/ }).click();
      await page.getByRole('textbox', { name: 'Edit Name' }).fill('Local stale draft');

      await page.evaluate(() => window.__dataStudioCellHarness.remote('Remote update'));
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="data-studio-inline-cell"]')
          ?.getAttribute('data-save-state') === 'conflict'
      ));

      expect(await cell.textContent()).toContain('Remote update');
      expect(await page.getByRole('textbox', { name: 'Edit Name' }).count()).toBe(0);
      expect(await page.evaluate(() => window.__dataStudioCellHarness.commits())).toEqual([]);
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT);

  browserTest('treats unchanged blur as an exact no-op for absence, null, and datetimes', async () => {
    const cases = [
      ['optional-text-undefined', 'Optional text', { present: false }],
      ['optional-text-null', 'Nullable text', { present: true, value: null }],
      ['optional-number-undefined', 'Optional number', { present: false }],
      ['optional-date-undefined', 'Optional date', { present: false }],
      ['optional-json-undefined', 'Optional JSON', { present: false }],
      [
        'precise-datetime',
        'Precise datetime',
        { present: true, value: '2026-02-03T17:45:37.123Z' },
      ],
    ] as const;

    for (const [fixture, label, expected] of cases) {
      const page = await openHarness();
      try {
        await page.evaluate((name) => window.__dataStudioCellHarness.configure(name), fixture);
        await page.getByRole('button', { name: new RegExp(`Edit ${label}`) }).click();
        const editor = page.locator(`input[aria-label="Edit ${label}"]`);
        await editor.waitFor({ state: 'visible' });
        if (fixture === 'optional-date-undefined' || fixture === 'precise-datetime') {
          // The floating picker may cover the synthetic next-cell button.
          await page.mouse.click(650, 500);
        } else await page.getByRole('button', { name: 'Next cell' }).click();
        await editor.waitFor({ state: 'detached' });

        expect(await page.evaluate(() => window.__dataStudioCellHarness.commits())).toEqual([]);
        expect(await page.evaluate(() => window.__dataStudioCellHarness.current())).toEqual(expected);
      } finally {
        await page.close();
      }
    }
  }, TEST_TIMEOUT);

  browserTest('retains seconds and milliseconds during an intentional datetime edit', async () => {
    const page = await openHarness();
    try {
      await page.evaluate(() => window.__dataStudioCellHarness.configure('precise-datetime'));
      await page.getByRole('button', { name: /Edit Precise datetime/ }).click();
      const seconds = page.getByRole('textbox', { name: 'Edit Precise datetime seconds', exact: true });
      expect(await seconds.inputValue()).toBe('37.123');
      await page.getByRole('combobox', { name: 'Edit Precise datetime time minute', exact: true }).click();
      await page.getByRole('option', { name: '46', exact: true }).click();
      expect(await seconds.inputValue()).toBe('37.123');
      expect(await page.evaluate(() => window.__dataStudioCellHarness.commits())).toEqual([]);
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="data-studio-inline-cell"]')
          ?.getAttribute('data-save-state') === 'pending'
      ));
      await page.evaluate(() => window.__dataStudioCellHarness.resolve());
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="data-studio-inline-cell"]')
          ?.getAttribute('data-save-state') === 'saved'
      ));

      expect(await page.evaluate(() => window.__dataStudioCellHarness.commits()))
        .toEqual(['2026-02-03T17:46:37.123Z']);
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT);

  browserTest('keyboard calendar and time choices remain drafts and do not bubble into surrounding row actions', async () => {
    const page = await openHarness(); try {
      await page.evaluate(() => window.__dataStudioCellHarness.configure('precise-datetime'));
      await page.getByRole('button', { name: /Edit Precise datetime/ }).click();
      await page.getByRole('button', { name: 'Open date picker', exact: true }).click();
      await page.evaluate(() => window.__dataStudioCellHarness.resetOuterClicks());
      await page.getByRole('button', { name: /February 4th, 2026/ }).press('Enter');
      expect(await page.evaluate(() => window.__dataStudioCellHarness.commits())).toEqual([]);
      expect(await page.evaluate(() => window.__dataStudioCellHarness.outerClicks())).toBe(0);
      expect(await page.getByRole('button', { name: 'Apply', exact: true }).isVisible()).toBe(true);
      await page.getByRole('combobox', { name: 'Edit Precise datetime time minute', exact: true }).click();
      await page.getByRole('option', { name: '46', exact: true }).press('Enter');
      expect(await page.evaluate(() => window.__dataStudioCellHarness.commits())).toEqual([]);
      expect(await page.evaluate(() => window.__dataStudioCellHarness.outerClicks())).toBe(0);
      await page.getByRole('button', { name: 'Open date picker', exact: true }).click();
      await page.keyboard.press('Escape');
      expect(await page.getByRole('button', { name: 'Apply', exact: true }).isVisible()).toBe(true);
      await page.getByRole('combobox', { name: 'Edit Precise datetime time minute', exact: true }).click();
      await page.keyboard.press('Escape');
      expect(await page.getByRole('button', { name: 'Apply', exact: true }).isVisible()).toBe(true);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(await page.evaluate(() => window.__dataStudioCellHarness.commits())).toEqual([]);
      expect(await page.evaluate(() => window.__dataStudioCellHarness.current())).toEqual({ present: true, value: '2026-02-03T17:45:37.123Z' });
    } finally { await page.close(); }
  }, TEST_TIMEOUT);

  browserTest('distinguishes an untouched blank from an intentionally emptied text value', async () => {
    const page = await openHarness();
    try {
      await page.evaluate(() => window.__dataStudioCellHarness.configure('optional-text-null'));
      await page.getByRole('button', { name: /Edit Nullable text/ }).click();
      const editor = page.getByRole('textbox', { name: 'Edit Nullable text' });
      await editor.fill('temporary');
      await editor.fill('');
      await editor.press('Enter');
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="data-studio-inline-cell"]')
          ?.getAttribute('data-save-state') === 'pending'
      ));

      expect(await page.evaluate(() => window.__dataStudioCellHarness.commits()))
        .toEqual(['']);
      await page.evaluate(() => window.__dataStudioCellHarness.resolve());
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="data-studio-inline-cell"]')
          ?.getAttribute('data-save-state') === 'saved'
      ));
      expect(await page.evaluate(() => window.__dataStudioCellHarness.current()))
        .toEqual({ present: true, value: '' });
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT);

  browserTest('keeps a new pending save locked past the previous saved timer', async () => {
    const page = await openHarness();
    try {
      const cell = page.locator('[data-slot="data-studio-inline-cell"]');
      const input = page.getByRole('textbox', { name: 'Edit Name' });

      await page.getByRole('button', { name: /Edit Name/ }).click();
      await input.fill('First save');
      await input.press('Enter');
      await page.evaluate(() => window.__dataStudioCellHarness.resolve());
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="data-studio-inline-cell"]')
          ?.getAttribute('data-save-state') === 'saved'
      ));

      await page.getByRole('button', { name: /Edit Name/ }).click();
      await input.fill('Second save');
      await input.press('Enter');
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="data-studio-inline-cell"]')
          ?.getAttribute('data-save-state') === 'pending'
      ));

      await page.waitForTimeout(1_300);
      expect(await cell.getAttribute('data-save-state')).toBe('pending');
      expect(await input.isDisabled()).toBe(true);
      expect(await page.evaluate(() => window.__dataStudioCellHarness.commits()))
        .toEqual(['First save', 'Second save']);

      await page.evaluate(() => window.__dataStudioCellHarness.resolve());
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="data-studio-inline-cell"]')
          ?.getAttribute('data-save-state') === 'saved'
      ));
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT);
});

async function openHarness(): Promise<Page> {
  if (!browser || !bundlePath || !stylesheetPath) throw new Error('Browser harness unavailable');
  const page = await browser.newPage({ timezoneId: 'UTC' });
  page.setDefaultTimeout(4_000);
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ path: stylesheetPath });
  await page.addScriptTag({ path: bundlePath });
  await page.waitForFunction(() => typeof window.__dataStudioCellHarness === 'object');
  return page;
}

function fixtureSource(componentPath: string, clientPath: string): string {
  return `
import * as React from ${JSON.stringify(Bun.resolveSync('react', import.meta.dir))};
import { createRoot } from ${JSON.stringify(Bun.resolveSync('react-dom/client', import.meta.dir))};
import { DataStudioInlineCell } from ${JSON.stringify(componentPath)};
import { DataStudioMutationError } from ${JSON.stringify(clientPath)};

let column = {
  columnId: 'name', key: 'name', label: 'Name', type: 'text', required: true,
};
let value = 'Ada';
let revision = 1;
let mode = 'pending';
let pending = null;
let commitValues = [];
let reloadCount = 0;
let outerClicks = 0;
const root = createRoot(document.getElementById('root'));

function commit(next) {
  commitValues.push(next);
  if (mode === 'error') return Promise.reject(new Error('Save rejected'));
  if (mode === 'conflict') return Promise.reject(new DataStudioMutationError(
    'Revision conflict', 'operation', { code: 'DATA_STUDIO_REVISION_CONFLICT' },
  ));
  return new Promise((resolve) => {
    pending = () => {
      value = next;
      revision += 1;
      render();
      resolve();
    };
  });
}

function render() {
  root.render(React.createElement('div', {
    style: { width: '240px', fontFamily: 'system-ui', fontSize: '14px' },
    onClick(){ outerClicks += 1; },
  }, React.createElement(DataStudioInlineCell, {
    value,
    column,
    revision,
    onCommit: commit,
    onReload: async () => { reloadCount += 1; },
    onNavigate: () => document.querySelector('[aria-label="Next cell"]')?.focus(),
  }), React.createElement('button', { type: 'button', 'aria-label': 'Next cell' }, 'Next')));
}

window.__dataStudioCellHarness = {
  resolve() { pending?.(); pending = null; },
  setMode(next) { mode = next; },
  remote(next) { value = next; revision += 1; render(); },
  configure(name) {
    mode = 'pending';
    pending = null;
    commitValues = [];
    revision += 1;
    if (name === 'optional-text-undefined') {
      value = undefined;
      column = { columnId: 'value', key: 'value', label: 'Optional text', type: 'text', required: false };
    } else if (name === 'optional-text-null') {
      value = null;
      column = { columnId: 'value', key: 'value', label: 'Nullable text', type: 'text', required: false };
    } else if (name === 'optional-number-undefined') {
      value = undefined;
      column = { columnId: 'value', key: 'value', label: 'Optional number', type: 'number', required: false };
    } else if (name === 'optional-date-undefined') {
      value = undefined;
      column = { columnId: 'value', key: 'value', label: 'Optional date', type: 'date', required: false };
    } else if (name === 'optional-json-undefined') {
      value = undefined;
      column = { columnId: 'value', key: 'value', label: 'Optional JSON', type: 'json', required: false };
    } else if (name === 'precise-datetime') {
      value = '2026-02-03T17:45:37.123Z';
      column = { columnId: 'value', key: 'value', label: 'Precise datetime', type: 'datetime', required: false };
    } else {
      throw new Error('Unknown fixture');
    }
    render();
  },
  current() {
    return value === undefined ? { present: false } : { present: true, value };
  },
  commits() { return commitValues; },
  reloads() { return reloadCount; },
  outerClicks() { return outerClicks; },
  resetOuterClicks() { outerClicks = 0; },
};
render();
`;
}

declare global {
  interface Window {
    __dataStudioCellHarness: {
      resolve(): void;
      setMode(mode: 'pending' | 'error' | 'conflict'): void;
      remote(value: string): void;
      configure(name: string): void;
      current(): { present: boolean; value?: unknown };
      commits(): unknown[];
      reloads(): number;
      outerClicks(): number;
      resetOuterClicks(): void;
    };
  }
}
