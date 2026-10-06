/** Actual styled browser/SSR controls on a disposable Bun/Elysia origin. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Elysia } from 'elysia';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
import { CodeBlock } from './code-block';
import { prepareCodeBlock } from './code-block-server';

const TIMEOUT = 60_000;
let lease: PlaywrightTestBrowserLease, directory: string, evidence: string;
let app: ReturnType<typeof serveCodeBlockFixture> | undefined, baseUrl = '';

function serveCodeBlockFixture(scriptPath: string, cssPath: string, ssr: string) {
  return new Elysia()
    .get('/fixture.js', () => new Response(Bun.file(scriptPath), { headers: { 'Content-Type': 'text/javascript' } }))
    .get('/fixture.css', () => new Response(Bun.file(cssPath), { headers: { 'Content-Type': 'text/css' } }))
    .get('/', ({ query }) => new Response(`<!doctype html><html${query.dark ? ' class="dark"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`, { headers: { 'Content-Type': 'text/html' } }))
    .get('/ssr', () => new Response(`<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body>${ssr}</body></html>`, { headers: { 'Content-Type': 'text/html' } }))
    .listen({ hostname: '127.0.0.1', port: 0 });
}

beforeAll(async () => {
  lease = await acquirePlaywrightTestBrowser();
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
  const artifacts = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/code-block';
  await mkdir(scratch, { recursive: true }); await mkdir(artifacts, { recursive: true });
  directory = await mkdtemp(join(scratch, 'code-block-')); evidence = await mkdtemp(join(artifacts, 'acceptance-'));
  const build = Bun.spawn({ cmd: [process.execPath, '--no-env-file', 'build', join(import.meta.dir, 'code-block.browser-fixture.tsx'),
    '--target=browser', '--format=iife', `--outfile=${join(directory, 'fixture.js')}`], stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, status] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
  if (status) throw new Error(`CodeBlock fixture build failed: ${stdout}\n${stderr}`);
  const styles = await buildPlatformStyles(directory, join(directory, 'empty-app'));
  const ssr = renderToStaticMarkup(React.createElement(CodeBlock, await prepareCodeBlock({
    code: 'const server = "colored without JavaScript";', language: 'ts', filename: 'server.ts', lineAnchors: 'server',
  })));
  app = serveCodeBlockFixture(join(directory, 'fixture.js'), styles.cssPath, ssr);
  baseUrl = `http://127.0.0.1:${app.server!.port}`;
}, TIMEOUT);
afterAll(async () => {
  try { await app?.stop(true); if (directory) await rm(directory, { recursive: true, force: true }); }
  finally { lease?.release(); }
}, TIMEOUT);

async function open(width = 1280, dark = false): Promise<Page> {
  const page = await lease.browser.newPage({ viewport: { width, height: 1000 } });
  page.setDefaultTimeout(5000);
  await page.goto(`${baseUrl}/${dark ? '?dark=1' : ''}`); await page.getByTestId('fixture-ready').waitFor();
  await page.getByTestId('annotations').locator('.shiki.has-diff').waitFor();
  return page;
}

describe('CodeBlock browser feature family', () => {
  test('same-array same-name custom-hook replacement starts a new live highlight generation under a portable key', async () => {
    const page = await open();
    try {
      const block = page.getByTestId('custom-transformer');
      await block.locator('pre[data-custom-stamp="original"]').waitFor();
      await page.getByTestId('replace-transformer').click();
      await block.locator('pre[data-custom-stamp="replacement"]').waitFor();
      expect(await block.locator('pre[data-custom-stamp="original"]').count()).toBe(0);
      expect(await block.locator('pre').innerText()).toBe('stable source');
    } finally { await page.close(); }
  }, TIMEOUT);
  test('runtime metric tokens change real code/actions and both radius roles resolve', async () => {
    const page = await open(); try {
      const before = await page.getByTestId('annotations').evaluate(element => {
        const button = element.querySelector('button')!;
        return { rootRadius: Number.parseFloat(getComputedStyle(element).borderRadius),
          actionRadius: Number.parseFloat(getComputedStyle(button).borderRadius) };
      });
      expect(before.rootRadius).toBeGreaterThan(0); expect(before.actionRadius).toBeGreaterThan(0);
      const after = await page.getByTestId('annotations').evaluate(element => {
        const root = element as HTMLElement;
        root.style.setProperty('--zero-code-action-size', '48px');
        root.style.setProperty('--zero-code-header-font-size', '17px');
        root.style.setProperty('--zero-code-action-radius', '11px');
        root.style.setProperty('--zero-code-radius', '19px');
        root.style.setProperty('--zero-code-font-size', '18px');
        const button = element.querySelector('button')!, pre = element.querySelector('pre')!;
        const box = button.getBoundingClientRect();
        return { width: box.width, height: box.height, font: getComputedStyle(button).fontSize,
          rootRadius: getComputedStyle(element).borderRadius, actionRadius: getComputedStyle(button).borderRadius,
          codeFont: getComputedStyle(pre).fontSize,
          rootToken: getComputedStyle(element).getPropertyValue('--zero-code-action-size'),
          buttonToken: getComputedStyle(button).getPropertyValue('--zero-code-action-size'),
          buttonStyle: button.getAttribute('style') };
      });
      expect({ ...after, buttonStyle: undefined }).toEqual({ width: 48, height: 48, font: '17px', rootRadius: '19px',
        actionRadius: '11px', codeFont: '18px', rootToken: '48px', buttonToken: '48px', buttonStyle: undefined });
      expect(after.rootRadius).toBe('19px'); expect(after.actionRadius).toBe('11px'); expect(after.codeFont).toBe('18px');
    } finally { await page.close(); }
  }, TIMEOUT);
  test('real syntax colors, diff/focus/word highlights and anchors are visible in both themes/mobile', async () => {
    for (const width of [1280, 390]) for (const dark of [false, true]) {
      const page = await open(width, dark); try {
        const block = page.getByTestId('annotations');
        const paint = await block.evaluate(element => {
          const keyword = [...element.querySelectorAll('.line span')].find(item => item.textContent === 'const')!;
          const plain = element.querySelector('pre')!;
          return { keyword: getComputedStyle(keyword).color, plain: getComputedStyle(plain).color,
            added: getComputedStyle(element.querySelector('.diff.add')!).backgroundColor,
            removed: getComputedStyle(element.querySelector('.diff.remove')!).backgroundColor,
            word: getComputedStyle(element.querySelector('.zero-code-word-highlight')!).backgroundColor,
            focused: getComputedStyle(element.querySelector('.has-focused .line:not(.focused)')!).opacity,
            font: getComputedStyle(plain).fontSize, pageOverflow: document.documentElement.scrollWidth > window.innerWidth };
        });
        expect(paint.keyword).not.toBe(paint.plain); expect(paint.added).not.toBe(paint.removed);
        expect(paint.word).not.toBe('rgba(0, 0, 0, 0)'); expect(Number(paint.focused)).toBeLessThan(1);
        expect(Number.parseFloat(paint.font)).toBeGreaterThan(0); expect(paint.pageOverflow).toBe(false);
        const anchor = block.getByRole('link', { name: 'Link to line 2', exact: true });
        await anchor.focus(); await page.keyboard.press('Enter'); expect(new URL(page.url()).hash).toBe('#annotated-l2');
        await page.screenshot({ path: join(evidence, `${width}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
      } finally { await page.close(); }
    }
  }, TIMEOUT);
  test('file tabs have keyboard navigation and copy the current source with original callbacks', async () => {
    const page = await open(); try {
      const block = page.getByTestId('files'); const first = block.getByRole('tab', { name: 'server.ts' });
      await first.focus(); await page.keyboard.press('ArrowRight');
      await block.getByRole('tab', { name: 'client.tsx' }).waitFor();
      await page.waitForFunction(() => document.querySelector('[data-testid="files"] [role="tab"][aria-selected="true"]')?.textContent?.includes('client.tsx'));
      expect(await block.locator('pre').innerText()).toContain('Second');
      await block.getByRole('button', { name: 'Copy code', exact: true }).click();
      await page.waitForFunction(() => window.__codeProbe.copies.includes('client'));
      expect(await page.evaluate(() => window.__codeProbe.writes.at(-1))).toBe('const Client = () => <p>Second</p>;');
      await page.keyboard.press('Home');
      expect(await block.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(await block.getByRole('tab', { name: 'client.tsx' }).getAttribute('id'));
    } finally { await page.close(); }
  }, TIMEOUT);
  test('typed code changes never show older results, wide lines scroll internally and wrapping is bounded', async () => {
    const page = await open(390); try {
      const block = page.getByTestId('controlled'); await block.getByRole('button', { name: 'Change source' }).click();
      expect(await block.locator('pre').innerText()).toContain('new source'); expect(await block.locator('pre').innerText()).not.toContain('old source');
      const before = await page.getByTestId('long').locator('.zero-code-block-viewport').evaluate(element => ({ scroll: element.scrollWidth, width: element.clientWidth }));
      expect(before.scroll).toBeGreaterThan(before.width);
      await page.getByTestId('wrap-toggle').click();
      const after = await page.getByTestId('long').locator('.zero-code-block-viewport').evaluate(element => ({ scroll: element.scrollWidth, width: element.clientWidth }));
      expect(after.scroll).toBeLessThanOrEqual(after.width + 1);
      expect(await page.getByTestId('fallback').locator('pre').innerText()).toContain('unsupported source');
      expect(await page.getByTestId('escaped').locator('img').count()).toBe(0);
    } finally { await page.close(); }
  }, TIMEOUT);
  test('clipboard operations await completion, block duplicate clicks, preserve prevention and report failure', async () => {
    const page = await open(); try {
      const button = page.getByTestId('controlled').getByRole('button', { name: 'Copy code', exact: true });
      await page.evaluate(() => { window.__codeProbe.reset(); window.__codeProbe.hold = true; });
      await button.click(); expect(await button.isDisabled()).toBe(true); expect(await button.getAttribute('aria-busy')).toBe('true');
      expect(await page.evaluate(() => window.__codeProbe.writes.length)).toBe(1);
      await page.evaluate(() => window.__codeProbe.release?.());
      await page.waitForFunction(() => window.__codeProbe.copies.length === 1);
      expect(await page.getByTestId('controlled').getByRole('button', { name: 'Code copied', exact: true }).isEnabled()).toBe(true);
      await page.evaluate(() => { window.__codeProbe.reset(); window.__codeProbe.reject = true; });
      await page.getByTestId('controlled').getByRole('button', { name: 'Code copied', exact: true }).click();
      await page.waitForFunction(() => window.__codeProbe.failures === 1);
      expect(await button.isEnabled()).toBe(true); expect(await page.evaluate(() => window.__codeProbe.copies.length)).toBe(0);
      await page.getByTestId('prevent-copy').click(); await button.click();
      expect(await page.evaluate(() => window.__codeProbe.writes.length)).toBe(1);
      expect(await button.evaluate(element => element === window.__codeProbe.ref)).toBe(true);
    } finally { await page.close(); }
  }, TIMEOUT);
  test('package manager tabs/select synchronize and persist only when enabled', async () => {
    const page = await open(); try {
      await page.getByTestId('packages-tabs').getByRole('tab', { name: 'pnpm', exact: true }).click();
      await page.getByTestId('packages-select').getByRole('button', { name: 'Package manager: pnpm' }).waitFor();
      expect(await page.getByTestId('packages-tabs').locator('pre').innerText()).toContain('pnpm add @zero/framework');
      await page.getByTestId('packages-select').getByRole('button', { name: 'Package manager: pnpm' }).click();
      await page.getByRole('menuitemradio', { name: 'yarn', exact: true }).click();
      expect(await page.getByTestId('packages-select').locator('pre').innerText()).toContain('yarn add @zero/framework');
      expect(await page.evaluate(() => localStorage.getItem('zero-code-browser-test'))).toBe('yarn');
      await page.reload(); await page.getByTestId('fixture-ready').waitFor();
      await page.getByTestId('packages-select').getByRole('button', { name: 'Package manager: yarn' }).waitFor();
    } finally { await page.close(); }
  }, TIMEOUT);
  test('trusted pre copies exactly one newline and inline/morph controls remain usable', async () => {
    const page = await open(); try {
      // CodeBlockPre forwards native pre props to the actual pre, not its shell.
      await page.getByTestId('pre').locator('..').locator('..').locator('..').getByRole('button', { name: 'Copy code', exact: true }).click();
      expect(await page.evaluate(() => window.__codeProbe.writes.at(-1))).toBe('one\ntwo');
      await page.getByTestId('inline').getByRole('button', { name: 'Copy code', exact: true }).click();
      expect(await page.evaluate(() => window.__codeProbe.writes.at(-1))).toBe('bun add @zero/framework');
      await page.emulateMedia({ reducedMotion: 'reduce' }); await page.getByTestId('morph-copy').click();
      expect(await page.evaluate(() => window.__codeProbe.writes.at(-1))).toBe('morph text');
    } finally { await page.close(); }
  }, TIMEOUT);
  test('non-persistent examples ignore saved preferences and blocked storage remains best-effort', async () => {
    const page = await open(); try {
      await page.evaluate(() => localStorage.setItem('zero:code-block:package-manager', 'yarn'));
      await page.reload(); await page.getByTestId('fixture-ready').waitFor();
      const local = page.getByTestId('packages-no-persist');
      expect(await local.locator('pre').innerText()).toContain('bun add local-only');
      await local.getByRole('tab', { name: 'npm', exact: true }).click();
      expect(await page.evaluate(() => localStorage.getItem('zero:code-block:package-manager'))).toBe('yarn');
      await page.evaluate(() => Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('Synthetic storage denial'); } }));
      await page.getByTestId('packages-tabs').getByRole('tab', { name: 'pnpm', exact: true }).click();
      await page.getByTestId('packages-select').getByRole('button', { name: 'Package manager: pnpm' }).waitFor();
      expect(await page.getByTestId('packages-select').locator('pre').innerText()).toContain('pnpm add @zero/framework');
    } finally { await page.close(); }
  }, TIMEOUT);
  test('copy reset options remain reactive rather than retaining their initial timeout', async () => {
    const page = await open(); try {
      await page.getByTestId('persist-feedback').click(); await page.getByTestId('morph-copy').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="morph-copy"]')?.getAttribute('data-copied') === 'true');
      await page.evaluate(() => new Promise<void>(resolve => {
        const until = performance.now() + 100;
        const frame = () => { if (performance.now() >= until) resolve(); else requestAnimationFrame(frame); };
        requestAnimationFrame(frame);
      }));
      expect(await page.getByTestId('morph-copy').getAttribute('data-copied')).toBe('true');
    } finally { await page.close(); }
  }, TIMEOUT);
  test('server-prepared colored code and line links remain readable without JavaScript', async () => {
    const page = await lease.browser.newPage({ javaScriptEnabled: false }); try {
      await page.goto(`${baseUrl}/ssr`);
      expect(await page.locator('pre').innerText()).toContain('colored without JavaScript');
      expect(await page.locator('.zero-code-block-fallback').count()).toBe(0);
      expect(await page.getByRole('link', { name: 'Link to line 1' }).getAttribute('href')).toBe('#server-l1');
    } finally { await page.close(); }
  }, TIMEOUT);
});
