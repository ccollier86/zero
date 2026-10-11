/** Native virtual TimePicker paint contracts: one magnetic layer and shared scroll treatment without moving value/focus ownership. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, script = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/time-presentation-');
  try {
    const build = await Bun.build({ entrypoints: [`${import.meta.dir}/date-time-picker.browser-fixture.tsx`],
      target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
    if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
    script = await build.outputs.find(output => output.path.endsWith('.js'))!.text();
    css = await Bun.file((await buildPlatformStyles(directory, `${directory}/absent-app`)).cssPath).text();
    for (const output of build.outputs.filter(output => output.path.endsWith('.css'))) css += '\n' + await output.text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

async function mount(reduced = false): Promise<Page> {
  const page = await lease!.browser.newPage({ viewport: { width: 800, height: 760 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  page.setDefaultTimeout(5000);
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await page.getByRole('combobox', { name: 'Meeting time', exact: true }).waitFor();
  await page.evaluate(() => (window as any).__dateTimePickers.configure({ step: 1 }));
  await page.getByRole('combobox', { name: 'Meeting time', exact: true }).click();
  await page.getByRole('listbox', { name: 'Meeting time options', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-slot="time-picker-list"] .zero-menu-active-highlight'));
  return page;
}

async function waitLayer(page: Page) {
  await page.waitForFunction(() => {
    const list = document.querySelector<HTMLElement>('[data-slot="time-picker-list"]');
    const option = list?.querySelector<HTMLElement>('[data-active]'), layer = list?.querySelector<HTMLElement>('.zero-menu-active-highlight');
    if (!option || !layer) return false;
    const a = option.getBoundingClientRect(), b = layer.getBoundingClientRect();
    return Math.abs(a.top - b.top) < 1 && Math.abs(a.height - b.height) < 1 && getComputedStyle(layer).opacity === '1';
  });
}

browserTest('one magnetic layer follows hovered and keyboard-active virtual Time options without changing selection, form value or listbox focus', async () => {
  const page = await mount();
  try {
    const list = page.getByRole('listbox', { name: 'Meeting time options', exact: true });
    await list.evaluate(element => { element.setAttribute('data-identity', 'same'); (window as any).__timeList = element; });
    await waitLayer(page);
    expect(await list.locator('.zero-menu-active-highlight').count()).toBe(1);
    expect(await list.locator('[role="option"]').count()).toBeLessThan(60);
    expect(await list.locator('[role="option"][aria-selected="true"]').count()).toBe(1);
    const next = list.locator('[data-active]').locator('xpath=following-sibling::*[@role="option"][1]');
    const hover = await next.getAttribute('data-option-index');
    await next.hover(); await waitLayer(page);
    expect(await list.locator('[data-active]').getAttribute('data-option-index')).toBe(hover);
    expect(await next.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    expect(await page.evaluate(() => (window as any).__dateTimePickers.changes())).toEqual([]);
    expect(await page.getByTestId('time-form').evaluate(element => new FormData(element as HTMLFormElement).get('meetingTime'))).toBe('17:46');
    expect(await list.evaluate(element => element === document.activeElement)).toBe(true);
    await page.keyboard.press('ArrowDown'); await waitLayer(page);
    expect(await list.locator('[data-active]').getAttribute('data-option-index')).toBe(String(Number(hover) + 1));
    expect(await list.evaluate(element => element === (window as any).__timeList)).toBe(true);
    expect(await list.getAttribute('data-identity')).toBe('same');
    expect(await list.evaluate(element => element.getAttribute('aria-activedescendant') === element.querySelector('[data-active]')?.id)).toBe(true);
    expect(await page.evaluate(() => (window as any).__dateTimePickers.changes())).toEqual([]);
    await page.keyboard.press('Enter'); await list.waitFor({ state: 'detached' });
    expect(await page.evaluate(() => (window as any).__dateTimePickers.changes())).toHaveLength(1);
    expect(await page.getByRole('combobox', { name: 'Meeting time', exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
  } finally { await page.close(); }
}, 20_000);

browserTest('Time uses the exact native virtual viewport for fades/overlay rail and keeps End/Home active options rendered under reduced motion', async () => {
  const page = await mount(true);
  try {
    const list = page.getByRole('listbox', { name: 'Meeting time options', exact: true });
    await waitLayer(page);
    await page.waitForFunction(() => document.querySelector('[data-slot="time-picker-list"]')?.classList.contains('zero-scroll-viewport'));
    expect(await list.getAttribute('data-zero-scroll-fade')).toBe('vertical');
    expect(await list.evaluate(element => ({ scrollbars: getComputedStyle(element).scrollbarWidth,
      overflow: element.scrollHeight > element.clientHeight, native: element.getAttribute('role'),
      childScrollers: element.querySelectorAll('[data-radix-scroll-area-viewport]').length })))
      .toEqual({ scrollbars: 'none', overflow: true, native: 'listbox', childScrollers: 0 });
    expect(await page.locator('[data-slot="time-picker-popover"] .zero-scroll-track[data-axis="y"]').count()).toBe(1);
    await page.keyboard.press('End'); await waitLayer(page);
    expect(await list.getAttribute('aria-activedescendant')).toEndWith('-option-1439');
    expect(await list.locator('[data-active]').textContent()).toContain('11:59 PM');
    expect(await list.evaluate(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 1)).toBe(true);
    expect(await list.locator('.zero-menu-active-highlight').evaluate(element => element.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
    await page.keyboard.press('Home'); await waitLayer(page);
    expect(await list.getAttribute('aria-activedescendant')).toEndWith('-option-0');
    expect(await list.locator('[data-active]').textContent()).toContain('12:00 AM');
    expect(await list.evaluate(element => element.scrollTop)).toBe(0);
    expect(await page.evaluate(() => (window as any).__dateTimePickers.changes())).toEqual([]);
    expect(await page.getByTestId('time-form').evaluate(element => new FormData(element as HTMLFormElement).get('meetingTime'))).toBe('17:46');
  } finally { await page.close(); }
}, 20_000);
