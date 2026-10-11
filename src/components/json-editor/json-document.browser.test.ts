/** Real DOM, keyboard, shared controls, scrolling and writer feedback under the compiled managed theme. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const artifacts = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/json-document-editor';
let lease: PlaywrightTestBrowserLease | undefined, script = '', css = '';
const errors: string[] = [];
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/json-document-');
  try {
    const bundle = await Bun.build({ entrypoints: [`${import.meta.dir}/json-document.browser-fixture.tsx`], target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
    if (!bundle.success) throw new Error(bundle.logs.map(log => log.message).join('\n'));
    script = await bundle.outputs.find(output => output.path.endsWith('.js'))!.text();
    css = await Bun.file((await buildPlatformStyles(directory, `${directory}/absent-app`)).cssPath).text();
    for (const output of bundle.outputs.filter(output => output.path.endsWith('.css'))) css += '\n' + await output.text();
    await mkdir(artifacts, { recursive: true });
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => { lease?.release(); expect(errors).toEqual([]); });
async function frames(page: Page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function mount(width = 1000, reduced = true) {
  const page = await lease!.browser.newPage({ viewport: { width, height: 780 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  page.on('pageerror', error => errors.push(error.stack ?? error.message)); page.setDefaultTimeout(6000);
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await page.getByTestId('json-ready').waitFor(); await frames(page); return page;
}
const editor = (page: Page) => page.locator('[data-slot="json-document-editor"]');
const row = (page: Page, path: string) => editor(page).locator(`[role="treeitem"][data-path="${path}"]`);
async function file(page: Page, format: 'yaml' | 'toml' | 'env', sourceText: string, writer = false) {
  await page.evaluate(options => window.__jsonDocument.configure(options), { format, sourceText, writer, documentKey: `${format}-file` }); await frames(page);
}
async function editNumber(page: Page, number: string) {
  await row(page, '/count').focus(); await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Edit settings.count', exact: true }).fill(number);
  await page.keyboard.press('Enter'); await frames(page);
}

browserTest('in-place values retain invalid drafts, unchanged rows and ancestor markers; undo restores the local document', async () => {
  const page = await mount();
  try {
    await editNumber(page, 'bad');
    expect(await page.getByRole('textbox', { name: 'Edit settings.count', exact: true }).inputValue()).toBe('bad');
    expect(await page.evaluate(() => window.__jsonDocument.value())).toMatchObject({ count: 1 });
    await page.getByRole('textbox', { name: 'Edit settings.count', exact: true }).fill('2'); await page.keyboard.press('Enter'); await frames(page);
    expect(await page.evaluate(() => window.__jsonDocument.value())).toMatchObject({ count: 2 });
    expect(await row(page, '/count').locator('[data-changed]').count()).toBe(1);
    expect(await row(page, '').locator('[data-inside]').count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Save', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await frames(page);
    expect(await page.evaluate(() => window.__jsonDocument.value())).toMatchObject({ count: 1 });
  } finally { await page.close(); }
}, 20_000);

browserTest('managed dialogs let Escape cancel only an inline draft, clear search or release Code tab trapping', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => window.__jsonDocument.openManaged());
    const dialog = page.getByRole('dialog', { name: 'Document editing', exact: true }); await dialog.waitFor();
    const count = dialog.locator('[role="treeitem"][data-path="/count"]'); await count.focus(); await page.keyboard.press('Enter');
    const input = dialog.getByRole('textbox', { name: 'Edit settings.count', exact: true }); await input.fill('99');
    expect(await input.evaluate(element => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true });
      element.dispatchEvent(event); return event.defaultPrevented;
    })).toBe(false);
    expect(await dialog.isVisible()).toBe(true); expect(await input.inputValue()).toBe('99');
    await input.press('Escape'); await frames(page);
    expect(await input.count()).toBe(0); expect(await count.textContent()).toContain('1'); expect(await dialog.isVisible()).toBe(true);
    const search = dialog.getByRole('searchbox', { name: 'Search keys and values', exact: true }); await search.fill('count'); await search.press('Escape'); await frames(page);
    expect(await search.inputValue()).toBe(''); expect(await dialog.isVisible()).toBe(true);
    await dialog.getByRole('tab', { name: 'Code', exact: true }).click();
    const source = dialog.getByRole('textbox', { name: 'Managed document source', exact: true }); await source.fill('{"count":2}'); await source.press('Escape'); await frames(page);
    expect(await dialog.isVisible()).toBe(true); expect(await source.inputValue()).toBe('{"count":2}');
    await source.press('Tab'); expect(await source.evaluate(element => element !== element.ownerDocument.activeElement)).toBe(true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.body.style.overflow === '');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  } finally { await page.close(); }
}, 25_000);

browserTest('YAML tree comments, inline values and format switching preserve exact source and magnetic selection', async () => {
  const page = await mount(1100, false);
  try {
    const source = '# deployment\nname: Zero # shown in UI\nretries: 3\nnotes: |\n  Keep this text.\n';
    await file(page, 'yaml', source);
    expect(await row(page, '/name').getByLabel('Comment for settings.name').textContent()).toContain('shown in UI');
    await row(page, '/retries').focus(); await page.keyboard.press('Enter'); await page.getByRole('textbox', { name: 'Edit settings.retries', exact: true }).fill('4'); await page.keyboard.press('Enter'); await frames(page);
    expect(await page.evaluate(() => window.__jsonDocument.handle()!.text)).toContain('retries: 4');
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await frames(page); expect(await page.evaluate(() => window.__jsonDocument.handle()!.text)).toBe(source);
    await page.getByRole('tab', { name: 'Code', exact: true }).click(); await frames(page);
    await page.evaluate(() => window.__jsonDocument.handle()!.setFormat('json')); await frames(page);
    expect(await editor(page).getAttribute('data-format')).toBe('json');
    await page.evaluate(() => window.__jsonDocument.handle()!.setFormat('yaml')); await frames(page);
    expect(await page.getByRole('textbox', { name: 'Settings JSON source', exact: true }).inputValue()).toBe(source);
    expect(await editor(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await editor(page).screenshot({ path: `${artifacts}/yaml-code.png` });
  } finally { await page.close(); }
}, 20_000);

browserTest('comment-only YAML edits have a real Save action with exact source metadata and no invented JSON operations', async () => {
  const page = await mount();
  try {
    await file(page, 'yaml', '# before\nname: Zero\n', true);
    await page.getByRole('tab', { name: 'Code', exact: true }).click();
    await page.getByRole('textbox', { name: 'Settings JSON source', exact: true }).fill('# reviewed\nname: Zero\n');
    await page.getByRole('button', { name: 'Save', exact: true }).click(); await frames(page);
    expect(await page.evaluate(() => ({ text: window.__jsonDocument.writes()[0]!.text, format: window.__jsonDocument.writes()[0]!.format, patches: window.__jsonDocument.writes()[0]!.patches }))).toEqual({ text: '# reviewed\nname: Zero\n', format: 'yaml', patches: 0 });
    await page.evaluate(() => window.__jsonDocument.accept(0)); await frames(page);
    expect(await page.getByRole('button', { name: 'Saved', exact: true }).count()).toBe(1);
  } finally { await page.close(); }
}, 20_000);

browserTest('TOML native values remain protected and ordinary inline edits preserve tables and comments', async () => {
  const page = await mount();
  try {
    await file(page, 'toml', 'date = 2026-10-11\nlarge = 9223372036854775807\n[server]\nport = 8080 # public port\n');
    await row(page, '/date').focus(); await page.keyboard.press('Enter'); expect(await page.getByRole('alert').textContent()).toContain('source-native');
    await row(page, '/server').focus(); await page.keyboard.press('ArrowRight');
    await row(page, '/server/port').focus(); await page.keyboard.press('Enter');
    await page.getByRole('textbox', { name: 'Edit settings.server.port', exact: true }).fill('9090'); await page.keyboard.press('Enter'); await frames(page);
    expect(await page.evaluate(() => window.__jsonDocument.handle()!.text)).toBe('date = 2026-10-11\nlarge = 9223372036854775807\n[server]\nport = 9090 # public port\n');
    await page.getByRole('tab', { name: 'Code', exact: true }).click(); expect(await page.getByText(/Valid TOML/u).count()).toBe(1);
    await editor(page).screenshot({ path: `${artifacts}/toml-code.png` });
  } finally { await page.close(); }
}, 20_000);

browserTest('.env edits stay literal strings and narrow format switching uses the shared Select', async () => {
  const page = await mount(390);
  try {
    await file(page, 'env', '# env\nPORT=8080\nTOKEN="\\${LITERAL}"\n');
    await row(page, '/PORT').focus(); await page.keyboard.press('Enter');
    await page.getByRole('textbox', { name: 'Edit settings.PORT', exact: true }).fill('9090'); await page.keyboard.press('Enter'); await frames(page);
    expect(await page.evaluate(() => window.__jsonDocument.handle()!.text)).toContain('PORT=9090');
    expect(await page.evaluate(() => window.__jsonDocument.handle()!.text)).toContain('TOKEN="\\${LITERAL}"');
    await page.getByRole('tab', { name: 'Code', exact: true }).click(); await frames(page);
    await page.getByRole('combobox', { name: 'Source format', exact: true }).click(); await page.getByRole('option', { name: 'YAML', exact: true }).click(); await frames(page);
    expect(await editor(page).getAttribute('data-format')).toBe('yaml');
    expect(await editor(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await editor(page).screenshot({ path: `${artifacts}/env-narrow-code.png` });
  } finally { await page.close(); }
}, 20_000);

browserTest('YAML typing helps indentation, keeps malformed source repairable and jumps to diagnostics', async () => {
  const page = await mount(900);
  try {
    await file(page, 'yaml', 'name: Zero\n'); await page.getByRole('tab', { name: 'Code', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Settings JSON source', exact: true }); await source.fill('routes:'); await source.press('End'); await source.press('Enter'); await frames(page);
    expect(await source.inputValue()).toBe('routes:\n  ');
    await source.fill('name: [open'); await frames(page);
    expect(await source.getAttribute('aria-invalid')).toBe('true'); await page.getByRole('button', { name: 'Jump', exact: true }).click();
    expect(await source.evaluate(element => (element as HTMLTextAreaElement).selectionEnd >= (element as HTMLTextAreaElement).selectionStart)).toBe(true);
    await page.getByRole('tab', { name: 'Tree', exact: true }).click(); expect(await page.getByText('The Code draft has an error.', { exact: false }).count()).toBe(1);
  } finally { await page.close(); }
}, 20_000);

browserTest('a malformed external format replacement shows its real syntax and can be repaired and saved as that format', async () => {
  const page = await mount();
  try {
    await file(page, 'yaml', 'name: Zero\n', true);
    await page.evaluate(() => window.__jsonDocument.configure({ format: 'toml', sourceText: 'name = [open' })); await frames(page);
    expect(await editor(page).getAttribute('data-format')).toBe('toml');
    await page.getByRole('tab', { name: /^Code/u }).click();
    const source = page.getByRole('textbox', { name: 'Settings JSON source', exact: true });
    expect(await source.inputValue()).toBe('name = [open'); expect(await source.getAttribute('aria-invalid')).toBe('true');
    await source.fill('name = "Repaired"\n'); await page.getByRole('button', { name: 'Save', exact: true }).click(); await frames(page);
    expect(await page.evaluate(() => ({ format: window.__jsonDocument.writes()[0]!.format, text: window.__jsonDocument.writes()[0]!.text }))).toEqual({ format: 'toml', text: 'name = "Repaired"\n' });
    await page.evaluate(() => window.__jsonDocument.accept(0)); await frames(page);
    expect(await page.getByRole('button', { name: 'Saved', exact: true }).count()).toBe(1);
  } finally { await page.close(); }
}, 20_000);

browserTest('paired source typing participates in native Undo instead of silently replacing its text history', async () => {
  const page = await mount();
  try {
    await page.getByRole('tab', { name: 'Code', exact: true }).click(); const source = page.getByRole('textbox', { name: 'Settings JSON source', exact: true });
    await source.fill('{}'); await source.evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(1, 1));
    await source.press('Enter'); await frames(page); expect(await source.inputValue()).toBe('{\n  \n}');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await source.press(`${modifier}+z`); await frames(page); expect(await source.inputValue()).toBe('{}');
    await source.press(`${modifier}+Shift+z`); await frames(page); expect(await source.inputValue()).toBe('{\n  \n}');
  } finally { await page.close(); }
}, 20_000);

browserTest('exact JSON source starts in Code and stays exact through Format, guarded copies and an accepted save', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => window.__jsonDocument.configure({ documentKey: 'precise-json', format: 'json', sourceText: '{"id":9007199254740993,"flag":true}', writer: true })); await frames(page);
    expect(await editor(page).getAttribute('data-mode')).toBe('code');
    await page.getByRole('button', { name: 'Format', exact: true }).click(); await frames(page);
    expect(await page.getByRole('textbox', { name: 'Settings JSON source', exact: true }).inputValue()).toContain('9007199254740993');
    await page.getByRole('tab', { name: 'Tree', exact: true }).click(); await row(page, '/id').hover();
    await page.getByRole('button', { name: 'Copy settings.id value', exact: true }).click(); await frames(page);
    expect(await editor(page).getByText('Copy this value from Code to retain exact numeric precision.').count()).toBe(1);
    await page.getByRole('button', { name: 'Save', exact: true }).click(); await frames(page);
    expect(await page.evaluate(() => window.__jsonDocument.writes()[0]!.text)).toContain('9007199254740993');
    await page.evaluate(() => window.__jsonDocument.accept(0)); await frames(page);
    expect(await page.getByRole('button', { name: 'Saved', exact: true }).count()).toBe(1);
  } finally { await page.close(); }
}, 20_000);

browserTest('live reduced motion settles the Code format pill as well as tree and tab transitions', async () => {
  const page = await mount(1100, false);
  try {
    await page.getByRole('tab', { name: 'Code', exact: true }).click(); await frames(page);
    await editor(page).locator('[data-source-format="yaml"]').click(); await frames(page);
    expect(await editor(page).evaluate(element => element.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'))).toBe(true);
    await page.emulateMedia({ reducedMotion: 'reduce' }); await frames(page);
    expect(await editor(page).evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  } finally { await page.close(); }
}, 20_000);

browserTest('exact YAML opens Code, leaves precise formatting untouched and sends the original numeric source to its writer', async () => {
  const page = await mount();
  try {
    const text = 'id: 9007199254740993\nflag: true\n'; await file(page, 'yaml', text, true);
    expect(await editor(page).getAttribute('data-mode')).toBe('code'); await page.getByRole('button', { name: 'Format', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Settings JSON source', exact: true }); expect(await source.inputValue()).toBe(text);
    expect(await page.evaluate(() => window.__jsonDocument.handle()!.setFormat('json'))).toBe(false);
    await source.fill('# changed\n' + text); await page.getByRole('button', { name: 'Save', exact: true }).click(); await frames(page);
    expect(await page.evaluate(() => window.__jsonDocument.writes()[0]!.text)).toBe('# changed\n' + text);
    await page.evaluate(() => window.__jsonDocument.accept(0)); await frames(page); expect(await page.getByRole('button', { name: 'Saved', exact: true }).count()).toBe(1);
  } finally { await page.close(); }
}, 20_000);

browserTest('rename/add/remove are guarded complete transactions; type changes use the shared morph Select', async () => {
  const page = await mount();
  try {
    await row(page, '/title').focus(); await page.keyboard.press('F2'); await page.getByRole('textbox', { name: 'Rename settings.title', exact: true }).fill('name');
    await page.keyboard.press('Enter'); await frames(page); expect(await row(page, '/name').count()).toBe(1);
    await row(page, '/name').focus(); await page.keyboard.press('Enter');
    await page.getByRole('combobox', { name: 'JSON value type' }).click();
    await page.getByRole('option', { name: 'array', exact: true }).click(); await frames(page);
    expect(await page.evaluate(() => window.__jsonDocument.value())).toMatchObject({ name: [] });
    await row(page, '').hover(); await page.getByRole('button', { name: 'Add entry at settings', exact: true }).click();
    await page.getByRole('textbox', { name: 'Rename settings.key', exact: true }).fill('new'); await page.keyboard.press('Enter');
    await page.getByRole('textbox', { name: 'Edit settings.new', exact: true }).fill('42'); await page.keyboard.press('Enter'); await frames(page);
    expect(await page.evaluate(() => window.__jsonDocument.value())).toMatchObject({ new: 42 });
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await frames(page);
    expect(await page.evaluate(() => Object.hasOwn(window.__jsonDocument.value() as object, 'new'))).toBe(false);
    await page.evaluate(() => window.__jsonDocument.preflight('prevent-remove')); await frames(page);
    await row(page, '/count').focus(); await page.keyboard.press('Delete');
    expect(await page.getByRole('alert').textContent()).toContain('required');
  } finally { await page.close(); }
}, 25_000);

browserTest('Code retains malformed source and freezes the tree, then admits corrected source without unsafe HTML', async () => {
  const page = await mount();
  try {
    await page.getByRole('tab', { name: 'Code', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Settings JSON source', exact: true });
    await source.fill('{"title":'); await frames(page);
    await page.getByRole('tab', { name: /Tree/ }).click();
    expect(await editor(page).getByRole('status').allTextContents()).toContain('The Code draft has an error. The tree shows the last valid version.Go to CodeRevert Code');
    await row(page, '/count').focus(); await page.keyboard.press('Enter'); expect(await editor(page).locator('.zero-json-inline').count()).toBe(0);
    await page.getByRole('button', { name: 'Go to Code' }).click(); expect(await source.inputValue()).toBe('{"title":');
    await source.fill('{"title":"<img src=x onerror=alert(1)>","count":9}'); await page.getByRole('tab', { name: 'Tree', exact: true }).click();
    expect(await page.evaluate(() => window.__jsonDocument.value())).toEqual({ title: '<img src=x onerror=alert(1)>', count: 9 });
    expect(await editor(page).locator('img').count()).toBe(0);
    expect(await row(page, '/title').textContent()).toContain('<img src=x onerror=alert(1)>');
  } finally { await page.close(); }
}, 20_000);

browserTest('accepted writer acknowledges only its snapshot; failure and disabled/retired sessions cannot fake saved state', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => window.__jsonDocument.configure({ writer: true })); await frames(page);
    await editNumber(page, '2'); await page.getByRole('button', { name: 'Save', exact: true }).click();
    await editNumber(page, '3'); await page.evaluate(() => window.__jsonDocument.accept(0)); await frames(page);
    expect(await editor(page).textContent()).toContain('Snapshot saved. Newer local changes remain.');
    expect(await page.getByRole('button', { name: 'Saved', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.evaluate(() => window.__jsonDocument.reject(1)); await frames(page);
    expect(await page.getByRole('alert').textContent()).toContain('Writer rejected');
    await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.evaluate(() => window.__jsonDocument.configure({ disabled: true })); await frames(page);
    expect(await page.evaluate(() => window.__jsonDocument.writes()[2]!.signal.aborted)).toBe(true);
    await page.evaluate(() => window.__jsonDocument.accept(2)); await frames(page);
    expect(await page.getByRole('button', { name: 'Saved', exact: true }).count()).toBe(0);
    await page.evaluate(() => window.__jsonDocument.configure({ disabled: false })); await frames(page);
    await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.evaluate(() => window.__jsonDocument.configure({ mounted: false })); await frames(page);
    await page.evaluate(() => window.__jsonDocument.accept(3)); await frames(page);
    expect(await page.evaluate(() => window.__jsonDocument.savedHandle()!.commit().ok)).toBe(false);
  } finally { await page.close(); }
}, 25_000);

browserTest('document identity retires a pending writer and concurrent source replacements preserve drafts until explicit discard', async () => {
  const page = await mount();
  try {
    await editNumber(page, '2'); await page.evaluate(() => window.__jsonDocument.replace({ count: 5 })); await frames(page);
    expect(await page.getByRole('alert').textContent()).toContain('source document changed');
    await page.getByRole('button', { name: 'Discard', exact: true }).click(); await frames(page);
    expect(await row(page, '/count').textContent()).toContain('5');
    await page.evaluate(() => window.__jsonDocument.configure({ writer: true })); await frames(page);
    await editNumber(page, '6'); await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.evaluate(() => window.__jsonDocument.configure({ documentKey: 'two' })); await frames(page);
    expect(await page.evaluate(() => window.__jsonDocument.writes()[0]!.signal.aborted)).toBe(true);
    await page.evaluate(() => window.__jsonDocument.accept(0)); await frames(page);
    expect(await page.getByRole('button', { name: 'Saved', exact: true }).count()).toBe(0);
  } finally { await page.close(); }
}, 20_000);

browserTest('paged keyboard navigation, search reveal, one Arc viewport and parent scrolling remain usable at narrow width', async () => {
  const page = await mount(370);
  try {
    await page.evaluate(() => { window.__jsonDocument.configure({ pageSize: 3 }); window.__jsonDocument.replace(Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key${index}`, index]))); }); await frames(page);
    await editor(page).getByRole('treeitem', { name: 'Show 62 more entries', exact: true }).focus();
    expect(await editor(page).getByRole('treeitem', { name: 'Show 62 more entries', exact: true }).getAttribute('tabindex')).toBe('0');
    await page.keyboard.press('Enter'); await frames(page); expect(await row(page, '/key5').count()).toBe(1);
    await page.getByRole('searchbox', { name: 'Search keys and values' }).fill('key64'); await frames(page);
    expect(await row(page, '/key64').count()).toBe(1);
    const viewport = editor(page).locator('.zero-json-tree-scroll');
    expect(await viewport.evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe('none');
    expect(await editor(page).locator('[data-zero-scroll-decoration="next"]').count()).toBe(1);
    await viewport.evaluate(element => { element.scrollTop = 73; }); await frames(page);
    expect(await viewport.evaluate(element => (element as HTMLElement).style.getPropertyValue('--zero-scroll-edge-top'))).toContain('28px');
    expect(await editor(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await editor(page).locator('.zero-json-tree').evaluate(element => getComputedStyle(element).getPropertyValue('--zero-json-indent').trim())).toBe('12px');
    await editor(page).screenshot({ path: `${artifacts}/narrow-tree.png` });
    await page.evaluate(() => window.__jsonDocument.configure({ scrollMode: 'parent' })); await frames(page);
    expect(await viewport.evaluate(element => getComputedStyle(element).overflowY)).toBe('visible');
    expect(await editor(page).locator('[data-zero-scroll-decoration="next"]').count()).toBe(0);
  } finally { await page.close(); }
}, 20_000);

browserTest('Tree/Code materials resolve in both themes and magnetic highlight follows rows; reduced motion removes transitions', async () => {
  const page = await mount(1000, false);
  try {
    await row(page, '/title').hover(); await frames(page);
    const highlight = editor(page).locator('.zero-json-highlight'), from = await highlight.evaluate(element => (element as HTMLElement).style.transform);
    await row(page, '/count').hover(); await frames(page);
    expect(await highlight.evaluate(element => (element as HTMLElement).style.transform)).not.toBe(from);
    expect(await highlight.evaluate(element => getComputedStyle(element).transitionDuration)).not.toBe('0s');
    const light = await editor(page).evaluate(element => ({ bg: getComputedStyle(element).backgroundColor, font: getComputedStyle(element).fontFamily }));
    expect(light.bg).not.toBe('rgba(0, 0, 0, 0)'); expect(light.font).toContain('Inter');
    await editor(page).screenshot({ path: `${artifacts}/light-tree.png` });
    await page.evaluate(() => document.documentElement.classList.add('dark')); await frames(page);
    expect(await editor(page).evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(light.bg);
    await page.getByRole('tab', { name: 'Code', exact: true }).click(); await frames(page);
    await editor(page).screenshot({ path: `${artifacts}/dark-code.png` });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await editor(page).locator('.zero-json-tab-pill').evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
  } finally { await page.close(); }
}, 20_000);

browserTest('branch geometry morphs from the painted state and settles immediately on a live reduced-motion change', async () => {
  const page = await mount(1000, false);
  try {
    await row(page, '/nested').focus(); await page.keyboard.press('ArrowRight'); await frames(page);
    expect(await row(page, '/nested/child').count()).toBe(1);
    const motion = await editor(page).locator('.zero-json-tree').evaluate(element => element.getAnimations({ subtree: true }).map(animation => animation.effect?.getTiming().duration));
    expect(motion.length).toBeGreaterThan(0); expect(motion).toContain(240);
    await page.emulateMedia({ reducedMotion: 'reduce' }); await frames(page);
    const remaining = await editor(page).locator('.zero-json-tree').evaluate(element => element.getAnimations({ subtree: true }).map(animation => ({
      kind: animation.constructor.name, state: animation.playState, target: (animation.effect as KeyframeEffect | null)?.target?.className, duration: animation.effect?.getTiming().duration,
    })));
    expect(remaining).toEqual([]);
    await page.keyboard.press('ArrowLeft'); await frames(page); expect(await row(page, '/nested/child').count()).toBe(0);
  } finally { await page.close(); }
}, 20_000);

browserTest('source owns both axes without a nested textarea scroller and explicit reversion keeps the last valid tree', async () => {
  const page = await mount(370);
  try {
    await page.evaluate(() => window.__jsonDocument.replace({ wide: 'x'.repeat(200), rows: Array.from({ length: 40 }, (_, index) => index) })); await frames(page);
    await page.getByRole('tab', { name: 'Code', exact: true }).click();
    const viewport = editor(page).locator('.zero-json-source-scroll'), source = page.getByRole('textbox', { name: 'Settings JSON source', exact: true });
    expect(await viewport.evaluate(element => element.scrollWidth > element.clientWidth && element.scrollHeight > element.clientHeight)).toBe(true);
    await viewport.evaluate(element => { element.scrollLeft = 61; element.scrollTop = 83; }); await frames(page);
    expect(await viewport.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))).toEqual({ left: 61, top: 83 });
    expect(await source.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))).toEqual({ left: 0, top: 0 });
    await source.fill('{"bad":'); await page.getByRole('button', { name: 'Revert Code', exact: true }).click(); await frames(page);
    expect(JSON.parse(await source.inputValue())).toMatchObject({ wide: 'x'.repeat(200) });
    expect(await editor(page).locator('[data-zero-scroll-decoration="next"]').count()).toBe(1);
  } finally { await page.close(); }
}, 20_000);
