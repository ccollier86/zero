/** Production record dialog and temporal controls against synthetic deferred writers, not an app or database. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page, Locator } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const TIMEOUT = 45_000, SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const ARTIFACTS = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/data-studio-record-dialog';
let lease: PlaywrightTestBrowserLease | undefined, directory: string | undefined, evidence: string | undefined;
let script = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) throw new Error('Record dialog acceptance requires the existing Chromium fixture browser.');
  lease = await acquirePlaywrightTestBrowser();
  await mkdir(SCRATCH, { recursive: true }); await mkdir(ARTIFACTS, { recursive: true });
  directory = await mkdtemp(join(SCRATCH, 'record-dialog-')); evidence = await mkdtemp(join(ARTIFACTS, 'acceptance-'));
  const builder = join(directory, 'build.ts');
  await Bun.write(builder, `const result=await Bun.build({
    entrypoints:[${JSON.stringify(join(import.meta.dir, 'data-studio-row-dialog.browser-fixture.tsx'))}],
    target:'browser',format:'iife',outdir:${JSON.stringify(directory)},naming:'bundle.js'});
    if(!result.success){console.error(result.logs.map(log=>log.message).join('\\n'));process.exit(1);}`);
  const build = Bun.spawn({ cmd: [process.execPath, '--no-env-file', builder], cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, status] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
  if (status !== 0) throw new Error(`${stdout}\n${stderr}`);
  script = await Bun.file(join(directory, 'bundle.js')).text();
  css = await Bun.file((await buildPlatformStyles(directory, join(directory, 'missing-app'))).cssPath).text();
}, TIMEOUT);
afterAll(async () => { try { if (directory) await rm(directory, { recursive: true, force: true }); } finally { lease?.release(); } }, TIMEOUT);

async function open(width = 1280, dark = false, height = 900): Promise<Page> {
  if (!lease) throw new Error('Record fixture is not initialized.');
  const page = await lease.browser.newPage({ viewport: { width, height }, timezoneId: 'UTC' });
  page.setDefaultTimeout(4_000);
  await page.setContent(`<!doctype html><html${dark ? ' class="dark"' : ''}><head></head><body><div id="root"></div></body></html>`);
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await page.getByRole('heading', { name: 'Add record to Contacts', exact: true }).waitFor();
  return page;
}
function dialog(page: Page): Locator { return page.locator('[data-slot="data-studio-row-dialog"]'); }
function create(page: Page): Locator { return page.getByRole('button', { name: 'Create record', exact: true }); }
function field(page: Page, label: string): Locator { return dialog(page).getByRole('textbox', {
  name: label === 'Full name' ? /^Full name(?: required)?$/ : label, exact: true,
}); }
async function choose(page: Page, label: string, option: string): Promise<void> {
  await dialog(page).getByRole('combobox', { name: label === 'Consent' ? /^Consent(?: required)?$/ : label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function required(page: Page): Promise<void> { await field(page, 'Full name').fill('Ada example'); await choose(page, 'Consent', 'False'); }
async function request(page: Page): Promise<number> {
  await page.waitForFunction(() => window.__rowDialog.writes().some((write) => !write.settled));
  return page.evaluate(() => window.__rowDialog.writes().find((write) => !write.settled)!.id);
}
async function waitForSettledDialog(page: Page): Promise<void> {
  await dialog(page).evaluate(element => new Promise<void>((resolve, reject) => {
    let previous: DOMRect | undefined, stableFrames = 0, frames = 0;
    const sample = () => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
      const settled = Number(style.opacity) >= 0.99999
        && (style.filter === 'none' || style.filter === 'blur(0px)')
        && [matrix.m11, matrix.m22, matrix.m33].every(value => Math.abs(value - 1) < 0.000001)
        && [matrix.m12, matrix.m13, matrix.m21, matrix.m23, matrix.m31, matrix.m32].every(value => Math.abs(value) < 0.000001);
      const geometryStable = previous && ['x', 'y', 'width', 'height'].every(key => (
        Math.abs(rect[key as keyof Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>]
          - previous![key as keyof Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>]) < 0.001
      ));
      stableFrames = settled && geometryStable ? stableFrames + 1 : 0;
      previous = rect;
      if (stableFrames >= 4) resolve();
      else if (++frames > 180) reject(new Error('Record dialog animation/geometry did not settle.'));
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
}

describe('Data Studio record authoring', () => {
  test('captures the actual typed form at its opening position in light/dark desktop and mobile', async () => {
    for (const [width, dark] of [[1280, false], [1280, true], [390, false], [390, true]] as const) {
      const page = await open(width, dark, 900); try {
        await waitForSettledDialog(page);
        const body = dialog(page).locator('[data-slot="data-studio-row-dialog-body"]');
        await body.evaluate(element => { element.scrollTop = 0; });
        expect(await field(page, 'Full name').isVisible()).toBe(true);
        await page.screenshot({ path: join(evidence!, `record-editor-${width}-${dark ? 'dark' : 'light'}.png`) });
      } finally { await page.close(); }
    }
  }, TIMEOUT);

  test('uses a substantial tokenized two-column form and real DatePicker/TimePicker instead of native date inputs', async () => {
    const page = await open(); try {
      const box = await dialog(page).boundingBox(); expect(box?.width).toBeGreaterThan(700); expect(box?.width).toBeLessThan(1000);
      expect(await dialog(page).locator('input[type="date"], input[type="datetime-local"], input[type="time"]').count()).toBe(0);
      expect(await dialog(page).locator('[data-slot="date-picker"]').count()).toBe(2);
      expect(await dialog(page).locator('[data-slot="time-picker"]').count()).toBe(1);
      expect(await field(page, 'Meeting at seconds').inputValue()).toBe('37.123');
      expect(await page.getByRole('combobox', { name: 'Meeting at time minute', exact: true }).textContent()).toBe('45');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('requires explicit required values and omits untouched optional/defaulted fields', async () => {
    const page = await open(); try {
      await create(page).click(); expect(await page.evaluate(() => window.__rowDialog.writes().length)).toBe(0);
      await required(page); await create(page).click(); const id = await request(page);
      expect(await page.evaluate(() => window.__rowDialog.writes()[0]!.values)).toEqual({ name: 'Ada example', consent: false });
      await page.evaluate((id) => window.__rowDialog.resolve(id), id);
      await dialog(page).waitFor({ state: 'detached' }); expect(await page.getByTestId('row-closes').textContent()).toBe('1');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('keeps explicit zero, false, empty text and null distinct from omitted defaults', async () => {
    const page = await open(); try {
      await required(page); await field(page, 'Score').fill('0');
      await choose(page, 'Active', 'Empty (null)');
      await field(page, 'Metadata').fill('null'); await field(page, 'Notes').fill('temp'); await field(page, 'Notes').fill('');
      await create(page).click(); await request(page);
      expect(await page.evaluate(() => window.__rowDialog.writes()[0]!.values)).toEqual({
        name: 'Ada example', consent: false, score: 0, active: null, payload: null, notes: '',
      });
    } finally { await page.close(); }
  }, TIMEOUT);

  test('retains invalid numeric and JSON text without submitting a malformed record', async () => {
    const page = await open(); try {
      await required(page); await field(page, 'Score').fill('not a number'); await create(page).click();
      expect(await page.evaluate(() => window.__rowDialog.writes().length)).toBe(0);
      expect(await field(page, 'Score').inputValue()).toBe('not a number');
      await field(page, 'Score').fill('42.5'); await field(page, 'Metadata').fill('{ invalid json'); await create(page).click();
      expect(await page.evaluate(() => window.__rowDialog.writes().length)).toBe(0);
      expect(await field(page, 'Metadata').inputValue()).toBe('{ invalid json');
      await field(page, 'Metadata').fill('{"status":"accepted"}'); await create(page).click(); await request(page);
      expect(await page.evaluate(() => window.__rowDialog.writes()[0]!.values.score)).toBe(42.5);
      expect(await page.evaluate(() => window.__rowDialog.writes()[0]!.values.payload)).toEqual({ status: 'accepted' });
    } finally { await page.close(); }
  }, TIMEOUT);

  test('invalid date text blocks creation and remains visible rather than saving the previous date', async () => {
    const page = await open(); try {
      await required(page); await field(page, 'Due date').fill('02/30/2026'); await create(page).click();
      expect(await page.evaluate(() => window.__rowDialog.writes().length)).toBe(0);
      expect(await field(page, 'Due date').inputValue()).toBe('02/30/2026');
      await field(page, 'Due date').fill('02/04/2026'); await create(page).click(); await request(page);
      expect(await page.evaluate(() => window.__rowDialog.writes()[0]!.values.due_on)).toBe('2026-02-04');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('calendar selection and a time edit preserve datetime seconds and milliseconds', async () => {
    const page = await open(); try {
      await required(page);
      await dialog(page).locator('[data-slot="data-studio-row-field"][data-column-id="due_on"]')
        .getByRole('button', { name: 'Open date picker', exact: true }).click();
      await page.getByRole('button', { name: /February 5th, 2026/ }).click();
      await choose(page, 'Meeting at time minute', '46');
      expect(await field(page, 'Meeting at seconds').inputValue()).toBe('37.123');
      await create(page).click(); await request(page);
      expect(await page.evaluate(() => window.__rowDialog.writes()[0]!.values)).toMatchObject({
        due_on: '2026-02-05', meeting_at: '2026-02-03T17:46:37.123Z',
      });
    } finally { await page.close(); }
  }, TIMEOUT);

  test('same-tick submissions admit one write and pending work blocks editing, Escape and close', async () => {
    const page = await open(); try {
      await required(page); await create(page).evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
      const id = await request(page); expect(await page.evaluate(() => window.__rowDialog.writes().length)).toBe(1);
      expect(await field(page, 'Full name').isDisabled()).toBe(true);
      await page.keyboard.press('Escape'); expect(await dialog(page).isVisible()).toBe(true);
      expect(await page.getByTestId('row-closes').textContent()).toBe('0');
      await page.evaluate((id) => window.__rowDialog.resolve(id), id); await dialog(page).waitFor({ state: 'detached' });
    } finally { await page.close(); }
  }, TIMEOUT);

  test('rejected writes keep typed drafts available for one deliberate retry', async () => {
    const page = await open(); try {
      await required(page); await create(page).click(); const id = await request(page);
      await page.evaluate((id) => window.__rowDialog.reject(id), id);
      await page.getByRole('alert').waitFor(); expect(await field(page, 'Full name').inputValue()).toBe('Ada example');
      const events = await page.evaluate(() => window.__rowDialog.events());
      expect(events).toHaveLength(1);
      expect(events[0]?.metadata).toMatchObject({ operation: 'row.create', category: 'mutation', retryable: false });
      expect(JSON.stringify(events)).not.toContain('Ada example');
      expect(JSON.stringify(events)).not.toContain('Synthetic create rejection');
      await create(page).click(); await request(page); expect(await page.evaluate(() => window.__rowDialog.writes().length)).toBe(2);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('an unconfirmed outcome locks the exact values and offers a deliberate same-request retry', async () => {
    const page = await open(); try {
      await required(page); await create(page).click(); const id = await request(page);
      const first = await page.evaluate(() => window.__rowDialog.writes()[0]!.values);
      await page.evaluate((id) => window.__rowDialog.rejectAmbiguous(id), id);
      await page.getByRole('button', { name: 'Retry request', exact: true }).waitFor();
      expect(await field(page, 'Full name').isDisabled()).toBe(true);
      await page.getByRole('button', { name: 'Retry request', exact: true }).click(); await request(page);
      expect(await page.evaluate(() => window.__rowDialog.writes()[1]!.values)).toEqual(first);
      expect(await page.evaluate(() => window.__rowDialog.writes().length)).toBe(2);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('accepted persistence is not made resubmittable when the close notification throws', async () => {
    const page = await open(); try {
      await page.evaluate(() => window.__rowDialog.failClose());
      await required(page); await create(page).click(); const id = await request(page);
      await page.evaluate((id) => window.__rowDialog.resolve(id), id);
      await page.getByRole('button', { name: 'Created', exact: true }).waitFor();
      expect(await page.getByRole('button', { name: 'Created', exact: true }).isDisabled()).toBe(true);
      expect(await field(page, 'Full name').isDisabled()).toBe(true);
      expect(await page.evaluate(() => window.__rowDialog.writes().length)).toBe(1);
      const events = await page.evaluate(() => window.__rowDialog.events());
      expect(events).toHaveLength(1); expect(events[0]?.metadata).toEqual({ surface: 'row-dialog', stage: 'close' });
      expect(JSON.stringify(events)).not.toContain('Synthetic private close notification');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('table replacement retires a late completion without closing or populating the successor', async () => {
    const page = await open(); try {
      await required(page); await create(page).click(); const id = await request(page);
      await page.evaluate(() => window.__rowDialog.switchTable());
      await page.getByRole('heading', { name: 'Add record to Projects', exact: true }).waitFor();
      expect(await field(page, 'Full name').inputValue()).toBe('');
      await page.evaluate((id) => window.__rowDialog.resolve(id), id);
      await page.waitForTimeout(20); expect(await dialog(page).isVisible()).toBe(true);
      expect(await page.getByTestId('row-closes').textContent()).toBe('0');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('source A→B→A and unmount suppress stale completion/error presentation', async () => {
    const page = await open(); try {
      await required(page); await create(page).click(); const id = await request(page);
      await page.evaluate(() => window.__rowDialog.source('organization-b'));
      await field(page, 'Full name').waitFor(); expect(await field(page, 'Full name').inputValue()).toBe('');
      await page.evaluate(() => window.__rowDialog.source('organization-a')); await page.waitForTimeout(20);
      await page.evaluate((id) => window.__rowDialog.reject(id), id); await page.waitForTimeout(20);
      expect(await dialog(page).getByRole('alert').count()).toBe(0); expect(await page.getByTestId('row-closes').textContent()).toBe('0');
      await required(page); await create(page).click(); const pending = await request(page);
      await page.evaluate(() => window.__rowDialog.unmount()); await dialog(page).waitFor({ state: 'detached' });
      await page.evaluate((id) => window.__rowDialog.resolve(id), pending); await page.waitForTimeout(20);
      expect(await page.getByTestId('row-closes').textContent()).toBe('0');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('a changed schema does not silently reinterpret a draft or advance its opening schema', async () => {
    const page = await open(); try {
      await field(page, 'Full name').fill('Keep this draft'); await page.evaluate(() => window.__rowDialog.schemaReplacement());
      expect(await field(page, 'Full name').inputValue()).toBe('Keep this draft');
      expect(await create(page).isDisabled()).toBe(true);
      expect(await page.getByRole('button', { name: 'Reload fields', exact: true }).isVisible()).toBe(true);
      expect(await page.evaluate(() => window.__rowDialog.writes().length)).toBe(0);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('a schema replacement retires a pending completion without closing the changed form', async () => {
    const page = await open(); try {
      await required(page); await create(page).click(); const id = await request(page);
      await page.evaluate(() => window.__rowDialog.schemaReplacement());
      await page.getByRole('button', { name: 'Reload fields', exact: true }).waitFor();
      await page.evaluate((id) => window.__rowDialog.resolve(id), id); await page.waitForTimeout(20);
      expect(await dialog(page).isVisible()).toBe(true); expect(await page.getByTestId('row-closes').textContent()).toBe('0');
      expect(await field(page, 'Full name').inputValue()).toBe('Ada example');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('dirty close lets the author keep editing or discard deliberately', async () => {
    const page = await open(); try {
      await field(page, 'Full name').fill('Draft to keep');
      await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
      expect(await field(page, 'Full name').inputValue()).toBe('Draft to keep');
      await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
      await dialog(page).waitFor({ state: 'detached' }); expect(await page.getByTestId('row-closes').textContent()).toBe('1');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('header and footer stay reachable while only a long field body scrolls in both themes/mobile', async () => {
    for (const [width, dark] of [[1280, false], [1280, true], [390, false], [390, true], [320, false]] as const) {
      const page = await open(width, dark, 800); try {
        await page.evaluate(() => window.__rowDialog.manyFields());
        // The new schema is deliberately reloaded before taking long-form layout evidence.
        if (await page.getByRole('button', { name: 'Reload fields', exact: true }).count()) await page.getByRole('button', { name: 'Reload fields', exact: true }).click();
        const body = page.locator('[data-slot="data-studio-row-dialog-body"]');
        await body.waitFor();
        await waitForSettledDialog(page);
        const header = dialog(page).locator('[data-slot="dialog-header"]'), footer = dialog(page).locator('[data-slot="data-studio-row-dialog-footer"]');
        const beforeHeader = await header.boundingBox(), beforeFooter = await footer.boundingBox();
        expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
        await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
        const afterHeader = await header.boundingBox(), afterFooter = await footer.boundingBox();
        expect(afterHeader?.y).toBeCloseTo(beforeHeader!.y, 1); expect(afterFooter?.y).toBeCloseTo(beforeFooter!.y, 1);
        expect(afterFooter!.y + afterFooter!.height).toBeLessThan(800);
        expect(await dialog(page).evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        expect(await create(page).isVisible()).toBe(true);
        if (evidence) await page.screenshot({ path: join(evidence, `record-form-${width}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
      } finally { await page.close(); }
    }
  }, TIMEOUT);
});
