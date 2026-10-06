/** Styled production controls on a disposable Bun/Elysia origin; never a real app or data store. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import type { Locator, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const TIMEOUT = 45_000;
const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const ARTIFACTS = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/button-group-context-menu';
let lease: PlaywrightTestBrowserLease | undefined, directory: string | undefined, evidence: string | undefined;
let app: ReturnType<typeof serveFixture> | undefined, baseUrl = '';

function serveFixture(scriptPath: string, cssPath: string) {
  return new Elysia()
    .get('/fixture.js', () => new Response(Bun.file(scriptPath), { headers: { 'Content-Type': 'text/javascript' } }))
    .get('/fixture.css', () => new Response(Bun.file(cssPath), { headers: { 'Content-Type': 'text/css' } }))
    .get('/', ({ query }) => new Response(`<!doctype html><html${query.dark === '1' ? ' class="dark"' : ''}><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Isolated grouped controls</title><link rel="stylesheet" href="/fixture.css"></head>
      <body><div id="root"></div><script src="/fixture.js"></script></body></html>`, { headers: { 'Content-Type': 'text/html' } }))
    .listen({ hostname: '127.0.0.1', port: 0 });
}

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) throw new Error('Grouped controls require the installed isolated Chromium fixture browser.');
  lease = await acquirePlaywrightTestBrowser();
  await mkdir(SCRATCH, { recursive: true }); await mkdir(ARTIFACTS, { recursive: true });
  directory = await mkdtemp(join(SCRATCH, 'grouped-controls-')); evidence = await mkdtemp(join(ARTIFACTS, 'acceptance-'));
  const build = Bun.spawn({ cmd: [process.execPath, '--no-env-file', 'build',
    join(import.meta.dir, 'button-group-context-menu.browser-fixture.tsx'), '--target=browser', '--format=iife',
    `--outfile=${join(directory, 'fixture.js')}`], cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, status] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
  if (status !== 0) throw new Error(`Grouped controls fixture compilation failed.\n${stdout}\n${stderr}`);
  const css = await buildPlatformStyles(directory, join(directory, 'missing-app'));
  app = serveFixture(join(directory, 'fixture.js'), css.cssPath);
  baseUrl = `http://127.0.0.1:${app.server!.port}`;
}, TIMEOUT);
afterAll(async () => {
  try { await app?.stop(true); if (directory) await rm(directory, { recursive: true, force: true }); }
  finally { lease?.release(); }
}, TIMEOUT);

async function open(width = 1280, dark = false, touch = false): Promise<Page> {
  if (!lease) throw new Error('Isolated grouped controls fixture was not initialized.');
  const page = await lease.browser.newPage({ viewport: { width, height: 1000 }, hasTouch: touch });
  page.setDefaultTimeout(4_000);
  await page.goto(`${baseUrl}/${dark ? '?dark=1' : ''}`);
  await page.getByTestId('fixture-ready').waitFor();
  return page;
}
function menu(page: Page): Locator { return page.getByTestId('record-menu'); }
async function rightClick(page: Page, target = page.getByTestId('record-target')) {
  await target.click({ button: 'right' }); await menu(page).waitFor(); await waitMenuFocused(menu(page));
}
async function selected(page: Page) { return JSON.parse(await page.getByTestId('selection').innerText()) as { single: string; multiple: string[] }; }
async function actions(page: Page) { return JSON.parse(await page.getByTestId('menu-actions').innerText()) as string[]; }
async function waitClosed(page: Page, target = menu(page)) { await target.waitFor({ state: 'detached' }); }
async function waitFocused(target: Locator) {
  await target.evaluate(element => new Promise<void>((resolve, reject) => {
    let frames = 0;
    const check = () => {
      if (element === document.activeElement) resolve();
      else if (++frames > 120) reject(new Error(`Focus did not return to ${element.getAttribute('aria-label') ?? element.textContent}.`));
      else requestAnimationFrame(check);
    };
    check();
  }));
}
async function waitMenuFocused(target: Locator) {
  await target.evaluate(element => new Promise<void>((resolve, reject) => {
    let frames = 0;
    const check = () => {
      if (element.contains(document.activeElement)) resolve();
      else if (++frames > 120) reject(new Error('The opened menu did not take keyboard focus.'));
      else requestAnimationFrame(check);
    };
    check();
  }));
}
async function waitMenuSettled(target: Locator) {
  await target.evaluate(element => new Promise<void>((resolve, reject) => {
    let frames = 0;
    const check = () => {
      const style = getComputedStyle(element);
      if (Number(style.opacity) >= 0.99999 && (style.transform === 'none' || new DOMMatrixReadOnly(style.transform).a >= 0.99999)) resolve();
      else if (++frames > 120) reject(new Error(`Menu entrance animation did not settle: opacity=${style.opacity}; transform=${style.transform}; state=${element.getAttribute('data-state')}.`));
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }));
}

describe('ButtonGroup browser composition', () => {
  test('joins real Buttons horizontally and vertically, including nested groups and split input addons', async () => {
    const page = await open(); try {
      const geometry = await page.evaluate(() => {
        const bounds = (selector: string) => [...document.querySelectorAll(selector)].map(element => {
          const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
          return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, height: rect.height,
            leftRadius: style.borderTopLeftRadius, rightRadius: style.borderTopRightRadius };
        });
        return { horizontal: bounds('[data-testid="joined-horizontal"] > button'),
          vertical: bounds('[data-testid="joined-vertical"] > button'),
          input: bounds('[data-testid="input-group"] input, [data-testid="input-group"] button'),
          rtl: bounds('[data-testid="rtl-group"] > button'),
          select: bounds('[data-testid="select-group"] > button'),
          separator: getComputedStyle(document.querySelector('[data-testid="nested-group"] [data-slot="button-group-separator"]')!).width };
      });
      expect(geometry.horizontal).toHaveLength(3);
      expect(Math.abs(geometry.horizontal[1]!.x - geometry.horizontal[0]!.right)).toBeLessThanOrEqual(1.1);
      expect(geometry.horizontal[1]!.leftRadius).toBe('0px'); expect(geometry.horizontal[1]!.rightRadius).toBe('0px');
      expect(geometry.vertical).toHaveLength(3);
      expect(Math.abs(geometry.vertical[1]!.y - geometry.vertical[0]!.bottom)).toBeLessThanOrEqual(1.1);
      expect(geometry.vertical.every(item => item.x === geometry.vertical[0]!.x)).toBe(true);
      expect(geometry.input).toHaveLength(2); expect(geometry.input[0]!.height).toBe(geometry.input[1]!.height);
      expect(geometry.rtl[0]!.x).toBeGreaterThan(geometry.rtl[2]!.x);
      expect(geometry.rtl[0]!.leftRadius).toBe('0px'); expect(Number.parseFloat(geometry.rtl[0]!.rightRadius)).toBeGreaterThan(0);
      expect(geometry.rtl[2]!.rightRadius).toBe('0px'); expect(Number.parseFloat(geometry.rtl[2]!.leftRadius)).toBeGreaterThan(0);
      expect(geometry.select).toHaveLength(2); expect(geometry.select[0]!.height).toBe(geometry.select[1]!.height);
      expect(Number.parseFloat(geometry.separator)).toBeLessThanOrEqual(1.1);
      await page.getByRole('textbox', { name: 'Website hostname', exact: true }).fill('new.example');
      expect(await page.getByRole('textbox', { name: 'Website hostname', exact: true }).inputValue()).toBe('new.example');
      await page.getByRole('button', { name: 'Publishing options', exact: true }).click();
      expect(await page.getByRole('menuitem', { name: 'Publish later', exact: true }).isVisible()).toBe(true);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('single and multiple selection retain native Radix keyboard and disabled semantics', async () => {
    const page = await open(); try {
      const single = page.getByTestId('single-toggle');
      await single.getByRole('radio', { name: 'List', exact: true }).focus(); await page.keyboard.press('ArrowRight');
      await waitFocused(single.getByRole('radio', { name: 'Grid', exact: true }));
      expect(await single.getByRole('radio', { name: 'Grid', exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
      await page.keyboard.press('Space'); expect((await selected(page)).single).toBe('grid');
      await page.keyboard.press('ArrowRight'); await waitFocused(single.getByRole('radio', { name: 'List', exact: true }));
      expect(await single.getByRole('radio', { name: 'List', exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
      expect(await single.getByRole('radio', { name: 'Table', exact: true }).isDisabled()).toBe(true);
      const multiple = page.getByTestId('multiple-toggle');
      await multiple.getByRole('button', { name: 'Bold', exact: true }).focus(); await page.keyboard.press('Space');
      await page.keyboard.press('ArrowRight'); await waitFocused(multiple.getByRole('button', { name: 'Italic', exact: true }));
      await page.keyboard.press('Space'); expect((await selected(page)).multiple).toEqual(['bold', 'italic']);
      expect(await multiple.getByRole('button', { name: 'Underline', exact: true }).isDisabled()).toBe(true);
      const vertical = page.getByTestId('vertical-toggle');
      await vertical.getByRole('radio', { name: 'Top', exact: true }).focus(); await page.keyboard.press('ArrowDown');
      await waitFocused(vertical.getByRole('radio', { name: 'Middle', exact: true }));
      expect(await vertical.getByRole('radio', { name: 'Middle', exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
      expect(await page.getByRole('button', { name: 'Disabled save', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByRole('button', { name: 'Disabled archive', exact: true }).isDisabled()).toBe(true);
    } finally { await page.close(); }
  }, TIMEOUT);
});

describe('ContextMenu browser behavior', () => {
  test('forwarded surface ref follows DOM replaced by the asChild consumer itself', async () => {
    const page = await open(); try {
      await page.getByTestId('owned-surface-target').focus(); await page.keyboard.press('Shift+F10');
      const content = page.getByTestId('owned-surface-menu'); await content.waitFor(); await waitMenuFocused(content); await waitMenuSettled(content);
      await page.evaluate(() => window.__ownedSurfaceProbe!.replace());
      await page.waitForFunction(() => document.querySelector('[data-testid="owned-surface-menu"]')?.tagName === 'ARTICLE');
      const refs = await page.evaluate(() => {
        const actual = document.querySelector('[data-testid="owned-surface-menu"]');
        const forwarded = window.__groupedSurfaceProbe!.ref('owned');
        return { exact: actual === forwarded, child: actual === window.__ownedSurfaceProbe!.child(), connected: forwarded?.isConnected };
      });
      expect(refs.child).toBe(true); expect(refs.connected).toBe(true); expect(refs.exact).toBe(true);
      expect(await content.isVisible()).toBe(true);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('retained asChild surface refs follow a changed DOM element while the menu stays open', async () => {
    const page = await open(); try {
      await page.getByTestId('slotted-surface-target').focus(); await page.keyboard.press('Shift+F10');
      const content = page.getByTestId('slotted-surface-menu'); await content.waitFor(); await waitMenuFocused(content);
      await page.evaluate(() => {
        const before = window.__groupedSurfaceProbe!.ref('slotted')!;
        before.setAttribute('data-old-surface', 'true');
        window.__groupedSurfaceProbe!.replaceChild();
      });
      await page.waitForFunction(() => document.querySelector('[data-testid="slotted-surface-menu"]')?.tagName === 'ARTICLE');
      const refs = await page.evaluate(() => {
        const actual = document.querySelector('[data-testid="slotted-surface-menu"]');
        const forwarded = window.__groupedSurfaceProbe!.ref('slotted');
        return { tag: actual?.tagName, exact: forwarded === actual, child: window.__groupedSurfaceProbe!.child() === actual,
          connected: forwarded?.isConnected, oldGone: !document.querySelector('[data-old-surface="true"]') };
      });
      expect(refs.tag).toBe('ARTICLE'); expect(refs.child).toBe(true); expect(refs.oldGone).toBe(true);
      expect(refs.connected).toBe(true); expect(refs.exact).toBe(true);
      expect(await content.isVisible()).toBe(true);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('React 19 callback refs retain replacement identity and execute their returned cleanup', async () => {
    const page = await open(); try {
      await page.evaluate(() => window.__groupedSurfaceProbe!.useCallbackRefs());
      await page.waitForFunction(() => document.querySelector('[data-testid="surface-probe"]')?.getAttribute('data-ref-mode') === 'callback');
      await page.getByTestId('slotted-surface-target').focus(); await page.keyboard.press('Shift+F10');
      const content = page.getByTestId('slotted-surface-menu'); await content.waitFor(); await waitMenuFocused(content);
      await page.evaluate(() => window.__groupedSurfaceProbe!.replaceChild());
      await page.waitForFunction(() => document.querySelector('[data-testid="slotted-surface-menu"]')?.tagName === 'ARTICLE');
      const replaced = await page.evaluate(() => {
        const actual = document.querySelector('[data-testid="slotted-surface-menu"]');
        return { exact: window.__groupedSurfaceProbe!.ref('slotted') === actual,
          child: window.__groupedSurfaceProbe!.child() === actual, refs: window.__groupedSurfaceProbe!.refEvents() };
      });
      expect(replaced.exact).toBe(true); expect(replaced.child).toBe(true);
      for (const owner of ['public', 'child'] as const) {
        expect(replaced.refs.some(event => event.owner === owner && event.phase === 'cleanup' && event.tag === 'SECTION')).toBe(true);
        expect(replaced.refs.some(event => event.owner === owner && event.phase === 'attach' && event.tag === 'ARTICLE')).toBe(true);
      }
      await page.keyboard.press('Escape'); await content.waitFor({ state: 'detached' });
      await page.waitForFunction(() => window.__groupedSurfaceProbe!.ref('slotted') === null && window.__groupedSurfaceProbe!.child() === null);
      const retired = await page.evaluate(() => window.__groupedSurfaceProbe!.refEvents());
      for (const owner of ['public', 'child'] as const) {
        expect(retired.filter(event => event.owner === owner && event.phase === 'attach').length)
          .toBe(retired.filter(event => event.owner === owner && event.phase === 'cleanup').length);
      }
    } finally { await page.close(); }
  }, TIMEOUT);

  test('content retains native animation/drag events, exact DOM refs, asChild semantics and custom inline styles', async () => {
    const page = await open(); try {
      for (const [surface, prefix] of [['native', 'native'], ['slotted', 'slotted']] as const) {
        await page.getByTestId(`${prefix}-surface-target`).focus(); await page.keyboard.press('Shift+F10');
        const content = page.getByTestId(`${prefix}-surface-menu`);
        await content.waitFor(); await waitMenuFocused(content);
        if (surface === 'native') await waitMenuSettled(content);
        else await content.evaluate(element => new Promise<void>((resolve, reject) => {
          let frames = 0;
          const check = () => {
            if ((element as HTMLElement).style.opacity === '0.65' && (element as HTMLElement).style.transform === 'translateX(2px)') resolve();
            else if (++frames > 120) reject(new Error('Consumer inline styles were not restored after menu entrance.'));
            else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        }));
        const ref = await page.evaluate(surface => {
          const element = window.__groupedSurfaceProbe!.ref(surface);
          return { attached: element?.isConnected, exact: element === document.querySelector(`[data-testid="${surface}-surface-menu"]`),
            tag: element?.tagName, child: surface === 'slotted' ? element === window.__groupedSurfaceProbe!.child() : true };
        }, surface);
        expect(ref.attached).toBe(true); expect(ref.exact).toBe(true); expect(ref.child).toBe(true);
        expect(ref.tag).toBe(surface === 'native' ? 'DIV' : 'SECTION');
        expect(await content.getAttribute('data-consumer')).toBe('retained');
        if (surface === 'slotted') expect(await content.getAttribute('data-child')).toBe('retained');
        await content.evaluate(element => {
          element.dispatchEvent(new AnimationEvent('animationstart', { bubbles: true, animationName: 'synthetic-native-event' }));
          element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() }));
        });
        expect(await page.evaluate(surface => window.__groupedSurfaceProbe!.events().filter(event => event.surface === surface), surface)).toEqual([
          { surface, kind: 'animation', native: true, target: true }, { surface, kind: 'drag', native: true, target: true },
        ]);
        await page.keyboard.press('Escape'); await content.waitFor({ state: 'detached' });
        await page.waitForFunction(surface => window.__groupedSurfaceProbe!.ref(surface) === null, surface);
        if (surface === 'slotted') expect(await page.evaluate(() => window.__groupedSurfaceProbe!.child())).toBeNull();
      }
    } finally { await page.close(); }
  }, TIMEOUT);

  test('native right-click, Shift+F10 and ContextMenu key open the same menu and Escape restores target focus', async () => {
    const page = await open(); try {
      await rightClick(page); expect(await menu(page).getByRole('menuitem', { name: 'Copy record ⌘C', exact: true }).isVisible()).toBe(true);
      await page.keyboard.press('Escape'); await waitClosed(page);
      await waitFocused(page.getByTestId('record-target'));
      expect(await page.getByTestId('record-target').evaluate(element => element === document.activeElement)).toBe(true);
      await page.getByTestId('record-target').focus(); await page.keyboard.press('Shift+F10'); await menu(page).waitFor(); await waitMenuFocused(menu(page));
      await page.keyboard.press('Escape'); await waitClosed(page);
      await waitFocused(page.getByTestId('record-target'));
      await page.getByTestId('record-target').focus(); await page.keyboard.press('ContextMenu'); await menu(page).waitFor(); await waitMenuFocused(menu(page));
      await page.keyboard.press('Escape'); await waitClosed(page);
      await waitFocused(page.getByTestId('record-target'));
      expect(await page.getByTestId('record-target').evaluate(element => element === document.activeElement)).toBe(true);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('controlled checks, indeterminate state, indicator placement, radios and preventDefault selection stay coherent', async () => {
    const page = await open(); try {
      await rightClick(page);
      const archived = menu(page).getByRole('menuitemcheckbox', { name: 'Show archived', exact: true });
      expect(await archived.getAttribute('aria-checked')).toBe('false'); await archived.click();
      expect(await archived.getAttribute('aria-checked')).toBe('true'); expect(await menu(page).isVisible()).toBe(true);
      expect(await menu(page).getByRole('menuitemcheckbox', { name: 'Show grid', exact: true }).getAttribute('aria-checked')).toBe('true');
      const mixed = menu(page).getByRole('menuitemcheckbox', { name: 'Mixed permissions', exact: true });
      expect(await mixed.getAttribute('aria-checked')).toBe('mixed'); await mixed.click(); expect(await mixed.getAttribute('aria-checked')).toBe('true');
      await menu(page).getByRole('menuitemradio', { name: 'Sort by date', exact: true }).click();
      expect(await menu(page).getByRole('menuitemradio', { name: 'Sort by date', exact: true }).getAttribute('aria-checked')).toBe('true');
      expect(await menu(page).getByRole('menuitemradio', { name: 'Sort by name', exact: true }).getAttribute('aria-checked')).toBe('false');
      expect(await archived.getAttribute('data-indicator-position')).toBe('right');
      expect(await mixed.getAttribute('data-indicator-position')).toBe('left');
      const indicatorSides = await menu(page).evaluate(element => {
        const relative = (label: string) => {
          const row = [...element.querySelectorAll('[role="menuitemcheckbox"]')].find(item => item.textContent?.trim() === label)!;
          const box = row.getBoundingClientRect(), indicator = row.querySelector('[data-slot="context-menu-item-indicator"]')!.getBoundingClientRect();
          return (indicator.left + indicator.width / 2 - box.left) / box.width;
        };
        return { right: relative('Show archived'), left: relative('Mixed permissions') };
      });
      expect(indicatorSides.right).toBeGreaterThan(0.8); expect(indicatorSides.left).toBeLessThan(0.2);
      await menu(page).getByRole('menuitem', { name: 'Keep menu open', exact: true }).click();
      expect(await actions(page)).toEqual(['keep']); expect(await menu(page).isVisible()).toBe(true);
      expect(await menu(page).getByRole('menuitem', { name: 'Disabled action', exact: true }).getAttribute('aria-disabled')).toBe('true');
      await menu(page).getByRole('menuitem', { name: 'Disabled action', exact: true }).click({ force: true });
      expect(await actions(page)).toEqual(['keep']);
      expect(await menu(page).getByTestId('copy-icon').evaluate(element => getComputedStyle(element).color)).not.toBe('rgb(0, 0, 0)');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('an outside pointer dismissal closes the menu and leaves ordinary controls usable', async () => {
    const page = await open(); try {
      await rightClick(page);
      await page.mouse.click(20, 20); await waitClosed(page);
      await page.getByTestId('outside-target').click(); await waitFocused(page.getByTestId('outside-target'));
      expect(await page.getByTestId('outside-target').evaluate(element => element === document.activeElement)).toBe(true);
      expect(await actions(page)).toEqual([]);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('keyboard opens two nested submenu levels and commits only the enabled selected action', async () => {
    const page = await open(); try {
      await page.getByTestId('record-target').focus(); await page.keyboard.press('Shift+F10'); await menu(page).waitFor();
      await menu(page).getByRole('menuitem', { name: 'Move to 2', exact: true }).focus(); await page.keyboard.press('ArrowRight');
      await page.getByTestId('submenu').waitFor();
      await waitMenuSettled(page.getByTestId('submenu'));
      await page.getByTestId('submenu').getByRole('menuitem', { name: 'Projects', exact: true }).focus(); await page.keyboard.press('ArrowRight');
      await page.getByTestId('nested-submenu').waitFor();
      await waitMenuSettled(page.getByTestId('nested-submenu'));
      await page.getByRole('menuitem', { name: 'Project Alpha', exact: true }).click(); await waitClosed(page);
      expect(await actions(page)).toEqual(['project']);
      await rightClick(page); await menu(page).getByRole('menuitem', { name: 'Delete record', exact: true }).click();
      await waitClosed(page); expect(await actions(page)).toEqual(['project', 'delete']);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('disabled and consumer-prevented triggers do not intercept their own context/keyboard contracts', async () => {
    const page = await open(); try {
      for (const id of ['disabled-target', 'prevented-target']) {
        await page.getByTestId(id).click({ button: 'right' }); expect(await page.getByRole('menu').count()).toBe(0);
        await page.getByTestId(id).focus(); await page.keyboard.press('Shift+F10'); expect(await page.getByRole('menu').count()).toBe(0);
      }
    } finally { await page.close(); }
  }, TIMEOUT);

  test('collision handling keeps an edge menu visible and long menus remain keyboard-scrollable', async () => {
    const page = await open(390); try {
      await page.getByTestId('edge-target').click({ button: 'right' }); await page.getByTestId('edge-menu').waitFor();
      const edge = await page.getByTestId('edge-menu').boundingBox(); expect(edge?.x).toBeGreaterThanOrEqual(0);
      expect(edge!.x + edge!.width).toBeLessThanOrEqual(390); expect(edge!.y + edge!.height).toBeLessThanOrEqual(1000);
      await page.keyboard.press('Escape'); await page.getByTestId('edge-menu').waitFor({ state: 'detached' });
      await page.getByTestId('long-target').focus(); await page.keyboard.press('Shift+F10'); await page.getByTestId('long-menu').waitFor(); await waitMenuFocused(page.getByTestId('long-menu'));
      await page.keyboard.press('End');
      await waitFocused(page.getByRole('menuitem', { name: 'Action 48', exact: true }));
      expect(await page.getByRole('menuitem', { name: 'Action 48', exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
      expect(await page.getByTestId('long-menu').evaluate(element => element.scrollHeight > element.clientHeight && element.scrollTop > 0)).toBe(true);
      await page.keyboard.press('Enter'); expect(await actions(page)).toEqual(['long-47']);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('close-focus lifecycle can hand off to a dialog without the closing menu stealing focus', async () => {
    const page = await open(); try {
      await rightClick(page); await menu(page).getByRole('menuitem', { name: 'Open details', exact: true }).click();
      await page.getByRole('dialog', { name: 'Record details', exact: true }).waitFor(); await waitClosed(page);
      await page.getByRole('textbox', { name: 'Record detail name', exact: true }).fill('Synthetic detail');
      expect(await page.getByRole('textbox', { name: 'Record detail name', exact: true }).inputValue()).toBe('Synthetic detail');
      await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: 'Record details', exact: true }).waitFor({ state: 'detached' });
    } finally { await page.close(); }
  }, TIMEOUT);

  test('a menu inside a Dialog keeps its portal interactive and restores focus within the host', async () => {
    const page = await open(); try {
      await page.getByRole('button', { name: 'Open host dialog', exact: true }).click(); await page.getByTestId('host-dialog').waitFor();
      await page.getByTestId('inner-target').focus(); await page.keyboard.press('Shift+F10'); await page.getByTestId('inner-menu').waitFor();
      await waitMenuFocused(page.getByTestId('inner-menu'));
      await page.getByRole('menuitemcheckbox', { name: 'Inner setting', exact: true }).click();
      expect(await page.getByRole('menuitemcheckbox', { name: 'Inner setting', exact: true }).getAttribute('aria-checked')).toBe('true');
      await page.keyboard.press('Escape'); await page.getByTestId('inner-menu').waitFor({ state: 'detached' });
      expect(await page.getByTestId('host-dialog').isVisible()).toBe(true);
      await waitFocused(page.getByTestId('inner-target'));
      expect(await page.getByTestId('inner-target').evaluate(element => element === document.activeElement)).toBe(true);
      await page.getByRole('textbox', { name: 'Host dialog field', exact: true }).fill('Still interactive');
      await page.keyboard.press('Escape'); await page.getByTestId('host-dialog').waitFor({ state: 'detached' });
    } finally { await page.close(); }
  }, TIMEOUT);

  test('real touch long-press opens the contextual menu without an application data path', async () => {
    const page = await open(390, false, true); try {
      await page.getByTestId('record-target').scrollIntoViewIfNeeded();
      const box = await page.getByTestId('record-target').boundingBox(); if (!box) throw new Error('No touch menu target.');
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
      await menu(page).waitFor();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
      expect(await menu(page).isVisible()).toBe(true);
    } finally { await page.close(); }
  }, TIMEOUT);
});

test('captures joined controls and context menu in light/dark desktop and mobile without page overflow', async () => {
  for (const [width, dark] of [[1280, false], [1280, true], [390, false], [390, true]] as const) {
    const page = await open(width, dark); try {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: join(evidence!, `groups-${width}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
      await rightClick(page);
      await waitMenuSettled(menu(page));
      await page.screenshot({ path: join(evidence!, `menu-${width}-${dark ? 'dark' : 'light'}.png`) });
    } finally { await page.close(); }
  }
  console.log(`Grouped-control evidence: ${evidence}`);
}, TIMEOUT);
