/** Actual composed dialog/JSON controls with synthetic callbacks and compiled Zero styles only. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser, lease: PlaywrightTestBrowserLease, directory: string, script: string, css: string;
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
  directory = await mkdtemp(join(tmpdir(), 'zero-studio-dialog-'));
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'data-studio-table-dialog.browser-fixture.tsx')],
    outdir: directory, naming: 'bundle.js', target: 'browser', format: 'iife' });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
  script = await Bun.file(join(directory, 'bundle.js')).text();
  css = await Bun.file((await buildPlatformStyles(directory, join(directory, 'missing-app'))).cssPath).text();
}, 60_000);
afterAll(async () => { try { if (directory) await rm(directory, { recursive: true, force: true }); } finally { lease?.release(); } });
async function open(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.setContent('<!doctype html><html><head></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await page.getByRole('textbox', { name: 'Table name', exact: true }).waitFor(); return page;
}
async function json(page: Page) {
  await page.getByRole('tab', { name: 'JSON', exact: true }).click();
  await page.getByRole('button', { name: 'Edit as text', exact: true }).waitFor();
}

browserTest('opens a wide bounded builder and preserves fields and IDs across Visual/JSON round trips', async () => {
  const page = await open();
  try {
    const box = await page.locator('[data-slot="data-studio-table-dialog"]').boundingBox();
    expect(box!.width).toBeGreaterThan(1000); expect(box!.height).toBeLessThan(870);
    await page.getByRole('textbox', { name: 'Column name', exact: true }).fill('Display name');
    await page.getByRole('button', { name: 'Configure Score', exact: true }).click();
    await page.getByRole('button', { name: 'Configure Display name', exact: true }).click();
    expect(await page.getByRole('textbox', { name: 'Column name', exact: true }).inputValue()).toBe('Display name');
    expect(await page.getByRole('textbox', { name: 'Column field key', exact: true }).inputValue()).toBe('name');
    await json(page); await page.getByRole('button', { name: 'Edit as text', exact: true }).click();
    const text = page.getByRole('textbox', { name: 'Schema JSON text', exact: true }); await text.waitFor();
    expect(JSON.parse(await text.inputValue()).columns[0].columnId).toBe('column_name');
    await page.getByRole('tab', { name: 'Visual', exact: true }).click();
    await page.getByRole('textbox', { name: 'Column name', exact: true }).waitFor();
    expect(await page.getByRole('textbox', { name: 'Column name', exact: true }).inputValue()).toBe('Display name');
  } finally { await page.close(); }
}, 60_000);

browserTest('invalid JSON blocks mode switching/saving without discarding text and dirty-close offers stay/discard/save', async () => {
  const page = await open();
  try {
    await json(page); await page.getByRole('button', { name: 'Edit as text', exact: true }).click();
    const text = page.getByRole('textbox', { name: 'Schema JSON text', exact: true });
    await text.fill('{ "version": 1,');
    await page.getByRole('tab', { name: 'Visual', exact: true }).click();
    expect(await text.inputValue()).toBe('{ "version": 1,');
    expect(await page.getByRole('tab', { name: 'JSON', exact: true }).getAttribute('aria-selected')).toBe('true');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect(await page.evaluate(() => window.__studioDialog.operations())).toHaveLength(0);
    await page.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
    expect(await text.inputValue()).toBe('{ "version": 1,');
    await page.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-slot="data-studio-table-dialog"]'));
    expect(await page.evaluate(() => window.__studioDialog.closes())).toBe(1);
  } finally { await page.close(); }
}, 60_000);

browserTest('captures opening revision, admits one same-tick write and keeps failed draft available', async () => {
  const page = await open();
  try {
    await page.getByRole('textbox', { name: 'Table name', exact: true }).fill('Updated contacts');
    await page.evaluate(() => { window.__studioDialog.hold(); window.__studioDialog.revision(); });
    await page.getByRole('button', { name: 'Save changes', exact: true }).evaluate(element => { const button = element as HTMLButtonElement; button.click(); button.click(); });
    const operations = await page.evaluate(() => window.__studioDialog.operations());
    expect(operations).toHaveLength(1); expect(operations[0]!.revision).toBe(3);
    await page.evaluate(() => window.__studioDialog.reject());
    await page.getByText('Synthetic save rejection', { exact: true }).waitFor();
    expect(await page.getByRole('textbox', { name: 'Table name', exact: true }).inputValue()).toBe('Updated contacts');
    expect(await page.evaluate(() => window.__studioDialog.closes())).toBe(0);
  } finally { await page.close(); }
}, 60_000);

browserTest('late completion after table replacement cannot close the new editor', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__studioDialog.hold());
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.evaluate(() => window.__studioDialog.switchTable());
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('[data-slot="data-studio-table-name"]')?.value === 'Other');
    await page.evaluate(() => window.__studioDialog.resolve());
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    expect(await page.evaluate(() => window.__studioDialog.closes())).toBe(0);
    expect(await page.getByRole('textbox', { name: 'Table name', exact: true }).inputValue()).toBe('Other');
  } finally { await page.close(); }
}, 60_000);

browserTest('requires schema-impact confirmation and appends/selects a fresh column for add-column entry', async () => {
  const page = await open();
  try {
    await page.getByRole('textbox', { name: 'Column field key', exact: true }).fill('display_name');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect(await page.evaluate(() => window.__studioDialog.operations())).toHaveLength(0);
    await page.getByRole('button', { name: 'Confirm and save', exact: true }).click();
    await page.waitForFunction(() => window.__studioDialog.operations().length === 1);
    expect((await page.evaluate(() => window.__studioDialog.operations()))[0]!.schema.columns[0]!.columnId).toBe('column_name');
    await page.evaluate(() => window.__studioDialog.addColumn());
    await page.getByRole('textbox', { name: 'Column name', exact: true }).waitFor();
    expect(await page.getByRole('textbox', { name: 'Column name', exact: true }).inputValue()).toBe('Field 3');
  } finally { await page.close(); }
}, 60_000);

browserTest('accepted close-callback failure is observed safely and cannot resubmit accepted write', async () => {
  const page = await open(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.evaluate(() => window.__studioDialog.failClose());
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByRole('button', { name: 'Saved', exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Saved', exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => window.__studioDialog.operations())).toHaveLength(1);
    expect(errors).toEqual([]);
    const observations = JSON.stringify(await page.evaluate(() => window.__studioDialog.observed()));
    expect(observations).toContain('accepted-close'); expect(observations).not.toContain('Synthetic close callback rejection');
  } finally { await page.close(); }
}, 60_000);

browserTest('reusable JSON editor preserves a raw draft, returns local admission and isolates observer errors', async () => {
  const page = await open(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.evaluate(() => { window.__studioDialog.json(); window.__studioDialog.throwEditing(); });
    await page.getByRole('button', { name: 'Edit as text', exact: true }).click();
    const text = page.getByRole('textbox', { name: 'Test JSON text', exact: true });
    await text.fill('{ not json');
    expect(await page.evaluate(() => window.__studioDialog.commit())).toEqual({ ok: false, error: 'Invalid JSON. Check commas, quotes and matching braces.' });
    expect(await text.inputValue()).toBe('{ not json');
    await text.fill('{ "name": "Local" }');
    expect(await page.evaluate(() => window.__studioDialog.commit())).toEqual({ ok: true, value: { name: 'Local' } });
    expect(await page.evaluate(() => window.__studioDialog.value())).toEqual({ name: 'Local' });
    expect(await page.evaluate(() => window.__studioDialog.operations())).toHaveLength(0);
    expect(errors).toEqual([]);
    const observations = JSON.stringify(await page.evaluate(() => window.__studioDialog.observed()));
    expect(observations).toContain('json_editor.callback_failed'); expect(observations).not.toContain('Synthetic private callback content');
  } finally { await page.close(); }
}, 60_000);

browserTest('JSON Cancel explicitly discards text while a failed schema check retains the actual candidate document', async () => {
  const page = await open();
  try {
    await json(page); await page.getByRole('button', { name: 'Edit as text', exact: true }).click();
    const text = page.getByRole('textbox', { name: 'Schema JSON text', exact: true });
    const schema = JSON.parse(await text.inputValue());
    schema.columns[0].required = 'wrong';
    await text.fill(JSON.stringify(schema));
    await page.getByRole('tab', { name: 'Visual', exact: true }).click();
    expect((await text.inputValue()).includes('wrong')).toBe(true);
    expect(await page.getByRole('tab', { name: 'JSON', exact: true }).getAttribute('aria-selected')).toBe('true');
    await page.locator('[data-slot="json-editor"]').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('tab', { name: 'Visual', exact: true }).click();
    await page.getByRole('textbox', { name: 'Column name', exact: true }).waitFor();
    expect(await page.getByRole('textbox', { name: 'Column name', exact: true }).inputValue()).toBe('Name');
    expect(await page.evaluate(() => window.__studioDialog.operations())).toHaveLength(0);
  } finally { await page.close(); }
}, 60_000);

browserTest('confirmations reserve same-tick work, reset errors on reopening and fence replaced-operation completion', async () => {
  const page = await open();
  try {
    await page.evaluate(() => { window.__studioDialog.confirmation(); window.__studioDialog.hold(); });
    const archive = page.getByRole('button', { name: 'Archive', exact: true }); await archive.waitFor();
    await archive.evaluate(element => { const button = element as HTMLButtonElement; button.click(); button.click(); });
    expect(await page.evaluate(() => window.__studioDialog.operations())).toHaveLength(1);
    expect(await page.getByRole('button', { name: 'Cancel', exact: true }).isDisabled()).toBe(true);
    await page.evaluate(() => window.__studioDialog.reject());
    await page.getByRole('alert').waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => window.__studioDialog.reopen());
    await archive.waitFor(); expect(await page.getByRole('alert').count()).toBe(0);
    await archive.click();
    await page.evaluate(() => window.__studioDialog.replaceConfirmation());
    await archive.waitFor();
    await page.evaluate(() => window.__studioDialog.resolve());
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    expect(await page.evaluate(() => window.__studioDialog.closes())).toBe(1);
    expect(await archive.isEnabled()).toBe(true);
  } finally { await page.close(); }
}, 60_000);

browserTest('application column quota narrows both Add and JSON submission with one vertical editor scroller', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__studioDialog.limit(2));
    expect(await page.getByRole('button', { name: 'Add column', exact: true }).isDisabled()).toBe(true);
    await json(page); await page.getByRole('button', { name: 'Edit as text', exact: true }).click();
    const text = page.getByRole('textbox', { name: 'Schema JSON text', exact: true });
    const schema = JSON.parse(await text.inputValue());
    schema.columns.push({ ...schema.columns[0], columnId: 'new_column', key: 'new_field' });
    const buffer = JSON.stringify(schema, null, 2); await text.fill(buffer);
    expect(await page.getByRole('heading', { name: 'Columns 3 / 2', exact: true }).count()).toBe(1);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect(await text.inputValue()).toBe(buffer);
    expect(await page.evaluate(() => window.__studioDialog.operations())).toHaveLength(0);
    expect(await page.locator('[data-slot="json-editor"] fieldset').evaluate(element => getComputedStyle(element).overflowY)).toBe('visible');
    expect(await text.evaluate(element => getComputedStyle(element).overflowY)).toBe('hidden');
    const body = page.locator('[data-slot="data-studio-table-dialog-body"]');
    expect(await body.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');
  } finally { await page.close(); }
}, 60_000);

browserTest('a retained JSON text draft survives editor remount and disabled admission does not discard it', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__studioDialog.json());
    await page.getByRole('button', { name: 'Edit as text', exact: true }).click();
    const text = page.getByRole('textbox', { name: 'Test JSON text', exact: true });
    await text.fill('{ unfinished');
    await page.evaluate(() => window.__studioDialog.confirmation());
    await page.getByRole('button', { name: 'Archive', exact: true }).waitFor();
    expect(await page.evaluate(() => window.__studioDialog.raw())).toBe('{ unfinished');
    await page.evaluate(() => window.__studioDialog.json());
    await text.waitFor(); expect(await text.inputValue()).toBe('{ unfinished');
    await page.evaluate(() => window.__studioDialog.disable());
    expect(await text.isDisabled()).toBe(true);
    expect(await page.evaluate(() => window.__studioDialog.commit())).toEqual({ ok: false, error: 'This editor is unavailable.' });
    expect(await page.evaluate(() => window.__studioDialog.raw())).toBe('{ unfinished');
  } finally { await page.close(); }
}, 60_000);
