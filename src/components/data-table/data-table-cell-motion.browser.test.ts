/** Real DataTable browser coverage for retained text cells, edit isolation, excluded renderers, and cell-motion policy. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { DATA_TABLE_MOTION } from './data-table-motion-tokens';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const visual = '[data-slot="typing-text-visual"]';
const canonical = '[data-slot="typing-text-value"]';
const helper = '[data-slot="data-table-animated-text"]';
let lease: PlaywrightTestBrowserLease | undefined, bundle = '';
const errors = new WeakMap<Page, string[]>();

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  // Compile in a short-lived process so the browser suite does not share compiler state with other checks.
  const script = `const result = await Bun.build({entrypoints:[${JSON.stringify(`${import.meta.dir}/data-table-cell-motion.browser-fixture.tsx`)}],target:'browser',format:'iife'});if(!result.success){for(const log of result.logs)await Bun.write(Bun.stderr,log.message+'\\n');process.exit(1);}await Bun.write(Bun.stdout,await result.outputs[0].text());`;
  const build = Bun.spawn([process.execPath, '--no-env-file', '-e', script],
    { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe', timeout: 40_000, killSignal: 'SIGKILL' });
  const [code, output, diagnostics] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
  if (code !== 0) throw new Error(`Cell-motion fixture build failed (${code}): ${diagnostics || output}`);
  bundle = output;
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

async function open() {
  const page = await lease!.browser.newPage({ viewport: { width: 1200, height: 720 }, reducedMotion: 'no-preference' });
  page.setDefaultTimeout(5_000);
  const messages: string[] = []; errors.set(page, messages); page.on('pageerror', error => messages.push(error.message));
  await page.setContent('<!doctype html><html><head><style>body{margin:20px;font:16px sans-serif}table{width:1100px;border-collapse:collapse}th,td{padding:8px;border:1px solid #ddd}input{min-width:180px}</style></head><body><div id="root"></div></body></html>');
  await page.clock.install({ time: new Date('2026-10-07T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-07T12:00:01Z'));
  await page.addScriptTag({ content: bundle });
  await page.locator('[data-row-id="existing"]').waitFor();
  await page.clock.runFor(DATA_TABLE_MOTION.base + DATA_TABLE_MOTION.enterDelay);
  return page;
}
async function close(page: Page) { try { expect(errors.get(page)).toEqual([]); } finally { await page.close(); } }
function cell(page: Page, index: number) { return page.locator('[data-row-id="existing"] > td').nth(index); }

browserTest('a retained null text cell types its first nonblank value while canonical text updates immediately', async () => {
  const page = await open();
  try {
    expect(await cell(page, 0).locator(helper).count()).toBe(1);
    expect(await page.locator(visual).count()).toBe(0);
    await page.evaluate(() => window.__dataTableCellMotion.capture());
    const accepted = await page.evaluate(() => window.__dataTableCellMotion.update({ name: 'Now populated' }));
    expect(accepted).toEqual({ canonical: 'Now populated', visual: '', typing: true });
    expect(await page.evaluate(() => window.__dataTableCellMotion.same())).toMatchObject({ row: true, helper: true });
    expect(await cell(page, 0).locator(visual).getAttribute('aria-hidden')).toBe('true');
    expect(await cell(page, 0).locator(canonical).getAttribute('aria-hidden')).toBeNull();
    await page.clock.runFor(48);
    const partial = await cell(page, 0).locator(visual).textContent();
    expect(partial!.length).toBeGreaterThan(0); expect(partial!.length).toBeLessThan('Now populated'.length);
    expect('Now populated'.startsWith(partial!)).toBe(true);
    await page.clock.runFor(DATA_TABLE_MOTION.base);
    expect(await cell(page, 0).locator(visual).count()).toBe(0);
    expect(await cell(page, 0).textContent()).toBe('Now populated');
    expect(await page.evaluate(() => window.__dataTableCellMotion.same())).toMatchObject({ row: true, helper: true });
  } finally { await close(page); }
}, 30_000);

browserTest('existing text backspaces before replacement and settles within the shared 525ms budget', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__dataTableCellMotion.update({ name: 'Original text' }));
    await page.clock.runFor(DATA_TABLE_MOTION.base);
    await page.evaluate(() => window.__dataTableCellMotion.capture());
    const accepted = await page.evaluate(() => window.__dataTableCellMotion.update({ name: 'Replacement label' }));
    expect(accepted).toEqual({ canonical: 'Replacement label', visual: 'Original text', typing: true });
    await page.clock.runFor(96);
    const erasing = await cell(page, 0).locator(visual).textContent();
    expect(erasing!.length).toBeGreaterThan(0); expect(erasing!.length).toBeLessThan('Original text'.length);
    expect('Original text'.startsWith(erasing!)).toBe(true);
    await page.clock.runFor(160);
    const replacing = await cell(page, 0).locator(visual).textContent();
    expect(replacing!.length).toBeGreaterThan(0); expect(replacing!.length).toBeLessThan('Replacement label'.length);
    expect('Replacement label'.startsWith(replacing!)).toBe(true);
    await page.clock.runFor(DATA_TABLE_MOTION.base - 256);
    expect(await cell(page, 0).locator(visual).count()).toBe(0);
    expect(await cell(page, 0).textContent()).toBe('Replacement label');
    expect(await page.evaluate(() => window.__dataTableCellMotion.same())).toMatchObject({ row: true, helper: true });
  } finally { await close(page); }
}, 30_000);

browserTest('rapid updates retarget the retained cell from its displayed glyphs and settle only the latest value', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__dataTableCellMotion.update({ name: 'Retained original' }));
    await page.clock.runFor(DATA_TABLE_MOTION.base);
    await page.evaluate(() => window.__dataTableCellMotion.capture());
    await page.evaluate(() => window.__dataTableCellMotion.update({ name: 'Intermediate target' }));
    await page.clock.runFor(96);
    const current = await cell(page, 0).locator(visual).textContent();
    expect(current!.length).toBeGreaterThan(0); expect(current!.length).toBeLessThan('Retained original'.length);
    expect('Retained original'.startsWith(current!)).toBe(true);
    const accepted = await page.evaluate(() => window.__dataTableCellMotion.update({ name: 'Newest accepted target' }));
    expect(accepted).toEqual({ canonical: 'Newest accepted target', visual: current, typing: true });
    expect(await page.evaluate(() => window.__dataTableCellMotion.same())).toMatchObject({ row: true, helper: true });
    await page.clock.runFor(DATA_TABLE_MOTION.base);
    expect(await cell(page, 0).locator(visual).count()).toBe(0);
    expect(await cell(page, 0).textContent()).toBe('Newest accepted target');
    await page.clock.runFor(DATA_TABLE_MOTION.highlight);
    expect(await cell(page, 0).textContent()).toBe('Newest accepted target');
    expect(await page.locator(visual).count()).toBe(0);
    expect(await page.evaluate(() => window.__dataTableCellMotion.same())).toMatchObject({ row: true, helper: true });
  } finally { await close(page); }
}, 30_000);

browserTest('dynamic reduced motion settles the real table immediately and never replays accepted updates', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__dataTableCellMotion.update({ name: 'Original populated text' }));
    await page.clock.runFor(DATA_TABLE_MOTION.base);
    await page.evaluate(() => window.__dataTableCellMotion.capture());
    await page.evaluate(() => window.__dataTableCellMotion.update({ name: 'Accepted before reducing motion' }));
    await page.clock.runFor(96);
    expect(await cell(page, 0).locator(visual).count()).toBe(1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('[data-slot="data-table-grid"]')?.getAttribute('data-motion') === 'false');
    expect(await cell(page, 0).locator(visual).count()).toBe(0);
    expect(await cell(page, 0).textContent()).toBe('Accepted before reducing motion');
    const reduced = await page.evaluate(() => window.__dataTableCellMotion.update({ name: 'Accepted while reduced' }));
    expect(reduced).toEqual({ canonical: 'Accepted while reduced', visual: null, typing: false });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.querySelector('[data-slot="data-table-grid"]')?.getAttribute('data-motion') === 'true');
    expect(await cell(page, 0).locator(visual).count()).toBe(0);
    await page.clock.runFor(DATA_TABLE_MOTION.base + DATA_TABLE_MOTION.highlight);
    expect(await cell(page, 0).textContent()).toBe('Accepted while reduced');
    expect(await page.locator(visual).count()).toBe(0);
    expect(await page.evaluate(() => window.__dataTableCellMotion.same())).toMatchObject({ row: true, helper: true });
  } finally { await close(page); }
}, 30_000);

browserTest('the actual inline editor retains its unsubmitted draft through external text replacements', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__dataTableCellMotion.update({ editable: 'Accepted before editing' }));
    expect(await cell(page, 1).locator(visual).count()).toBe(1);
    await cell(page, 1).locator('[data-slot="editable-cell-display"]').evaluate(element => (element as HTMLElement).click());
    const input = cell(page, 1).locator('[data-slot="editable-cell-editor"] input');
    await input.fill('Unsubmitted user draft');
    await page.evaluate(() => window.__dataTableCellMotion.capture());
    await page.evaluate(() => window.__dataTableCellMotion.update({ name: 'Other updated text', editable: 'Latest external value' }));
    await page.clock.runFor(96);
    expect(await input.inputValue()).toBe('Unsubmitted user draft');
    expect(await page.evaluate(() => window.__dataTableCellMotion.same())).toMatchObject({ row: true, editor: true });
    expect(await cell(page, 1).locator(helper).count()).toBe(0);
    expect(await cell(page, 1).locator(visual).count()).toBe(0);
    expect(await cell(page, 0).locator(visual).count()).toBe(1);
    expect(await page.evaluate(() => window.__dataTableCellMotion.commits())).toBe(0);
    await input.press('Escape');
    expect(await cell(page, 1).locator('[data-slot="editable-cell-display"]').textContent()).toBe('Latest external value');
    expect(await cell(page, 1).locator(visual).count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('custom, masked, password and nontext renderers stay outside the typing helper without exposing protected copy', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__dataTableCellMotion.update({ custom: 'PRIVATE_CUSTOM_UPDATED', masked: 'PRIVATE_MASKED_UPDATED',
      password: 'PRIVATE_PASSWORD_UPDATED', hiddenPassword: 'PRIVATE_HIDDEN_UPDATED', count: 42, date: '2026-10-07', choice: 'two' }));
    for (const index of [2, 3, 4, 5, 6, 7]) {
      expect(await cell(page, index).locator(helper).count()).toBe(0);
      expect(await cell(page, index).locator(visual).count()).toBe(0);
    }
    expect(await page.getByTestId('custom-renderer').textContent()).toBe('Custom presentation');
    expect(await page.getByTestId('masked-renderer').textContent()).toBe('••••••••');
    expect(await page.getByTestId('password-renderer').textContent()).toBe('••••••••');
    expect(await cell(page, 5).textContent()).toBe('42');
    expect(await cell(page, 7).textContent()).toBe('two');
    expect(await page.locator('body').innerHTML()).not.toContain('PRIVATE_');
    await page.clock.runFor(DATA_TABLE_MOTION.base);
    expect(await page.locator('body').innerHTML()).not.toContain('PRIVATE_');
  } finally { await close(page); }
}, 30_000);

for (const mode of [false, 'highlight'] as const) browserTest(`cellMotion=${String(mode)} updates canonical text without replacement glyphs`, async () => {
  const page = await open();
  try {
    await page.evaluate(mode => window.__dataTableCellMotion.mode(mode), mode);
    const accepted = await page.evaluate(() => window.__dataTableCellMotion.update({ name: 'Updated without typing' }));
    expect(accepted).toEqual({ canonical: 'Updated without typing', visual: null, typing: false });
    expect(await cell(page, 0).textContent()).toBe('Updated without typing');
    expect(await page.locator(visual).count()).toBe(0);
    expect(await cell(page, 0).locator('[data-slot="data-table-cell-flash"]').count()).toBe(mode === 'highlight' ? 1 : 0);
    await page.clock.runFor(DATA_TABLE_MOTION.base);
    expect(await page.locator(visual).count()).toBe(0);
  } finally { await close(page); }
}, 30_000);
