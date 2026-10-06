/** Real styled Cascader interactions against isolated deferred callbacks, never an application or live service. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { OBS_CODES } from '../../observability/codes';
import {
  acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';

const TIMEOUT = 45_000;
const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const ARTIFACTS = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/cascader';
let lease: PlaywrightTestBrowserLease | undefined;
let directory: string | undefined, evidence: string | undefined, script = '', css = '';

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) throw new Error('Cascader acceptance requires the existing Playwright Chromium test browser.');
  lease = await acquirePlaywrightTestBrowser();
  await mkdir(SCRATCH, { recursive: true });
  await mkdir(ARTIFACTS, { recursive: true });
  directory = await mkdtemp(join(SCRATCH, 'cascader-browser-'));
  evidence = await mkdtemp(join(ARTIFACTS, 'acceptance-'));
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, 'cascader.browser-fixture.tsx')],
    outdir: directory, naming: 'bundle.js', target: 'browser', format: 'iife',
  });
  if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n'));
  script = await Bun.file(join(directory, 'bundle.js')).text();
  css = await Bun.file((await buildPlatformStyles(directory, join(directory, 'missing-app'))).cssPath).text();
}, TIMEOUT);

afterAll(async () => {
  try { if (directory) await rm(directory, { recursive: true, force: true }); }
  finally { lease?.release(); }
}, TIMEOUT);

async function open(width = 1080, dark = false): Promise<Page> {
  if (!lease) throw new Error('Cascader browser fixture was not initialized.');
  const page = await lease.browser.newPage({ viewport: { width, height: 800 } });
  page.setDefaultTimeout(4_500);
  await page.setContent(`<!doctype html><html${dark ? ' class="dark"' : ''}><head></head><body><div id="root"></div></body></html>`);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await page.waitForFunction(() => !!window.__cascaderHarness);
  await page.getByTestId('fixture-ready').waitFor();
  return page;
}
function popup(page: Page): Locator { return page.locator('[data-slot="cascader-content"]'); }
function option(page: Page, value: string): Locator { return popup(page).locator(`[data-cascader-value="${value}"]`); }
function search(page: Page): Locator { return page.getByRole('combobox', { name: 'Search Attributes', exact: true }); }
async function show(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Attributes', exact: true }).click();
  await popup(page).waitFor();
}
async function configure(page: Page, kind: 'static' | 'async' | 'remote', max = 3): Promise<void> {
  await page.evaluate(({ kind, max }) => window.__cascaderHarness.configure({ kind, max, defaultValues: [] }), { kind, max });
  await page.waitForFunction(() => document.querySelector('[data-slot="cascader-value"]')?.textContent === 'Choose attributes');
}
async function childRequest(page: Page, value: string | null, ordinal = 0): Promise<number> {
  await page.waitForFunction(({ value, ordinal }) => window.__cascaderHarness.requests().filter((request) => request.value === value).length > ordinal,
    { value, ordinal });
  return page.evaluate(({ value, ordinal }) => window.__cascaderHarness.requests().filter((request) => request.value === value)[ordinal]!.id,
    { value, ordinal });
}

describe('Cascader public browser composition', () => {
  test('retains initial selections and renders external full-path chips and public hook metadata', async () => {
    const page = await open();
    try {
      expect(await page.locator('[data-slot="cascader-value"]').textContent()).toBe('2 selected');
      const chips = page.getByRole('group', { name: 'Selected values' });
      expect(await chips.getByText('People / Name', { exact: true }).count()).toBe(1);
      expect(await chips.getByText('Projects / Name', { exact: true }).count()).toBe(1);
      expect(await page.getByTestId('custom-paths').locator('[data-value="people.name"]').getAttribute('data-path-values'))
        .toBe('["people","people.name"]');
      expect(await page.locator('input[name="attributes"]').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)))
        .toEqual(['people.name', 'projects.name']);
      await chips.getByRole('button', { name: 'Remove People / Name', exact: true }).click();
      expect(await page.locator('[data-slot="cascader-value"]').textContent()).toBe('Projects / Name');
      expect(await page.getByTestId('selection-changes').textContent()).toBe('[["projects.name"]]');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('drills through levels and breadcrumbs without turning branches into selected leaves', async () => {
    const page = await open();
    try {
      await configure(page, 'static'); await show(page);
      await option(page, 'projects').click();
      expect(await popup(page).getByRole('button', { name: 'Projects', exact: true }).getAttribute('aria-current')).toBe('location');
      await option(page, 'projects.settings').click();
      await option(page, 'projects.settings.notifications').waitFor();
      expect(await page.getByTestId('selection-changes').textContent()).toBe('[]');
      await popup(page).getByRole('button', { name: 'Back one level', exact: true }).click();
      await option(page, 'projects.name').waitFor();
      await popup(page).getByRole('button', { name: 'All attributes', exact: true }).click();
      await option(page, 'people').waitFor();
    } finally { await page.close(); }
  }, TIMEOUT);

  test('global search works from nested levels and preserves full-path labels on repeated names', async () => {
    const page = await open();
    try {
      await configure(page, 'static'); await show(page); await option(page, 'people').click();
      await search(page).fill('name');
      await option(page, 'projects.name').waitFor();
      expect(await option(page, 'people.name').getAttribute('aria-label')).toBe('People / Name');
      expect(await option(page, 'projects.name').getAttribute('aria-label')).toBe('Projects / Name');
      await page.getByRole('checkbox', { name: 'Select Projects / Name', exact: true }).click();
      await search(page).fill('');
      await option(page, 'people.email').waitFor();
      expect(await option(page, 'projects.name').count()).toBe(0);
      expect(await page.getByTestId('custom-paths').getByText('Projects / Name', { exact: true }).count()).toBe(1);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('ArrowRight drills a highlighted branch and Backspace or ArrowLeft returns without stealing text movement', async () => {
    const page = await open();
    try {
      await configure(page, 'static'); await show(page);
      await search(page).focus(); await search(page).press('Home'); await search(page).press('ArrowRight');
      await option(page, 'people.email').waitFor();
      await search(page).press('Backspace'); await option(page, 'people').waitFor();
      await search(page).press('ArrowRight'); await option(page, 'people.email').waitFor();
      await search(page).fill('mail'); await search(page).press('Home'); await search(page).press('ArrowRight');
      expect(await search(page).inputValue()).toBe('mail');
      expect(await popup(page).getByRole('button', { name: 'People', exact: true }).getAttribute('aria-current')).toBe('location');
      await search(page).fill(''); await search(page).press('ArrowLeft'); await option(page, 'people').waitFor();
    } finally { await page.close(); }
  }, TIMEOUT);

  test('enforces checkbox caps while keeping branches navigable and selected choices removable', async () => {
    const page = await open();
    try {
      await page.evaluate(() => window.__cascaderHarness.configure({ max: 2 }));
      await show(page); await option(page, 'people').click();
      expect(await page.getByRole('checkbox', { name: 'Select People / Email', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByRole('checkbox', { name: 'Select People / Name', exact: true }).isEnabled()).toBe(true);
      await page.getByRole('checkbox', { name: 'Select People / Name', exact: true }).click();
      expect(await page.getByRole('checkbox', { name: 'Select People / Email', exact: true }).isEnabled()).toBe(true);
      await page.getByRole('checkbox', { name: 'Select People / Email', exact: true }).click();
      expect(await popup(page).locator('[data-slot="cascader-footer"]').textContent()).toContain('2 / 2 selected');
      await popup(page).getByRole('button', { name: 'All attributes', exact: true }).click();
      expect(await option(page, 'projects').getAttribute('aria-disabled')).toBe('false');
      await option(page, 'projects').click(); await option(page, 'projects.settings').click();
      expect(await page.getByRole('checkbox', { name: 'Select Projects / Settings / Notifications', exact: true }).isDisabled()).toBe(true);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('disabled and read-only modes fence changes while read-only users may inspect known branches', async () => {
    const page = await open();
    try {
      await page.evaluate(() => window.__cascaderHarness.flags({ disabled: true }));
      expect(await page.getByRole('button', { name: 'Attributes', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByRole('button', { name: 'Remove People / Name', exact: true }).isDisabled()).toBe(true);
      await page.evaluate(() => window.__cascaderHarness.flags({ disabled: false, readOnly: true }));
      await show(page); await option(page, 'people').click();
      expect(await page.getByRole('checkbox', { name: 'Select People / Name', exact: true }).isDisabled()).toBe(true);
      expect(await popup(page).getByRole('button', { name: 'Create attribute', exact: true }).isDisabled()).toBe(true);
      expect(await popup(page).getByRole('button', { name: 'Import', exact: true }).isDisabled()).toBe(true);
      await popup(page).getByRole('button', { name: 'All attributes', exact: true }).click();
      expect(await option(page, 'disabled').getAttribute('aria-disabled')).toBe('true');
      expect(await page.getByTestId('selection-changes').textContent()).toBe('[]');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('the pinned footer remains outside the filtered/scrolling list, including no results', async () => {
    const page = await open();
    try {
      await show(page); await search(page).fill('nothing matches this query');
      await popup(page).getByText('No matching attributes.', { exact: true }).waitFor();
      expect(await popup(page).getByRole('button', { name: 'Create attribute', exact: true }).isVisible()).toBe(true);
      expect(await popup(page).getByRole('button', { name: 'Import', exact: true }).isVisible()).toBe(true);
      expect(await popup(page).evaluate((root) => {
        const list = root.querySelector('[data-slot="cascader-list"]');
        const footer = root.querySelector('[data-slot="cascader-footer"]');
        return !!list && !!footer && !list.contains(footer) && list.parentNode === footer.parentNode;
      })).toBe(true);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('side import menus dismiss one layer at a time and restore useful keyboard focus', async () => {
    const page = await open();
    try {
      await show(page); await popup(page).getByRole('button', { name: 'Import', exact: true }).click();
      const menu = page.getByRole('menu', { name: 'Import', exact: true });
      await menu.waitFor();
      expect(await menu.getAttribute('data-side')).toBe('right');
      await page.keyboard.press('Escape'); await menu.waitFor({ state: 'detached' });
      expect(await popup(page).isVisible()).toBe(true);
      await page.waitForFunction(() => document.activeElement?.textContent?.includes('Import'));
      await page.keyboard.press('Escape'); await popup(page).waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.activeElement?.id === 'attribute-picker');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('footer callbacks await completion, block repeated clicks, and report failures through standard observability', async () => {
    const page = await open();
    try {
      await show(page);
      const action = popup(page).getByRole('button', { name: 'Create attribute', exact: true });
      await action.click();
      await page.waitForFunction(() => window.__cascaderHarness.actions().length === 1);
      expect(await action.isDisabled()).toBe(true);
      await action.dispatchEvent('click');
      expect(await page.evaluate(() => window.__cascaderHarness.actions().length)).toBe(1);
      await page.evaluate(() => window.__cascaderHarness.rejectAction(window.__cascaderHarness.actions()[0]!.id));
      await page.waitForFunction((code) => window.__cascaderHarness.events().some((event) => event.code === code),
        OBS_CODES.FRONTEND_CASCADER_CALLBACK_FAILED.code);
      expect(await action.isEnabled()).toBe(true);
      expect(await popup(page).getByRole('status').textContent()).toContain('could not be completed');
      expect(JSON.stringify(await page.evaluate(() => window.__cascaderHarness.events()))).not.toContain('private source detail');
      await action.click();
      await page.waitForFunction(() => window.__cascaderHarness.actions().length === 2);
      await page.evaluate(() => window.__cascaderHarness.resolveAction(window.__cascaderHarness.actions()[1]!.id));
      await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-slot="cascader-footer"] button')?.disabled);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('lazy branches load before navigation, retry the failed branch, and preserve empty-load context', async () => {
    const page = await open();
    try {
      await configure(page, 'async'); await show(page); await option(page, 'lazy').click();
      const first = await childRequest(page, 'lazy');
      expect(await popup(page).locator('[aria-current="location"]').count()).toBe(0);
      expect(await option(page, 'people').count()).toBe(1);
      await page.evaluate((id) => window.__cascaderHarness.rejectChildren(id), first);
      await popup(page).getByRole('alert').waitFor();
      expect(await popup(page).locator('[aria-current="location"]').count()).toBe(0);
      await popup(page).getByRole('button', { name: 'Retry', exact: true }).click();
      const retry = await childRequest(page, 'lazy', 1);
      await page.evaluate((id) => window.__cascaderHarness.resolveChildren(id, [
        { value: 'lazy.country', label: 'Country' },
      ]), retry);
      await option(page, 'lazy.country').waitFor();
      expect(await popup(page).getByRole('button', { name: 'Connected data', exact: true }).getAttribute('aria-current')).toBe('location');
      await popup(page).getByRole('button', { name: 'All attributes', exact: true }).click();
      await option(page, 'empty').click(); const empty = await childRequest(page, 'empty');
      await page.evaluate((id) => window.__cascaderHarness.resolveChildren(id, []), empty);
      await page.waitForFunction(() => document.querySelector('[data-slot="cascader-list"]')?.getAttribute('aria-busy') === 'false');
      expect(await popup(page).locator('[aria-current="location"]').count()).toBe(0);
      expect(await option(page, 'people').count()).toBe(1);
      expect(await page.evaluate(() => window.__cascaderHarness.errors().map((error) => error.operation))).toEqual(['children']);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('later navigation wins over ignored aborts and closed popups cannot be reactivated by a late load', async () => {
    const page = await open();
    try {
      await configure(page, 'async'); await show(page); await option(page, 'lazy').click();
      const first = await childRequest(page, 'lazy');
      await option(page, 'people').click();
      await page.evaluate((id) => window.__cascaderHarness.resolveChildren(id, [
        { value: 'lazy.late', label: 'Late data' },
      ]), first);
      await option(page, 'people.email').waitFor();
      expect(await option(page, 'lazy.late').count()).toBe(0);
      await popup(page).getByRole('button', { name: 'All attributes', exact: true }).click();
      await option(page, 'empty').click(); const pending = await childRequest(page, 'empty');
      await page.keyboard.press('Escape'); await popup(page).waitFor({ state: 'detached' });
      expect((await page.evaluate(() => window.__cascaderHarness.requests())).find((item) => item.id === pending)?.aborted).toBe(true);
      await page.evaluate((id) => window.__cascaderHarness.resolveChildren(id, [
        { value: 'empty.afterclose', label: 'After close' },
      ]), pending);
      expect(await popup(page).count()).toBe(0);
      await show(page); await option(page, 'people').waitFor();
      expect(await option(page, 'empty.afterclose').count()).toBe(0);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('organization changes retire selections, paths, cached levels and ignored late results', async () => {
    const page = await open();
    try {
      await page.evaluate(() => window.__cascaderHarness.configure({ kind: 'async' }));
      await show(page); await option(page, 'lazy').click(); const pending = await childRequest(page, 'lazy');
      await page.evaluate(() => window.__cascaderHarness.scope('second-organization'));
      await page.waitForFunction(() => document.querySelector('[data-slot="cascader-value"]')?.textContent === 'Choose attributes');
      expect((await page.evaluate(() => window.__cascaderHarness.requests())).find((item) => item.id === pending)?.aborted).toBe(true);
      await page.evaluate((id) => window.__cascaderHarness.resolveChildren(id, [
        { value: 'lazy.oldorg', label: 'Old organization field' },
      ]), pending);
      await option(page, 'people').waitFor();
      await search(page).fill('old organization');
      await popup(page).getByText('No matching attributes.', { exact: true }).waitFor();
      expect(await page.getByTestId('custom-paths').locator('li').count()).toBe(0);
      expect(await option(page, 'lazy.oldorg').count()).toBe(0);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('debounced remote searches reject out-of-order results and retain unloaded selected full paths', async () => {
    const page = await open();
    try {
      await configure(page, 'remote'); await show(page); await search(page).fill('older');
      await page.waitForFunction(() => window.__cascaderHarness.searches().some((request) => request.value === 'older'));
      await search(page).fill('current');
      await page.waitForFunction(() => window.__cascaderHarness.searches().some((request) => request.value === 'current'));
      const requests = await page.evaluate(() => window.__cascaderHarness.searches());
      const old = requests.find((request) => request.value === 'older')!;
      const current = requests.find((request) => request.value === 'current')!;
      expect(old.aborted).toBe(true);
      await page.evaluate((id) => {
        const root = { value: 'warehouse', label: 'Warehouse', hasChildren: true };
        const node = { value: 'warehouse.name', label: 'Name' };
        window.__cascaderHarness.resolveSearch(id, [{ node, path: [root, node] }]);
      }, current.id);
      await option(page, 'warehouse.name').waitFor();
      await page.evaluate((id) => {
        const root = { value: 'old', label: 'Old organization' };
        const node = { value: 'old.name', label: 'Name' };
        window.__cascaderHarness.resolveSearch(id, [{ node, path: [root, node] }]);
      }, old.id);
      expect(await option(page, 'old.name').count()).toBe(0);
      await page.getByRole('checkbox', { name: 'Select Warehouse / Name', exact: true }).click();
      await search(page).fill(''); await option(page, 'people').waitFor();
      expect(await page.getByRole('group', { name: 'Selected values' }).getByText('Warehouse / Name', { exact: true }).count()).toBe(1);
      expect(await page.getByTestId('custom-paths').locator('[data-value="warehouse.name"]').getAttribute('data-path-values'))
        .toBe('["warehouse","warehouse.name"]');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('a remote branch hydrates its complete canonical ancestor path before navigating', async () => {
    const page = await open();
    try {
      await configure(page, 'remote'); await show(page); await search(page).fill('settings');
      await page.waitForFunction(() => window.__cascaderHarness.searches().some((request) => request.value === 'settings'));
      await page.evaluate(() => {
        const root = { value: 'warehouse', label: 'Warehouse', hasChildren: true };
        const node = { value: 'warehouse.settings', label: 'Settings', hasChildren: true };
        const request = window.__cascaderHarness.searches().find((item) => item.value === 'settings')!;
        window.__cascaderHarness.resolveSearch(request.id, [{ node, path: [root, node] }]);
      });
      await option(page, 'warehouse.settings').click();
      const roots = await childRequest(page, null);
      expect(await popup(page).locator('[aria-current="location"]').count()).toBe(0);
      await page.evaluate((id) => window.__cascaderHarness.resolveChildren(id, [
        { value: 'warehouse', label: 'Warehouse', hasChildren: true },
      ]), roots);
      const warehouse = await childRequest(page, 'warehouse');
      expect(await popup(page).locator('[aria-current="location"]').count()).toBe(0);
      await page.evaluate((id) => window.__cascaderHarness.resolveChildren(id, [
        { value: 'warehouse.settings', label: 'Settings', hasChildren: true },
      ]), warehouse);
      const settings = await childRequest(page, 'warehouse.settings');
      await page.evaluate((id) => window.__cascaderHarness.resolveChildren(id, [
        { value: 'warehouse.settings.enabled', label: 'Enabled' },
      ]), settings);
      await option(page, 'warehouse.settings.enabled').waitFor();
      expect(await popup(page).getByRole('button', { name: 'Warehouse', exact: true }).count()).toBe(1);
      expect(await popup(page).getByRole('button', { name: 'Settings', exact: true }).getAttribute('aria-current')).toBe('location');
      expect(await search(page).inputValue()).toBe('');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('restored unknown IDs acquire admitted remote full paths without firing selection changes and retain them after clear or close', async () => {
    const page = await open();
    try {
      await page.evaluate(() => window.__cascaderHarness.configure({
        kind: 'remote', defaultValues: ['lazy.remote.restored'],
      }));
      await page.getByRole('group', { name: 'Selected values' }).getByText('lazy.remote.restored', { exact: true }).waitFor();
      await show(page); await search(page).fill('restored');
      await page.waitForFunction(() => window.__cascaderHarness.searches().some((request) => request.value === 'restored'));
      await page.evaluate(() => {
        const root = { value: 'lazy', label: 'Connected data', hasChildren: true };
        const node = { value: 'lazy.remote.restored', label: 'Restored column' };
        const request = window.__cascaderHarness.searches().find((item) => item.value === 'restored')!;
        window.__cascaderHarness.resolveSearch(request.id, [{ node, path: [root, node] }]);
      });
      const chips = page.getByRole('group', { name: 'Selected values' });
      await chips.getByText('Connected data / Restored column', { exact: true }).waitFor();
      expect(await page.getByTestId('custom-paths').locator('[data-value="lazy.remote.restored"]').getAttribute('data-path-values'))
        .toBe('["lazy","lazy.remote.restored"]');
      await search(page).fill(''); await option(page, 'people').waitFor();
      expect(await chips.getByText('Connected data / Restored column', { exact: true }).count()).toBe(1);
      await page.keyboard.press('Escape'); await popup(page).waitFor({ state: 'detached' });
      expect(await chips.getByText('Connected data / Restored column', { exact: true }).count()).toBe(1);
      expect(await page.getByTestId('selection-changes').textContent()).toBe('[]');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('an empty loaded search branch becomes selectable from the same query instead of remaining a stale branch', async () => {
    const page = await open();
    try {
      await configure(page, 'remote'); await show(page); await search(page).fill('connected');
      await page.waitForFunction(() => window.__cascaderHarness.searches().some((request) => request.value === 'connected'));
      await page.evaluate(() => {
        const node = { value: 'lazy', label: 'Connected data', hasChildren: true };
        const request = window.__cascaderHarness.searches().find((item) => item.value === 'connected')!;
        window.__cascaderHarness.resolveSearch(request.id, [{ node, path: [node] }]);
      });
      await option(page, 'lazy').click(); const pending = await childRequest(page, 'lazy');
      await page.evaluate((id) => window.__cascaderHarness.resolveChildren(id, []), pending);
      const checkbox = page.getByRole('checkbox', { name: 'Select Connected data', exact: true });
      await checkbox.waitFor();
      expect(await search(page).inputValue()).toBe('connected');
      expect(await checkbox.isEnabled()).toBe(true);
      await checkbox.click();
      expect(await option(page, 'lazy').getAttribute('data-checked')).toBe('true');
      expect(await page.getByTestId('selection-changes').textContent()).toBe('[["lazy"]]');
      expect(await page.getByRole('group', { name: 'Selected values' }).getByText('Connected data', { exact: true }).count()).toBe(1);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('a remote searched branch failure exposes Retry for that branch without replacing it with another search', async () => {
    const page = await open();
    try {
      await configure(page, 'remote'); await show(page); await search(page).fill('connected');
      await page.waitForFunction(() => window.__cascaderHarness.searches().some((request) => request.value === 'connected'));
      await page.evaluate(() => {
        const node = { value: 'lazy', label: 'Connected data', hasChildren: true };
        const request = window.__cascaderHarness.searches().find((item) => item.value === 'connected')!;
        window.__cascaderHarness.resolveSearch(request.id, [{ node, path: [node] }]);
      });
      await option(page, 'lazy').click(); const first = await childRequest(page, 'lazy');
      await page.evaluate((id) => window.__cascaderHarness.rejectChildren(id), first);
      await popup(page).getByRole('alert').waitFor();
      expect(await search(page).inputValue()).toBe('connected');
      await popup(page).getByRole('button', { name: 'Retry', exact: true }).click();
      const retry = await childRequest(page, 'lazy', 1);
      expect(await page.evaluate(() => window.__cascaderHarness.searches().length)).toBe(1);
      await page.evaluate((id) => window.__cascaderHarness.resolveChildren(id, [
        { value: 'lazy.country', label: 'Country' },
      ]), retry);
      await option(page, 'lazy.country').waitFor();
      expect(await search(page).inputValue()).toBe('');
      expect(await popup(page).getByRole('alert').count()).toBe(0);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('an open import menu responds to a live read-only change before allowing its action', async () => {
    const page = await open();
    try {
      await show(page); await popup(page).getByRole('button', { name: 'Import', exact: true }).click();
      const item = page.getByRole('menuitem', { name: 'Import CSV', exact: true });
      await item.waitFor();
      await page.evaluate(() => window.__cascaderHarness.flags({ readOnly: true }));
      expect(await item.isDisabled()).toBe(true);
      await item.dispatchEvent('click');
      expect(await page.evaluate(() => window.__cascaderHarness.actions().length)).toBe(0);
      await page.evaluate(() => window.__cascaderHarness.flags({ readOnly: false }));
      expect(await item.isEnabled()).toBe(true);
      await item.click();
      await page.waitForFunction(() => window.__cascaderHarness.actions().length === 1);
      await page.evaluate(() => window.__cascaderHarness.resolveAction(window.__cascaderHarness.actions()[0]!.id));
      await page.getByRole('menu', { name: 'Import', exact: true }).waitFor({ state: 'detached' });
    } finally { await page.close(); }
  }, TIMEOUT);

  test('a returned-to-same-scope import operation cannot close a newer menu or clear its pending state', async () => {
    const page = await open();
    try {
      await show(page); await popup(page).getByRole('button', { name: 'Import', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Import CSV', exact: true }).click();
      await page.waitForFunction(() => window.__cascaderHarness.actions().length === 1);
      const first = await page.evaluate(() => window.__cascaderHarness.actions()[0]!.id);
      await page.evaluate(() => window.__cascaderHarness.scope('second-organization'));
      await page.getByRole('menu', { name: 'Import', exact: true }).waitFor({ state: 'detached' });
      await page.evaluate(() => window.__cascaderHarness.scope('first-organization'));
      await popup(page).getByRole('button', { name: 'Import', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Import CSV', exact: true }).click();
      await page.waitForFunction(() => window.__cascaderHarness.actions().length === 2);
      await page.evaluate((id) => window.__cascaderHarness.resolveAction(id), first);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      expect(await page.getByRole('menu', { name: 'Import', exact: true }).isVisible()).toBe(true);
      expect(await page.getByRole('menuitem', { name: 'Import CSV', exact: true }).isDisabled()).toBe(true);
      await page.evaluate(() => window.__cascaderHarness.resolveAction(window.__cascaderHarness.actions()[1]!.id));
      await page.getByRole('menu', { name: 'Import', exact: true }).waitFor({ state: 'detached' });
      expect(await popup(page).isVisible()).toBe(true);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('query ABA changes do not admit an old same-text search response over a newer request', async () => {
    const page = await open();
    try {
      await configure(page, 'remote'); await show(page); await search(page).fill('same');
      await page.waitForFunction(() => window.__cascaderHarness.searches().length === 1);
      await search(page).fill('different');
      await page.waitForFunction(() => window.__cascaderHarness.searches().length === 2);
      await search(page).fill('same');
      await page.waitForFunction(() => window.__cascaderHarness.searches().length === 3);
      await page.evaluate(() => {
        const node = { value: 'fresh', label: 'Fresh current result' };
        window.__cascaderHarness.resolveSearch(window.__cascaderHarness.searches()[2]!.id, [{ node, path: [node] }]);
      });
      await option(page, 'fresh').waitFor();
      await page.evaluate(() => {
        const node = { value: 'obsolete', label: 'Obsolete same-text result' };
        window.__cascaderHarness.resolveSearch(window.__cascaderHarness.searches()[0]!.id, [{ node, path: [node] }]);
      });
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      expect(await option(page, 'fresh').count()).toBe(1);
      expect(await option(page, 'obsolete').count()).toBe(0);
      expect(await page.evaluate(() => window.__cascaderHarness.searches()[0]!.aborted)).toBe(true);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('styled light/dark/mobile compositions fit the viewport and preserve full-path chips and import controls', async () => {
    for (const { width, dark, name } of [
      { width: 1080, dark: false, name: 'combined-picker-light' },
      { width: 1080, dark: true, name: 'combined-picker-dark' },
      { width: 390, dark: true, name: 'combined-picker-mobile' },
    ]) {
      const page = await open(width, dark);
      try {
        await page.screenshot({ path: join(evidence!, `${name}-chips.png`) });
        await show(page); await popup(page).getByRole('button', { name: 'Import', exact: true }).click();
        await page.getByRole('menu', { name: 'Import', exact: true }).waitFor();
        await page.waitForFunction(() => {
          const menu = document.querySelector('[role="menu"][aria-label="Import"]');
          const content = document.querySelector('[data-slot="cascader-content"]');
          return !!menu && !!content && Number(getComputedStyle(menu).opacity) >= .999
            && Number(getComputedStyle(content).opacity) >= .999;
        });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        const bounds = await popup(page).boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
        const footer = await popup(page).locator('[data-slot="cascader-footer"]').boundingBox();
        expect(footer!.y + footer!.height).toBeLessThanOrEqual(800);
        const menu = await page.getByRole('menu', { name: 'Import', exact: true }).boundingBox();
        expect(menu!.x).toBeGreaterThanOrEqual(0);
        expect(menu!.x + menu!.width).toBeLessThanOrEqual(width + 1);
        await page.screenshot({ path: join(evidence!, `${name}.png`) });
      } finally { await page.close(); }
    }
  }, TIMEOUT);
});
