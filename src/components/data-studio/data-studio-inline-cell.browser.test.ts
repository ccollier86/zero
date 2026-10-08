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
      await page.waitForFunction(() => (
        document.activeElement === document.querySelector('button[data-data-studio-cell="true"]')
      ));
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

  browserTest('restores failed-save focus only after the requested reload settles', async () => {
    const page = await openHarness();
    try {
      await page.evaluate(() => {
        window.__dataStudioCellHarness.setMode('error');
        window.__dataStudioCellHarness.holdReload();
      });
      await page.getByRole('button', { name: /Edit Name/ }).click();
      const input = page.getByRole('textbox', { name: 'Edit Name' });
      await input.fill('Rejected draft');
      await input.press('Tab');
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="data-studio-inline-cell"]')
          ?.getAttribute('data-save-state') === 'error'
        && window.__dataStudioCellHarness.reloads() === 1
      ));

      const trigger = page.getByRole('button', { name: /Edit Name/ });
      expect(await page.locator('[data-slot="data-studio-inline-cell"]').textContent()).toContain('Ada');
      expect(await trigger.evaluate((element) => document.activeElement === element)).toBe(false);
      expect(await page.evaluate(() => window.__dataStudioCellHarness.navigations())).toBe(0);

      await page.evaluate(() => window.__dataStudioCellHarness.resolveReload());
      await page.waitForFunction(() => (
        document.activeElement === document.querySelector('button[data-data-studio-cell="true"]')
      ));
      expect(await trigger.evaluate((element) => document.activeElement === element)).toBe(true);
      expect(await page.evaluate(() => window.__dataStudioCellHarness.commits())).toEqual(['Rejected draft']);
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT);

  browserTest('does not navigate from an acknowledged older edit after a new edit starts', async () => {
    const page = await openHarness();
    try {
      await page.getByRole('button', { name: /Edit Name/ }).click();
      await page.getByRole('textbox', { name: 'Edit Name' }).fill('First save');
      await page.getByRole('textbox', { name: 'Edit Name' }).press('Tab');
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="data-studio-inline-cell"]')
          ?.getAttribute('data-save-state') === 'pending'
      ));
      await page.evaluate(() => {
        window.__dataStudioCellHarness.holdFrames();
        window.__dataStudioCellHarness.resolve();
      });
      // These checks deliberately use timer polling: frame callbacks are held
      // until a later edit has taken ownership of focus.
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="data-studio-inline-cell"]')
          ?.getAttribute('data-save-state') === 'saved'
        && window.__dataStudioCellHarness.heldFrames() > 0
      ), undefined, { polling: 10 });
      const trigger = page.getByRole('button', { name: /Edit Name/ });
      expect(await page.locator('[data-slot="data-studio-inline-cell"]').textContent()).toContain('First save');
      await trigger.evaluate((element) => (element as HTMLButtonElement).click());
      await page.waitForFunction(() => (
        document.activeElement?.getAttribute('aria-label') === 'Edit Name'
        && document.activeElement?.tagName === 'INPUT'
      ), undefined, { polling: 10 });

      await page.evaluate(() => window.__dataStudioCellHarness.releaseFrames());
      expect(await page.evaluate(() => window.__dataStudioCellHarness.navigations())).toBe(0);
      expect(await page.getByRole('textbox', { name: 'Edit Name' }).evaluate(
        (element) => document.activeElement === element,
      )).toBe(true);
      expect(await page.evaluate(() => window.__dataStudioCellHarness.commits())).toEqual(['First save']);
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
        const editor = fixture === 'optional-json-undefined'
          ? page.locator('[data-slot="json-editor"]')
          : page.locator(`input[aria-label="Edit ${label}"]`);
        await editor.waitFor({ state: 'visible' });
        if (fixture === 'optional-date-undefined' || fixture === 'precise-datetime' || fixture === 'optional-json-undefined') {
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

  browserTest('JSON opens the shared structured editor near the cell, retains invalid text and requires an acknowledged Apply', async () => {
    const page = await openHarness();
    try {
      await page.evaluate(() => window.__dataStudioCellHarness.configure('metadata-json'));
      const cell = page.locator('[data-slot="data-studio-inline-cell"]');
      const before = await cell.boundingBox();
      await page.getByRole('button', { name: /Edit Metadata/ }).click();
      const popup = page.locator('[data-slot="data-studio-cell-editor"]');
      await popup.waitFor();
      expect(await popup.locator('[data-slot="json-editor"]').count()).toBe(1);
      expect(await cell.locator('input').count()).toBe(0);
      const during = await cell.boundingBox();
      expect(during?.height).toBeCloseTo(before!.height, 1);
      expect(during?.width).toBeCloseTo(before!.width, 1);
      expect((await popup.boundingBox())!.y).toBeLessThan(before!.y + 90);
      await popup.getByRole('button', { name: 'Edit as text', exact: true }).click();
      const text = page.getByRole('textbox', { name: 'Edit Metadata JSON text', exact: true });
      await text.fill('{ invalid json');
      await popup.getByRole('button', { name: 'Apply', exact: true }).click();
      expect(await text.inputValue()).toBe('{ invalid json');
      expect(await popup.getByRole('alert').textContent()).toContain('Invalid JSON');
      expect(await page.evaluate(() => window.__dataStudioCellHarness.commits())).toEqual([]);
      await page.mouse.click(850, 650);
      await popup.getByRole('button', { name: 'Keep editing', exact: true }).click();
      expect(await text.inputValue()).toBe('{ invalid json');
      await text.fill('{"state":"published","attempts":2}');
      await popup.getByRole('button', { name: 'Apply', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[data-slot="data-studio-inline-cell"]')?.getAttribute('data-save-state') === 'pending');
      expect(await popup.getByRole('button', { name: 'Saving…', exact: true }).isDisabled()).toBe(true);
      expect(await page.evaluate(() => window.__dataStudioCellHarness.commits())).toEqual([{ state: 'published', attempts: 2 }]);
      expect(await popup.isVisible()).toBe(true);
      await page.evaluate(() => window.__dataStudioCellHarness.resolve());
      await popup.waitFor({ state: 'detached' });
      expect(await cell.getAttribute('data-save-state')).toBe('saved');
      expect(await page.evaluate(() => window.__dataStudioCellHarness.current())).toEqual({ present: true, value: { state: 'published', attempts: 2 } });
    } finally { await page.close(); }
  }, TEST_TIMEOUT);

  browserTest('JSON dirty Escape retains the draft, explicit discard is a no-op, and remote revisions retire stale editors', async () => {
    const page = await openHarness();
    try {
      await page.evaluate(() => window.__dataStudioCellHarness.configure('metadata-json'));
      await page.getByRole('button', { name: /Edit Metadata/ }).click();
      await page.getByRole('button', { name: 'Edit as text', exact: true }).click();
      const text = page.getByRole('textbox', { name: 'Edit Metadata JSON text', exact: true });
      await text.fill('{"state":"unsaved"}');
      await page.keyboard.press('Escape');
      expect(await text.inputValue()).toBe('{"state":"unsaved"}');
      expect(await page.evaluate(() => window.__dataStudioCellHarness.commits())).toEqual([]);
      await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
      expect(await page.evaluate(() => window.__dataStudioCellHarness.current())).toEqual({ present: true, value: { state: 'draft' } });
      await page.getByRole('button', { name: /Edit Metadata/ }).click();
      await page.getByRole('button', { name: 'Edit as text', exact: true }).click();
      await text.fill('{"state":"stale"}');
      await page.evaluate(() => window.__dataStudioCellHarness.remote({ state: 'authoritative' }));
      await page.waitForFunction(() => document.querySelector('[data-slot="data-studio-inline-cell"]')?.getAttribute('data-save-state') === 'conflict');
      await page.locator('[data-slot="data-studio-cell-editor"]').waitFor({ state: 'detached' });
      expect(await page.evaluate(() => window.__dataStudioCellHarness.commits())).toEqual([]);
      expect(await page.locator('[data-slot="data-studio-inline-cell"]').textContent()).toContain('authoritative');
    } finally { await page.close(); }
  }, TEST_TIMEOUT);

  browserTest('JSON applies untouched absence as a no-op and validates required null without losing text', async () => {
    const page = await openHarness();
    try {
      for (const [name, expected] of [
        ['optional-json-undefined', { present: false }],
        ['optional-json-null', { present: true, value: null }],
        ['optional-json-empty', { present: true, value: '' }],
        ['optional-json-string', { present: true, value: 'unchanged' }],
        ['metadata-json', { present: true, value: { state: 'draft' } }],
      ] as const) {
        await page.evaluate(name => window.__dataStudioCellHarness.configure(name), name);
        await page.getByRole('button', { name: /Edit (Optional JSON|Metadata)/ }).click();
        await page.getByRole('button', { name: 'Apply', exact: true }).click();
        await page.locator('[data-slot="data-studio-cell-editor"]').waitFor({ state: 'detached' });
        expect(await page.evaluate(() => window.__dataStudioCellHarness.current())).toEqual(expected);
        expect(await page.evaluate(() => window.__dataStudioCellHarness.commits())).toEqual([]);
        if (name === 'metadata-json') {
          // Opening the package's pretty text view must not manufacture a
          // mutation just because it serializes the same object differently.
          await page.getByRole('button', { name: /Edit Metadata/ }).click();
          await page.getByRole('button', { name: 'Edit as text', exact: true }).click();
          await page.getByRole('textbox', { name: 'Edit Metadata JSON text', exact: true }).waitFor();
          await page.getByRole('button', { name: 'Apply', exact: true }).click();
          await page.locator('[data-slot="data-studio-cell-editor"]').waitFor({ state: 'detached' });
          expect(await page.evaluate(() => window.__dataStudioCellHarness.commits())).toEqual([]);
          expect(await page.evaluate(() => window.__dataStudioCellHarness.current())).toEqual(expected);
        }
      }
      await page.evaluate(() => window.__dataStudioCellHarness.configure('required-json'));
      await page.getByRole('button', { name: /Edit Metadata/ }).click();
      await page.getByRole('button', { name: 'Edit as text', exact: true }).click();
      const text = page.getByRole('textbox', { name: 'Edit Metadata JSON text', exact: true });
      await text.fill('null'); await page.getByRole('button', { name: 'Apply', exact: true }).click();
      expect(await text.inputValue()).toBe('null');
      expect(await page.getByRole('alert').count()).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.__dataStudioCellHarness.commits())).toEqual([]);
    } finally { await page.close(); }
  }, TEST_TIMEOUT);

  browserTest('a pending JSON acknowledgment cannot close or populate an editor in a replacement source', async () => {
    const page = await openHarness();
    try {
      await page.evaluate(() => window.__dataStudioCellHarness.configure('metadata-json'));
      await page.getByRole('button', { name: /Edit Metadata/ }).click();
      await page.getByRole('button', { name: 'Edit as text', exact: true }).click();
      const text = page.getByRole('textbox', { name: 'Edit Metadata JSON text', exact: true });
      await text.fill('{"state":"old-scope"}');
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[data-slot="data-studio-inline-cell"]')?.getAttribute('data-save-state') === 'pending');
      await page.evaluate(() => window.__dataStudioCellHarness.retire());
      await page.locator('[data-slot="data-studio-cell-editor"]').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: /Edit Metadata/ }).click();
      await page.getByRole('button', { name: 'Edit as text', exact: true }).click();
      await text.fill('{"state":"successor-draft"}');
      await page.evaluate(() => window.__dataStudioCellHarness.resolve());
      expect(await text.inputValue()).toBe('{"state":"successor-draft"}');
      expect(await page.getByRole('button', { name: 'Apply', exact: true }).isVisible()).toBe(true);
      expect(await page.evaluate(() => window.__dataStudioCellHarness.current())).toEqual({ present: true, value: { state: 'successor' } });
      expect(await page.locator('[data-slot="data-studio-inline-cell"]').getAttribute('data-save-state')).toBe('idle');
    } finally { await page.close(); }
  }, TEST_TIMEOUT);

  browserTest('anchored JSON drafts fit mobile and desktop viewports in both themes without widening the cell', async () => {
    const evidence = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/calendar-field-editors';
    await mkdir(evidence, { recursive: true });
    for (const [width, dark] of [[1000, false], [1000, true], [390, false], [390, true]] as const) {
      const page = await openHarness();
      try {
        await page.setViewportSize({ width, height: 720 });
        if (dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
        await page.evaluate(() => window.__dataStudioCellHarness.configure('metadata-json'));
        await page.getByRole('button', { name: /Edit Metadata/ }).click();
        const popup = page.locator('[data-slot="data-studio-cell-editor"]');
        await popup.waitFor();
        await page.getByRole('button', { name: 'Edit as text', exact: true }).click();
        const text = page.getByRole('textbox', { name: 'Edit Metadata JSON text', exact: true });
        await text.fill('{\n  "example": "A local JSON draft",\n  "enabled": true\n}');
        expect(await popup.locator('[data-slot="json-editor"]').getAttribute('data-density')).toBe('compact');
        expect(await text.getAttribute('rows')).toBe('6');
        expect((await text.boundingBox())!.height).toBeLessThan(170);
        await page.waitForFunction(() => {
          const popup = document.querySelector('[data-slot="data-studio-cell-editor"]')!;
          return Number(getComputedStyle(popup).opacity) > .99;
        });
        const box = await popup.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        expect(box!.height + box!.y).toBeLessThanOrEqual(720);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        expect(await popup.getByRole('button', { name: 'Apply', exact: true }).isVisible()).toBe(true);
        await page.screenshot({ path: join(evidence, `json-cell-${width}-${dark ? 'dark' : 'light'}.png`) });
      } finally { await page.close(); }
    }
  }, TEST_TIMEOUT);

  browserTest('retains seconds and milliseconds during an intentional datetime edit', async () => {
    const page = await openHarness();
    try {
      await page.evaluate(() => window.__dataStudioCellHarness.configure('precise-datetime'));
      await page.getByRole('button', { name: /Edit Precise datetime/ }).click();
      const seconds = page.getByRole('textbox', { name: 'Edit Precise datetime seconds', exact: true });
      expect(await seconds.inputValue()).toBe('37.123');
      await page.getByRole('combobox', { name: 'Edit Precise datetime time', exact: true }).click();
      await page.getByRole('option', { name: '5:46 PM', exact: true }).click();
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
      await page.getByRole('combobox', { name: 'Edit Precise datetime time', exact: true }).click();
      await page.getByRole('option', { name: '5:46 PM', exact: true }).press('Enter');
      expect(await page.evaluate(() => window.__dataStudioCellHarness.commits())).toEqual([]);
      expect(await page.evaluate(() => window.__dataStudioCellHarness.outerClicks())).toBe(0);
      await page.getByRole('button', { name: 'Open date picker', exact: true }).click();
      await page.keyboard.press('Escape');
      expect(await page.getByRole('button', { name: 'Apply', exact: true }).isVisible()).toBe(true);
      await page.getByRole('combobox', { name: 'Edit Precise datetime time', exact: true }).click();
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
let sourceRevision = 0;
let mode = 'pending';
let pending = null;
let commitValues = [];
let reloadCount = 0;
let reloadPending = null;
let reloadHeld = false;
let navigationCount = 0;
let frameCallbacks = new Map();
let frameId = 0;
let framesHeld = false;
const requestFrame = window.requestAnimationFrame.bind(window);
const cancelFrame = window.cancelAnimationFrame.bind(window);
let outerClicks = 0;
const root = createRoot(document.getElementById('root'));

function commit(next) {
  const owner = sourceRevision;
  commitValues.push(next);
  if (mode === 'error') return Promise.reject(new Error('Save rejected'));
  if (mode === 'conflict') return Promise.reject(new DataStudioMutationError(
    'Revision conflict', 'operation', { code: 'DATA_STUDIO_REVISION_CONFLICT' },
  ));
  return new Promise((resolve) => {
    pending = () => {
      if (owner === sourceRevision) { value = next; revision += 1; render(); }
      resolve();
    };
  });
}

function render() {
  root.render(React.createElement('div', {
    style: { width: '240px', fontFamily: 'system-ui', fontSize: '14px' },
    onClick(){ outerClicks += 1; },
  }, React.createElement(DataStudioInlineCell, {
    key: sourceRevision,
    value,
    column,
    revision,
    onCommit: commit,
    onReload: async () => {
      reloadCount += 1;
      if (reloadHeld) await new Promise((resolve) => { reloadPending = resolve; });
    },
    onNavigate: () => {
      navigationCount += 1;
      document.querySelector('[aria-label="Next cell"]')?.focus();
    },
  }), React.createElement('button', { type: 'button', 'aria-label': 'Next cell' }, 'Next')));
}

window.__dataStudioCellHarness = {
  resolve() { pending?.(); pending = null; },
  holdReload() { reloadHeld = true; },
  resolveReload() { reloadHeld = false; reloadPending?.(); reloadPending = null; },
  navigations() { return navigationCount; },
  holdFrames() {
    if (framesHeld) throw new Error('Frame callbacks are already held');
    framesHeld = true;
    window.requestAnimationFrame = (callback) => {
      const id = --frameId;
      frameCallbacks.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      if (frameCallbacks.has(id)) frameCallbacks.delete(id);
      else cancelFrame(id);
    };
  },
  heldFrames() { return frameCallbacks.size; },
  releaseFrames() {
    window.requestAnimationFrame = requestFrame;
    window.cancelAnimationFrame = cancelFrame;
    framesHeld = false;
    const callbacks = [...frameCallbacks.values()];
    frameCallbacks.clear();
    for (const callback of callbacks) callback(performance.now());
  },
  setMode(next) { mode = next; },
  remote(next) { value = next; revision += 1; render(); },
  retire() { sourceRevision += 1; value = { state: 'successor' }; revision = 1; render(); },
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
    } else if (name === 'optional-json-undefined' || name === 'optional-json-null' || name === 'optional-json-empty' || name === 'optional-json-string') {
      value = name === 'optional-json-null' ? null : name === 'optional-json-empty' ? '' : name === 'optional-json-string' ? 'unchanged' : undefined;
      column = { columnId: 'value', key: 'value', label: 'Optional JSON', type: 'json', required: false };
    } else if (name === 'metadata-json' || name === 'required-json') {
      value = { state: 'draft' };
      column = { columnId: 'value', key: 'value', label: 'Metadata', type: 'json', required: name === 'required-json' };
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
      holdReload(): void;
      resolveReload(): void;
      navigations(): number;
      holdFrames(): void;
      heldFrames(): number;
      releaseFrames(): void;
      setMode(mode: 'pending' | 'error' | 'conflict'): void;
      remote(value: unknown): void;
      retire(): void;
      configure(name: string): void;
      current(): { present: boolean; value?: unknown };
      commits(): unknown[];
      reloads(): number;
      outerClicks(): number;
      resetOuterClicks(): void;
    };
  }
}
