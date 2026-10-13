import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import type { Page } from 'playwright';
import { renderThemeFoundationCss } from '../../../design-system/theme-css';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, script = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const built = await Bun.build({ entrypoints: [`${import.meta.dir}/select-morph.browser-fixture.tsx`], target: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
  if (!built.success) throw new Error(built.logs.map(log => log.message).join('\n'));
  script = await built.outputs.find(output => output.path.endsWith('.js'))!.text();
  const require = createRequire(import.meta.url), { compile } = require('@tailwindcss/node') as typeof import('@tailwindcss/node');
  const url = new URL('../../../frontend/styles/globals.css', import.meta.url);
  const compiler = await compile(await Bun.file(url).text(), { base: new URL('../../../frontend/styles/', import.meta.url).pathname,
    from: url.pathname, onDependency() {} });
  const candidates = (await Promise.all(['select.tsx', 'select-morph.browser-fixture.tsx'].map(file => Bun.file(`${import.meta.dir}/${file}`).text())))
    .join('\n').match(/[^\s"'`]+/gu) ?? [];
  css = compiler.build(candidates) + '\n' + renderThemeFoundationCss();
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

async function mount(reduced = false): Promise<Page> {
  const page = await lease!.browser.newPage({ viewport: { width: 850, height: 650 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  page.setDefaultTimeout(7000);
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await page.getByTestId('trigger').waitFor();
  return page;
}
async function open(page: Page) {
  await page.getByTestId('trigger').press('ArrowDown');
  await page.getByTestId('content').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="content"]')?.getAttribute('data-zero-select-motion') === 'settled');
}

for (const mode of ['light', 'dark']) browserTest(`resting Select shares the expanded material in ${mode} mode without a strong input border`, async () => {
  const page = await mount();
  try {
    await page.locator('main').evaluate((element, mode) => element.setAttribute('data-zero-mode', mode), mode);
    await page.getByTestId('elsewhere').focus();
    await page.waitForFunction(() => !document.querySelector('[data-testid="trigger"]')!.getAnimations().length);
    const resting = await page.getByTestId('trigger').evaluate(element => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, foreground: style.color, border: style.borderColor, width: style.borderTopWidth,
        radius: parseFloat(style.borderTopLeftRadius), height: element.getBoundingClientRect().height };
    });
    await open(page);
    const expanded = await page.getByTestId('content').evaluate(element => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, foreground: style.color, border: style.borderColor };
    });
    expect(resting.background).toBe(expanded.background);
    expect(resting.foreground).toBe(expanded.foreground);
    expect(resting.border).toBe(expanded.border);
    expect(resting.width).toBe('1px');
    expect(resting.radius).toBeGreaterThanOrEqual(resting.height / 2);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-zero-select-paint]'));
    expect(await page.getByTestId('trigger').evaluate(element => element.matches(':focus-visible'))).toBe(true);
    expect(await page.getByTestId('trigger').evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
    // Compact input geometry elsewhere remains a different role, not a global rounding change.
    expect(await page.locator('main').evaluate(element => getComputedStyle(element).getPropertyValue('--zero-theme-radius-control').trim())).toBe('.375rem');
  } finally { await page.close(); }
}, 30_000);

for (const selectItem of [false, true]) browserTest(`${selectItem ? 'picked-value return' : 'dismissal'} removes closing paint as soon as it visually lands, without retuning the shrink`, async () => {
  const page = await mount();
  try {
    await open(page);
    if (selectItem) await page.keyboard.press('End');
    await page.evaluate(() => {
      type Sample = { at: number; surface: boolean; surfaceError: number; label: boolean; labelError: number; nativeOpacity: string };
      const run = { samples: [] as Sample[], seen: false, after: 0, raf: 0 };
      Object.assign(window, { __handoff: run });
      const sample = () => {
        const ghost = document.querySelector<HTMLElement>('[data-zero-select-paint="exit"]');
        const label = document.querySelector<HTMLElement>('[data-zero-select-paint="label"]');
        const trigger = document.querySelector<HTMLElement>('[data-testid="trigger"]')!;
        const native = trigger.querySelector<HTMLElement>('[data-slot="select-value"]')!;
        let surfaceError = Infinity, labelError = Infinity;
        if (ghost) {
          const clip = ghost.style.clipPath.match(/[-\d.]+(?=px)/g)?.map(Number);
          if (clip?.length === 5) {
            const g = ghost.getBoundingClientRect(), t = trigger.getBoundingClientRect(), sx = g.width / ghost.offsetWidth, sy = g.height / ghost.offsetHeight;
            surfaceError = Math.max(Math.abs(g.left + clip[3]! * sx - t.left), Math.abs(g.right - clip[1]! * sx - t.right),
              Math.abs(g.top + clip[0]! * sy - t.top), Math.abs(g.bottom - clip[2]! * sy - t.bottom));
          }
          run.seen = true;
        }
        if (label) {
          const a = label.getBoundingClientRect(), b = native.getBoundingClientRect();
          labelError = Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top));
        }
        run.samples.push({ at: performance.now(), surface: !!ghost, surfaceError, label: !!label, labelError, nativeOpacity: native.style.opacity });
        if (run.seen && !ghost && !label) run.after++;
        if (run.after < 3) run.raf = requestAnimationFrame(sample);
      };
      run.raf = requestAnimationFrame(sample);
    });
    await page.keyboard.press(selectItem ? 'Enter' : 'Escape');
    await page.waitForFunction(() => (window as any).__handoff.after >= 3);
    const frames = await page.evaluate(() => (window as any).__handoff.samples as {
      at: number; surface: boolean; surfaceError: number; label: boolean; labelError: number; nativeOpacity: string;
    }[]);
    const landed = frames.find(frame => frame.surface && frame.surfaceError <= .75);
    const removed = landed && frames.find(frame => frame.at > landed.at && !frame.surface);
    expect(landed).toBeDefined(); expect(removed).toBeDefined();
    expect(removed!.at - landed!.at).toBeLessThan(70);
    if (selectItem) {
      const labelLanded = frames.find(frame => frame.label && frame.labelError <= .75);
      const labelRemoved = labelLanded && frames.find(frame => frame.at > labelLanded.at && !frame.label);
      expect(labelLanded).toBeDefined(); expect(labelRemoved).toBeDefined();
      expect(labelRemoved!.at - labelLanded!.at).toBeLessThan(70);
    }
    expect(frames.at(-1)!.nativeOpacity).toBe('');
  } finally { await page.close(); }
}, 30_000);

browserTest('compiled Morph Select owns real shape/timings while keeping native title, refs, typeahead and form semantics', async () => {
  const page = await mount();
  try {
    await page.getByTestId('trigger').press('ArrowDown');
    await page.getByTestId('content').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="content"]')?.getAttribute('data-zero-select-motion') === 'opening');
    const opening = await page.getByTestId('content').evaluate(element => {
      const style = getComputedStyle(element);
      return { clip: style.clipPath, radius: style.borderRadius, grow: style.getPropertyValue('--zero-select-motion-grow').trim(),
        shrink: style.getPropertyValue('--zero-select-motion-shrink').trim(), glide: style.getPropertyValue('--zero-select-motion-glide').trim(),
        height: element.getBoundingClientRect().height, wrappers: document.querySelectorAll('[data-radix-select-viewport]').length,
        wrapperTransform: getComputedStyle(element.parentElement!).transform };
    });
    expect(opening.clip).toStartWith('inset('); expect(opening.radius).toBe('22px');
    expect(opening).toMatchObject({ grow: '400ms', shrink: '340ms', glide: '280ms', wrappers: 1 });
    expect(opening.height).toBeGreaterThan(100); // inherited parent --radix-* cannot clamp the child to 1px
    expect(opening.wrapperTransform).not.toContain('scale');
    await page.waitForFunction(() => document.querySelector('[data-testid="content"]')?.getAttribute('data-zero-select-motion') === 'settled');
    expect(await page.getByTestId('item-0').getAttribute('aria-describedby')).toBeTruthy();
    expect(await page.getByTestId('item-0').getAttribute('aria-label')).toBeNull();
    await page.keyboard.press('End'); await page.waitForFunction(() => document.activeElement?.id === 'item-23');
    const scrollBeforeClose = await page.locator('[data-radix-select-viewport]').evaluate(element => element.scrollTop);
    await page.keyboard.press('Enter');
    await page.getByTestId('content').waitFor({ state: 'detached' });
    expect(await page.getByTestId('trigger').textContent()).toBe('Tool 23'); // metadata/description never leaks into the Value
    expect(await page.getByTestId('form').evaluate(element => new FormData(element as HTMLFormElement).get('choice'))).toBe('item-23');
    expect(await page.getByTestId('trigger').evaluate(element => document.activeElement === element)).toBe(true);
    await page.waitForFunction(() => document.querySelector('[data-zero-select-paint="exit"]'));
    expect(await page.locator('[data-zero-select-paint="exit"]').evaluate(element => ({ inert: (element as HTMLElement).inert, aria: element.getAttribute('aria-hidden'),
      forbidden: element.querySelectorAll('[id],[name],[role],[tabindex],[data-testid],input,select,textarea,button,form').length }))).toEqual({ inert: true, aria: 'true', forbidden: 0 });
    expect(await page.locator('[data-zero-select-paint="exit"] .zero-select-viewport').evaluate(element => element.scrollTop)).toBeCloseTo(scrollBeforeClose, 1);
    expect(await page.evaluate(() => (window as any).__morphSelect.registered())).toBe(false);
    await page.waitForFunction(() => document.querySelector('[data-zero-select-paint="label"]'));
    await page.waitForFunction(() => !document.querySelector('[data-zero-select-paint]'));
    const refs = await page.evaluate(() => (window as any).__morphSelect.refs());
    expect(refs).toMatchObject({ trigger: true, content: false });
    expect(refs.contentMounts).toBe(refs.contentCleanups); // native Radix may recompose callback refs; every React 19 cleanup still runs once
  } finally { await page.close(); }
}, 30_000);

browserTest('scaled owner portals retain local magnetic geometry and inert departure matches the trigger', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => (window as any).__morphSelect.scale(.8));
    await open(page); await page.getByTestId('item-4').hover();
    await page.waitForFunction(() => {
      const item = document.querySelector('#item-4'), paint = document.querySelector('.zero-select-highlight');
      if (!item || !paint || document.activeElement !== item) return false;
      const a = item.getBoundingClientRect(), b = paint.getBoundingClientRect();
      return Math.abs(a.left - b.left) < .3 && Math.abs(a.top - b.top) < .3 && Math.abs(a.width - b.width) < .3 && Math.abs(a.height - b.height) < .3;
    });
    await page.keyboard.press('Escape');
    const paint = page.locator('[data-zero-select-paint="exit"]'); await paint.waitFor();
    expect(await paint.evaluate(element => element.parentElement?.getAttribute('data-testid'))).toBe('portal');
    try { await page.waitForFunction(() => {
      const ghost = document.querySelector('[data-zero-select-paint="exit"]') as HTMLElement;
      const trigger = document.querySelector('[data-testid="trigger"]') as HTMLElement;
      if (!ghost || !trigger) return false;
      const numbers = ghost.style.clipPath.match(/[-\d.]+(?=px)/g)?.map(Number);
      if (!numbers || numbers.length < 4) return false;
      const g = ghost.getBoundingClientRect(), t = trigger.getBoundingClientRect(), sx = g.width / ghost.offsetWidth, sy = g.height / ghost.offsetHeight;
      (window as any).__paintDebug = { ghost: g.toJSON(), trigger: t.toJSON(), sx, sy, clip: ghost.style.clipPath, numbers };
      return Math.abs(g.left + numbers[3]! * sx - t.left) < 1.2 && Math.abs(g.top + numbers[0]! * sy - t.top) < 1.2
        && Math.abs(g.width - (numbers[1]! + numbers[3]!) * sx - t.width) < 1.2;
    }); } catch (error) { throw new Error(`Scaled paint geometry: ${JSON.stringify(await page.evaluate(() => (window as any).__paintDebug))}`, { cause: error }); }
    await page.waitForFunction(() => !document.querySelector('[data-zero-select-paint]'));
  } finally { await page.close(); }
}, 30_000);

browserTest('pointer and keyboard share a gliding material, disabled rows are skipped and native scrolling keeps exact bounds', async () => {
  const page = await mount();
  try {
    await open(page);
    const highlight = page.locator('.zero-select-highlight'); await highlight.waitFor();
    await page.getByTestId('item-1').hover();
    await page.waitForFunction(() => document.activeElement?.id === 'item-1');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.activeElement?.id === 'item-3');
    await page.keyboard.press('End');
    await page.waitForFunction(() => {
      const active = document.activeElement as HTMLElement, paint = document.querySelector('.zero-select-highlight') as HTMLElement;
      if (active?.id !== 'item-23' || !paint) return false;
      const a = active.getBoundingClientRect(), b = paint.getBoundingClientRect();
      return Math.abs(a.top - b.top) < .3 && Math.abs(a.left - b.left) < .3 && Math.abs(a.width - b.width) < .3;
    });
    expect(await page.locator('[data-radix-select-viewport]').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.locator('[data-radix-select-viewport]').evaluate(element => getComputedStyle(element).maskImage)).toContain('linear-gradient');
    expect(await page.locator('.zero-scroll-track[data-axis="y"]').count()).toBe(1);
    await page.getByTestId('content').evaluate(element => { (element as HTMLElement).style.width = '235px'; });
    await page.waitForFunction(() => {
      const active = document.activeElement, paint = document.querySelector('.zero-select-highlight');
      return !!active && !!paint && Math.abs(active.getBoundingClientRect().left - paint.getBoundingClientRect().left) < .3
        && Math.abs(active.getBoundingClientRect().width - paint.getBoundingClientRect().width) < .3;
    });
    // Window resize intentionally closes native Radix Select; do not replace that dismissal policy.
    await page.setViewportSize({ width: 500, height: 650 }); await page.getByTestId('content').waitFor({ state: 'detached' });
  } finally { await page.close(); }
}, 30_000);

browserTest('rapid close/reopen, owner inactivity and root unmount leave no ghost overlay or duplicate form/IDs', async () => {
  const page = await mount();
  try {
    await open(page); await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('[data-zero-select-paint="exit"]'));
    await page.getByTestId('trigger').press('ArrowDown'); await page.getByTestId('content').waitFor();
    expect(await page.locator('[data-zero-select-paint]').count()).toBe(0);
    expect(await page.locator('[role="listbox"]').count()).toBe(1);
    expect(await page.locator('#item-0').count()).toBe(1);
    await page.waitForFunction(() => document.querySelector('[data-testid="content"]')?.getAttribute('data-zero-select-motion') === 'settled');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => document.querySelector('[data-zero-select-paint="exit"]'));
    await page.evaluate(() => (window as any).__morphSelect.active(false));
    await page.waitForFunction(() => !document.querySelector('[data-zero-select-paint]'));
    expect(await page.evaluate(() => (window as any).__morphSelect.registered())).toBe(false);
    await page.evaluate(() => { (window as any).__morphSelect.active(true); (window as any).__morphSelect.open(true); });
    await page.getByTestId('content').waitFor();
    await page.evaluate(() => (window as any).__morphSelect.mounted(false));
    await page.getByTestId('content').waitFor({ state: 'detached' });
    expect(await page.locator('[data-zero-select-paint]').count()).toBe(0);
    expect(await page.evaluate(() => (window as any).__morphSelect.registered())).toBe(false);
  } finally { await page.close(); }
}, 30_000);

browserTest('collision flip and native item-aligned positioning remain usable; reduced motion snaps without departing paint', async () => {
  const page = await mount(true);
  try {
    await page.evaluate(() => (window as any).__morphSelect.bottom(true)); await open(page);
    expect(await page.getByTestId('content').getAttribute('data-side')).toBe('top');
    expect(await page.getByTestId('content').evaluate(element => getComputedStyle(element).clipPath)).toBe('none');
    await page.keyboard.press('Escape'); expect(await page.locator('[data-zero-select-paint]').count()).toBe(0);
    await page.evaluate(() => { (window as any).__morphSelect.bottom(false); (window as any).__morphSelect.position('item-aligned'); });
    await open(page);
    expect(await page.locator('.zero-select-lid').count()).toBe(0);
    await page.keyboard.press('End'); await page.waitForFunction(() => document.activeElement?.id === 'item-23'); await page.keyboard.press('Enter');
    expect(await page.getByTestId('form').evaluate(element => new FormData(element as HTMLFormElement).get('choice'))).toBe('item-23');
    await page.evaluate(() => (window as any).__morphSelect.disabled(true));
    expect(await page.getByTestId('trigger').isDisabled()).toBe(true);
    expect(await page.getByTestId('form').evaluate(element => new FormData(element as HTMLFormElement).get('choice'))).toBeNull();
    await page.getByTestId('native-trigger').press('ArrowDown'); await page.getByTestId('native-content').waitFor();
    await page.keyboard.press('b'); await page.waitForFunction(() => document.activeElement?.textContent === 'Beta'); await page.keyboard.press('Enter');
    expect(await page.getByTestId('native-form').evaluate(element => new FormData(element as HTMLFormElement).get('native'))).toBe('b');
  } finally { await page.close(); }
}, 30_000);

browserTest('required validation and RTL rich rows preserve native contracts and custom timing is admitted per menu', async () => {
  const page = await mount(true);
  try {
    expect(await page.getByTestId('required-form').evaluate(element => (element as HTMLFormElement).checkValidity())).toBe(false);
    await page.getByTestId('required-trigger').press('ArrowDown');
    await page.getByTestId('required-content').waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'option');
    await page.keyboard.press('Enter');
    await page.getByTestId('required-content').waitFor({ state: 'detached' });
    expect(await page.getByTestId('required-form').evaluate(element => (element as HTMLFormElement).checkValidity())).toBe(true);
    expect(await page.getByTestId('required-form').evaluate(element => new FormData(element as HTMLFormElement).get('required'))).toBe('a');
    await page.evaluate(() => (window as any).__morphSelect.rtl(true)); await open(page);
    expect(await page.getByTestId('content').getAttribute('dir')).toBe('rtl');
    const sides = await page.getByTestId('item-0').evaluate(element => {
      const icon = element.querySelector('.zero-select-item-leading')!.getBoundingClientRect(), check = element.querySelector('.zero-select-item-check')!.getBoundingClientRect();
      return { icon: icon.left, check: check.left };
    });
    expect(sides.icon).toBeGreaterThan(sides.check);
    await page.getByTestId('content').evaluate(element => { (element as HTMLElement).style.setProperty('--zero-select-motion-glide', '80ms'); });
    await page.keyboard.press('ArrowDown'); await page.waitForFunction(() => document.activeElement?.id === 'item-1');
    await page.waitForFunction(() => {
      const item = document.querySelector('#item-1')!, paint = document.querySelector('.zero-select-highlight')!;
      return Math.abs(item.getBoundingClientRect().top - paint.getBoundingClientRect().top) < .3;
    });
    expect(await page.getByTestId('content').evaluate(element => getComputedStyle(element).getPropertyValue('--zero-select-motion-glide').trim())).toBe('80ms');
  } finally { await page.close(); }
}, 30_000);
