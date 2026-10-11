/** Real Radix-select portal typography and ownership checks; synthetic DOM only, no application boot or font downloads. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { addZeroSource } from '../../../add/copy';
import { renderThemeFoundationCss } from '../../../design-system/theme-css';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, script = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const built = await Bun.build({ entrypoints: [`${import.meta.dir}/select-theme.browser-fixture.tsx`], target: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
  if (!built.success) throw new Error(built.logs.map(log => log.message).join('\n'));
  script = await built.outputs[0]!.text();
  const require = createRequire(import.meta.url), { compile } = require('@tailwindcss/node') as typeof import('@tailwindcss/node');
  const url = new URL('../../../frontend/styles/globals.css', import.meta.url);
  const compiler = await compile(await Bun.file(url).text(), { base: new URL('../../../frontend/styles/', import.meta.url).pathname,
    from: url.pathname, onDependency() {} });
  const files = ['select.tsx', 'select-theme.browser-fixture.tsx'];
  const candidates = (await Promise.all(files.map(file => Bun.file(`${import.meta.dir}/${file}`).text()))).join('\n').match(/[^\s"'`]+/gu) ?? [];
  css = compiler.build(candidates) + '\n' + renderThemeFoundationCss();
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

async function mount(): Promise<Page> {
  const page = await lease!.browser.newPage({ viewport: { width: 1000, height: 760 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000);
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await page.getByTestId('outside-trigger').waitFor();
  return page;
}
async function open(page: Page, kind: 'outside' | 'owned') {
  await page.getByTestId(`${kind}-trigger`).press('ArrowDown');
  const content = page.getByTestId(`${kind}-content`); await content.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'option');
  return content;
}
async function snapshot(page: Page, kind: 'outside' | 'owned') {
  return page.getByTestId(`${kind}-content`).evaluate(element => {
    const item = element.querySelector('[role="option"]')!, type = getComputedStyle(item), style = getComputedStyle(element);
    return { family: type.fontFamily, size: type.fontSize, background: style.backgroundColor, zIndex: style.zIndex,
      pointerEvents: style.pointerEvents, inert: element.hasAttribute('inert') };
  });
}
async function waitType(page: Page, kind: 'outside' | 'owned', size: string, family: string) {
  await page.waitForFunction(({ kind, size, family }) => {
    const item = document.querySelector(`[data-testid="${kind}-content"] [role="option"]`);
    return item && getComputedStyle(item).fontSize === size && getComputedStyle(item).fontFamily === family;
  }, { kind, size, family });
}

browserTest('standalone Select projects its scoped source theme and updates it without losing Radix focus, value or refs', async () => {
  const page = await mount();
  try {
    const content = await open(page, 'outside');
    await waitType(page, 'outside', '19px', 'monospace');
    expect(await snapshot(page, 'outside')).toMatchObject({ background: 'rgb(17, 34, 51)' });
    expect(await content.evaluate(element => !document.querySelector('#outside-source')!.contains(element))).toBe(true);
    const before = await page.evaluate(() => (window as any).__selectTheme.refs('outside'));
    expect(before).toMatchObject({ triggerMatches: true, contentMatches: true });
    await content.evaluate(element => { element.setAttribute('data-identity', 'same'); (window as any).__focusedSelect = document.activeElement; });
    await page.locator('#outside-source').evaluate(element => {
      const style = (element as HTMLElement).style;
      style.setProperty('--zero-theme-font-body', 'serif'); style.setProperty('--zero-type-navigation-size', '21px'); style.setProperty('--popover', '#223344');
    });
    await waitType(page, 'outside', '21px', 'serif');
    expect(await snapshot(page, 'outside')).toMatchObject({ background: 'rgb(34, 51, 68)' });
    expect(await content.getAttribute('data-identity')).toBe('same');
    expect(await page.evaluate(() => document.activeElement === (window as any).__focusedSelect)).toBe(true);
    expect(await page.evaluate(() => (window as any).__selectTheme.refs('outside'))).toMatchObject({ triggerMatches: true, contentMatches: true });
    expect(await page.evaluate(() => (window as any).__selectTheme.changes())).toEqual([]);
    expect(await page.getByTestId('outside-form').evaluate(element => new FormData(element as HTMLFormElement).get('choice'))).toBe('one');
    await page.keyboard.press('t');
    await page.waitForFunction(() => document.activeElement?.textContent === 'Two');
    await page.keyboard.press('Enter');
    await content.waitFor({ state: 'detached' });
    expect(await page.getByTestId('outside-trigger').textContent()).toContain('Two');
    expect(await page.getByTestId('outside-form').evaluate(element => new FormData(element as HTMLFormElement).get('choice'))).toBe('two');
    expect(await page.getByTestId('outside-trigger').evaluate(element => element === document.activeElement)).toBe(true);
  } finally { await page.close(); }
}, 30_000);

browserTest('owned Select prefers closer trigger overrides and explicit content style while preserving owner registration and layers', async () => {
  const page = await mount();
  try {
    const content = await open(page, 'owned');
    await waitType(page, 'owned', '23px', 'monospace');
    expect(await snapshot(page, 'owned')).toMatchObject({ background: 'rgb(85, 102, 119)', zIndex: '1402' });
    expect(await page.evaluate(() => (window as any).__selectTheme.registered())).toBe(true);
    expect(await page.evaluate(() => (window as any).__selectTheme.refs('owned'))).toMatchObject({ triggerMatches: true, contentMatches: true });
    await content.evaluate(element => { element.setAttribute('data-identity', 'same'); (window as any).__focusedSelect = document.activeElement; });
    await page.getByTestId('owned-trigger').evaluate(element => {
      const style = (element as HTMLElement).style;
      style.setProperty('--zero-theme-font-body', 'serif'); style.setProperty('--zero-type-navigation-size', '25px');
    });
    await waitType(page, 'owned', '25px', 'serif');
    await page.evaluate(() => (window as any).__selectTheme.setContentOverrides({ '--zero-theme-font-body': 'monospace',
      '--zero-type-navigation-size': '27px', '--popover': '#334455', zIndex: 9999, pointerEvents: 'auto' }));
    await waitType(page, 'owned', '27px', 'monospace');
    expect(await snapshot(page, 'owned')).toMatchObject({ background: 'rgb(51, 68, 85)', zIndex: '1402' });
    expect(await page.evaluate(() => (window as any).__selectTheme.refs('owned'))).toMatchObject({ triggerMatches: true, contentMatches: true });
    expect(await content.getAttribute('data-identity')).toBe('same');
    expect(await page.evaluate(() => document.activeElement === (window as any).__focusedSelect)).toBe(true);
    await page.evaluate(() => (window as any).__selectTheme.setActive(false));
    await page.waitForFunction(() => document.querySelector('[data-testid="owned-content"]')?.hasAttribute('inert'));
    expect(await snapshot(page, 'owned')).toMatchObject({ zIndex: '1402', pointerEvents: 'none', inert: true });
    expect(await page.evaluate(() => (window as any).__selectTheme.registered())).toBe(true);
    await page.evaluate(() => (window as any).__selectTheme.setActive(true));
    await page.waitForFunction(() => !document.querySelector('[data-testid="owned-content"]')?.hasAttribute('inert'));
    expect(await snapshot(page, 'owned')).toMatchObject({ zIndex: '1402', pointerEvents: 'auto', inert: false });
    expect(await page.evaluate(() => (window as any).__selectTheme.refs('owned'))).toMatchObject({ triggerMatches: true, contentMatches: true });
    expect(await content.getAttribute('data-identity')).toBe('same');
    expect(await page.evaluate(() => (window as any).__selectTheme.changes())).toEqual([]);
  } finally { await page.close(); }
}, 30_000);

test('source-copied Select includes the source-theme observer closure and browser-builds without booting application config', async () => {
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
  await mkdir(scratch, { recursive: true });
  const consumer = await mkdtemp(join(scratch, 'select-theme-consumer-'));
  try {
    const packageRoot = new URL('../../../../', import.meta.url).pathname;
    const installed = join(packageRoot, 'node_modules'), modules = join(consumer, 'node_modules');
    await mkdir(join(modules, '@zero'), { recursive: true });
    await Promise.all((await readdir(installed)).filter(name => name !== '@zero').map(name => symlink(join(installed, name), join(modules, name))));
    await symlink(packageRoot, join(modules, '@zero/framework'), 'dir');
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', jsx: 'react-jsx',
      moduleResolution: 'Bundler', paths: { '@/*': ['./*'] } } }));
    await writeFile(join(consumer, 'zero.config.ts'), "throw new Error('SELECT_COPY_MUST_NOT_BOOT_CONFIG');\n");
    const copied = await addZeroSource({ targetDir: consumer, items: ['components/ui/select', 'theme-foundation'] });
    expect(copied.filesWritten).toContain('components/ui/select.tsx');
    expect(copied.filesWritten).toContain('components/overlays/overlay-scope.tsx');
    expect(copied.filesWritten).toContain('components/ui/select-morph.css');
    expect(copied.filesWritten).toContain('components/overlays/scroll-viewport.css');
    expect(copied.filesWritten).toContain('components/ui/select-morph-motion.ts');
    expect(copied.filesWritten).toContain('lib/observe-presentation-theme.ts');
    expect(copied.filesWritten.some(path => /\.(?:test|browser-fixture)\./u.test(path))).toBe(false);
    await writeFile(join(consumer, 'entry.ts'), "export { Select, SelectTrigger, SelectContent, SelectItem } from './components/ui/select';\n");
    const build = Bun.spawn([process.execPath, '--no-env-file', 'build', 'entry.ts', '--target', 'browser', '--outdir', 'build'],
      { cwd: consumer, stdout: 'pipe', stderr: 'pipe', timeout: 30_000 });
    const [code, output, diagnostic] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (code !== 0) throw new Error(`Copied Select build failed: ${diagnostic}`);
    expect(code).toBe(0);
    expect(output).not.toContain('SELECT_COPY_MUST_NOT_BOOT_CONFIG');
  } finally {
    // Remove only this exact disposable test consumer allocated above.
    await rm(consumer, { recursive: true, force: true });
  }
}, 40_000);
