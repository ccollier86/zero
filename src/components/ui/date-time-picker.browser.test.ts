/** Focused real-browser contracts for changed shared picker interactions. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

interface Fixture {
  configure(next: { disabled?: boolean; readOnly?: boolean; format?: '12h' | '24h'; step?: number; controlled?: boolean }): void;
  changes(): Array<{ field: string; value: string }>;
  controlledOpen(open: boolean): void;
  replaceDate(): void;
}
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, browser: Browser, script = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
  const builder = `const result=await Bun.build({entrypoints:[${JSON.stringify(`${import.meta.dir}/date-time-picker.browser-fixture.tsx`)}],target:'browser',format:'iife',define:{'process.env.NODE_ENV':JSON.stringify('test')}});if(!result.success){for(const log of result.logs)await Bun.write(Bun.stderr,log.message+'\\n');process.exit(1);}await Bun.write(Bun.stdout,await result.outputs[0].text());`;
  const build = Bun.spawn({ cmd: [process.execPath, '--no-env-file', '-e', builder], cwd: `${import.meta.dir}/../../..`, stdout: 'pipe', stderr: 'pipe' });
  const [output, diagnostic, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
  if (code !== 0) throw new Error(diagnostic || 'Picker fixture build failed.');
  script = output;
  const root = '/Volumes/code-bank/tmp/scratch/zero-platform/date-time-pickers';
  css = await Bun.file((await buildPlatformStyles(root, `${root}/absent-app`)).cssPath).text();
}, 60_000);
afterAll(() => lease?.release());
async function open(width = 900): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 760 } });
  page.setDefaultTimeout(5000);
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await page.getByRole('textbox', { name: 'Due date', exact: true }).waitFor();
  return page;
}
async function changes(page: Page) { return page.evaluate(() => (window as unknown as { __dateTimePickers: Fixture }).__dateTimePickers.changes()); }
function trigger(page: Page) { return page.getByTestId('typed-date').getByRole('button', { name: 'Open date picker', exact: true }); }

browserTest('calendar dismisses without changing invalid typed drafts through explicit close, outside, trigger toggle and Escape', async () => {
  const page = await open();
  try {
    const input = page.getByRole('textbox', { name: 'Due date', exact: true });
    await input.fill('02/30/2026');
    for (const action of ['close', 'outside', 'trigger', 'escape']) {
      await trigger(page).click(); await page.locator('[data-slot="date-picker-popover"]').waitFor();
      if (action === 'close') await page.getByRole('button', { name: 'Close date picker', exact: true }).click();
      else if (action === 'outside') await page.getByTestId('outside').click();
      else if (action === 'trigger') await trigger(page).click();
      else await page.keyboard.press('Escape');
      await page.locator('[data-slot="date-picker-popover"]').waitFor({ state: 'detached' });
      expect(await input.inputValue()).toBe('02/30/2026');
      expect(await changes(page)).toEqual([]);
    }
  } finally { await page.close(); }
}, 30_000);

browserTest('month/year drill-down and top arrows navigate without mutating the date', async () => {
  const page = await open();
  try {
    await trigger(page).click();
    await page.getByRole('button', { name: 'February, choose month', exact: true }).click();
    await page.getByRole('grid', { name: 'Months in 2026', exact: true }).waitFor();
    await page.getByRole('button', { name: 'April 2026', exact: true }).click();
    await page.getByRole('button', { name: 'April, choose month', exact: true }).waitFor();
    await page.getByRole('button', { name: '2026, choose year', exact: true }).click();
    await page.getByRole('grid', { name: 'Years', exact: true }).waitFor();
    await page.getByRole('button', { name: '2028', exact: true }).click();
    await page.getByRole('button', { name: '2028, choose year', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Go to the Next Month', exact: true }).click();
    await page.getByRole('button', { name: 'May, choose month', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Go to the Previous Month', exact: true }).click();
    await page.getByRole('button', { name: 'April, choose month', exact: true }).waitFor();
    expect(await changes(page)).toEqual([]);
  } finally { await page.close(); }
}, 30_000);

browserTest('nested Escape first returns to days, then closes picker, without dismissing parent record dialog', async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: 'Open parent dialog', exact: true }).click();
    const parent = page.getByTestId('parent-dialog'); await parent.waitFor();
    await parent.getByRole('button', { name: 'Open date picker', exact: true }).click();
    await page.getByRole('button', { name: '2026, choose year', exact: true }).click();
    await page.getByRole('grid', { name: 'Years', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'February, choose month', exact: true }).waitFor();
    expect(await page.locator('[data-slot="date-picker-popover"]').isVisible()).toBe(true);
    expect(await parent.isVisible()).toBe(true);
    await page.keyboard.press('Escape'); await page.locator('[data-slot="date-picker-popover"]').waitFor({ state: 'detached' });
    expect(await parent.isVisible()).toBe(true);
    expect(await parent.getByRole('textbox', { name: 'Nested date', exact: true }).inputValue()).toBe('February 3rd, 2026');
    await parent.getByRole('combobox', { name: 'Nested time', exact: true }).click();
    await page.getByRole('listbox', { name: 'Nested time options', exact: true }).waitFor();
    await page.keyboard.press('Escape'); await page.locator('[data-slot="time-picker-popover"]').waitFor({ state: 'detached' });
    expect(await parent.isVisible()).toBe(true);
  } finally { await page.close(); }
}, 30_000);

browserTest('controlled open remains caller owned and disabling open pickers retires them without edits', async () => {
  const page = await open();
  try {
    await page.evaluate(() => (window as unknown as { __dateTimePickers: Fixture }).__dateTimePickers.configure({ controlled: true }));
    await trigger(page).click(); expect(await page.locator('[data-slot="date-picker-popover"]').count()).toBe(0);
    await page.evaluate(() => (window as unknown as { __dateTimePickers: Fixture }).__dateTimePickers.controlledOpen(true));
    await page.locator('[data-slot="date-picker-popover"]').waitFor();
    await page.getByRole('button', { name: 'Close date picker', exact: true }).click();
    expect(await page.locator('[data-slot="date-picker-popover"]').isVisible()).toBe(true);
    await page.evaluate(() => (window as unknown as { __dateTimePickers: Fixture }).__dateTimePickers.configure({ readOnly: true }));
    await page.locator('[data-slot="date-picker-popover"]').waitFor({ state: 'detached' });
    expect(await trigger(page).isDisabled()).toBe(true); expect(await changes(page)).toEqual([]);
  } finally { await page.close(); }
}, 30_000);

browserTest('time list keeps an off-step value, supports keyboard picking and submits canonical HH:mm in 12/24h modes', async () => {
  const page = await open();
  try {
    const time = page.getByRole('combobox', { name: 'Meeting time', exact: true });
    expect(await time.textContent()).toContain('5:46 PM');
    await time.press('ArrowDown');
    const list = page.getByRole('listbox', { name: 'Meeting time options', exact: true }); await list.waitFor();
    expect(await page.getByRole('option', { name: '5:46 PM', exact: true }).getAttribute('aria-selected')).toBe('true');
    await list.press('ArrowDown'); await list.press('Enter');
    await page.locator('[data-slot="time-picker-popover"]').waitFor({ state: 'detached' });
    expect(await changes(page)).toEqual([{ field: 'time', value: '18:00' }]);
    expect(await page.getByTestId('time-form').evaluate(element => new FormData(element as HTMLFormElement).get('meetingTime'))).toBe('18:00');
    await page.evaluate(() => (window as unknown as { __dateTimePickers: Fixture }).__dateTimePickers.configure({ format: '24h', step: 30 }));
    expect(await time.textContent()).toContain('18:00');
    expect(await page.getByTestId('time-form').evaluate(element => new FormData(element as HTMLFormElement).get('meetingTime'))).toBe('18:00');
  } finally { await page.close(); }
}, 30_000);

browserTest('read-only and disabled time fields never admit popup or clear edits; clearing is explicit', async () => {
  const page = await open();
  try {
    const time = page.getByRole('combobox', { name: 'Meeting time', exact: true });
    await time.click(); await page.getByRole('listbox', { name: 'Meeting time options', exact: true }).waitFor();
    await page.evaluate(() => (window as unknown as { __dateTimePickers: Fixture }).__dateTimePickers.configure({ disabled: true }));
    await page.locator('[data-slot="time-picker-popover"]').waitFor({ state: 'detached' });
    expect(await changes(page)).toEqual([]); expect(await time.isDisabled()).toBe(true);
    await page.evaluate(() => (window as unknown as { __dateTimePickers: Fixture }).__dateTimePickers.configure({ disabled: false }));
    await time.click(); await page.getByRole('listbox', { name: 'Meeting time options', exact: true }).waitFor();
    await page.locator('[data-slot="time-picker-footer"]').getByRole('button', { name: 'Clear', exact: true }).click();
    await page.locator('[data-slot="time-picker-popover"]').waitFor({ state: 'detached' });
    expect(await changes(page)).toEqual([{ field: 'time', value: '' }]);
  } finally { await page.close(); }
}, 30_000);

browserTest('mobile popup stays within viewport and rolling display follows theme motion with reduced-motion suppression', async () => {
  const page = await open(320);
  try {
    await trigger(page).click();
    const popup = page.locator('[data-slot="date-picker-popover"]'); await popup.waitFor();
    const box = await popup.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    await page.getByRole('button', { name: 'Close date picker', exact: true }).click(); await popup.waitFor({ state: 'detached' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => (window as unknown as { __dateTimePickers: Fixture }).__dateTimePickers.replaceDate());
    expect(await page.getByTestId('button-date').textContent()).toContain('Apr');
    expect(await page.getByTestId('button-date').evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
  } finally { await page.close(); }
}, 30_000);

browserTest('one-minute time choices are virtualized with a rendered active descendant and remain reachable in a short viewport', async () => {
  const page = await open(360);
  try {
    await page.setViewportSize({ width: 360, height: 380 });
    await page.evaluate(() => (window as unknown as { __dateTimePickers: Fixture }).__dateTimePickers.configure({ step: 1 }));
    await page.getByRole('combobox', { name: 'Meeting time', exact: true }).click();
    const list = page.getByRole('listbox', { name: 'Meeting time options', exact: true }); await list.waitFor();
    expect(await list.getByRole('option').count()).toBeLessThan(40);
    await list.getByRole('option', { name: '5:47 PM', exact: true }).waitFor();
    expect(await list.getByRole('option', { name: '5:47 PM', exact: true }).isVisible()).toBe(true);
    expect(await list.getByRole('option', { name: '12:00 AM', exact: true }).count()).toBe(0);
    await list.press('End');
    const end = await list.getAttribute('aria-activedescendant');
    expect(await page.locator(`[id="${end}"]`).getAttribute('aria-setsize')).toBe('1440');
    expect(await page.locator(`[id="${end}"]`).textContent()).toBe('11:59 PM');
    await page.evaluate(() => (window as unknown as { __dateTimePickers: Fixture }).__dateTimePickers.configure({ step: 30 }));
    await page.getByRole('option', { name: '5:46 PM', exact: true }).waitFor();
    expect(await changes(page)).toEqual([]);
    const footer = page.locator('[data-slot="time-picker-footer"]');
    const box = await footer.boundingBox(); expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(380);
    await footer.getByRole('button', { name: 'Close time picker', exact: true }).click();
    await page.locator('[data-slot="time-picker-popover"]').waitFor({ state: 'detached' });
  } finally { await page.close(); }
}, 30_000);

browserTest('display rollers consume inherited theme motion instead of a hard-coded animation preset', async () => {
  const page = await open();
  try {
    await page.addStyleTag({ content: ':root { --zero-calendar-motion-fast: 41ms; --zero-calendar-motion-spring: 1234ms; --zero-calendar-ease-spring: cubic-bezier(.2,0,0,1); }' });
    await page.evaluate(() => (window as unknown as { __dateTimePickers: Fixture }).__dateTimePickers.replaceDate());
    const timing = await page.getByTestId('button-date').evaluate(element => element.getAnimations({ subtree: true }).map(animation => ({
      duration: animation.effect?.getTiming().duration, easing: animation.effect?.getTiming().easing,
    })));
    expect(timing.some(item => item.duration === 1234 && item.easing === 'cubic-bezier(0.2, 0, 0, 1)')).toBe(true);
    expect(timing.some(item => item.duration === 101)).toBe(true);
  } finally { await page.close(); }
}, 30_000);

browserTest('short landscape date popup pins its footer and has one scroll owner in each calendar view', async () => {
  const page = await open(360);
  try {
    await page.setViewportSize({ width: 360, height: 320 });
    await trigger(page).click();
    const popup = page.locator('[data-slot="date-picker-popover"]'); await popup.waitFor();
    const check = async () => {
      const footer = page.locator('[data-slot="date-picker-footer"]');
      const box = await footer.boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(320);
      const scrolling = await popup.evaluate(element => Array.from(element.querySelectorAll<HTMLElement>('*')).filter(child => {
        const overflow = getComputedStyle(child).overflowY;
        return ['auto', 'scroll'].includes(overflow) && child.scrollHeight > child.clientHeight + 1;
      }).map(child => child.dataset.slot));
      if (scrolling.length !== 1) {
        const layout = await popup.evaluate(element => Array.from(element.querySelectorAll<HTMLElement>(
          '[data-slot="date-picker-calendar-viewport"],[data-slot="calendar"],[data-slot="calendar-stage"],[data-slot="calendar-year-grid"],[data-calendar-view]',
        )).map(child => ({ slot: child.dataset.slot, view: child.dataset.calendarView, height: child.clientHeight,
          scroll: child.scrollHeight, overflow: getComputedStyle(child).overflowY, cssHeight: getComputedStyle(child).height })));
        throw new Error(`Expected one calendar scroll owner: ${JSON.stringify(layout)}`);
      }
      expect(scrolling).toHaveLength(1);
      return scrolling[0];
    };
    expect(await check()).toBe('date-picker-calendar-viewport');
    await page.getByRole('button', { name: 'February, choose month', exact: true }).click();
    await page.getByRole('grid', { name: 'Months in 2026', exact: true }).waitFor();
    expect(await check()).toBe('date-picker-calendar-viewport');
    await page.getByRole('button', { name: '2026, choose year', exact: true }).click();
    await page.getByRole('grid', { name: 'Years', exact: true }).waitFor();
    expect(await check()).toBe('calendar-year-grid');
    await page.getByRole('button', { name: '2026', exact: true }).press('End');
    await page.getByRole('button', { name: '2030', exact: true }).press('Enter');
    await page.getByRole('button', { name: '2030, choose year', exact: true }).waitFor();
    expect(await check()).toBe('date-picker-calendar-viewport');
    await page.getByRole('button', { name: 'Close date picker', exact: true }).click();
    await popup.waitFor({ state: 'detached' }); expect(await changes(page)).toEqual([]);
  } finally { await page.close(); }
}, 30_000);
