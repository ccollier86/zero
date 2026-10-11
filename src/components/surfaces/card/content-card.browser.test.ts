/** Real native Card feedback and managed quick-look ownership; compiled styles, synthetic DOM and no preview/services. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, script = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/content-cards-');
  try {
    const built = await Bun.build({ entrypoints: [`${import.meta.dir}/content-card.browser-fixture.tsx`], target: 'browser', format: 'iife',
      define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
    if (!built.success) throw new Error(built.logs.map(log => log.message).join('\n'));
    script = await built.outputs.find(output => output.path.endsWith('.js'))!.text();
    css = await Bun.file((await buildPlatformStyles(directory, `${directory}/absent-app`, [], { themeFoundation: 'next' })).cssPath).text();
    for (const output of built.outputs.filter(output => output.path.endsWith('.css'))) css += '\n' + await output.text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

async function mount(options: { reduced?: boolean; mode?: 'default' | 'controlled' } = {}): Promise<Page> {
  const page = await lease!.browser.newPage({ viewport: { width: 960, height: 850 }, reducedMotion: options.reduced ? 'reduce' : 'no-preference' });
  page.setDefaultTimeout(5000);
  await page.route('**/*', route => route.abort());
  await page.setContent(`<!doctype html><html><body><div id="root" data-mode="${options.mode ?? ''}"></div></body></html>`);
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await page.getByTestId('content-card').waitFor(); return page;
}
const quickLook = (page: Page) => page.locator('[role="dialog"][data-slot="content-card-quick-look"]');
async function open(page: Page) {
  await page.getByRole('button', { name: 'Synthetic record', exact: true }).click(); await quickLook(page).waitFor();
  await quickLook(page).evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))); });
  return quickLook(page);
}
async function activeState(page: Page) {
  return page.evaluate(() => (window as any).__cards.state().filter((modal: any) => !modal.closing));
}

browserTest('compact composition preserves native refs/actions/forms while optional native Card keeps its original padding', async () => {
  const page = await mount({ reduced: true });
  try {
    expect(await page.evaluate(() => (window as any).__cards.refs().articleMatches)).toBe(true);
    const card = page.getByTestId('content-card'), native = page.getByTestId('native-card');
    expect(await card.evaluate(element => element.tagName)).toBe('ARTICLE');
    expect(await card.getAttribute('title')).toBe('Native article title');
    expect(await card.locator('[data-slot="card-header"]').evaluate(element => getComputedStyle(element).paddingLeft)).toBe('16px');
    expect(await native.locator('[data-slot="card-header"]').evaluate(element => getComputedStyle(element).paddingLeft)).toBe('20px');
    expect(await native.locator('[data-slot="card-header"]').evaluate(element => getComputedStyle(element).display)).toBe('grid');
    await page.getByRole('button', { name: 'Preview action', exact: true }).click();
    expect(await page.evaluate(() => (window as any).__cards.calls().actions)).toBe(1);
    expect(await activeState(page)).toHaveLength(0);
    await page.getByRole('textbox', { name: 'Preview draft', exact: true }).fill('Caller preview state');
    const before = await page.evaluate(() => (window as any).__cards.calls().previewMounts);
    const dialog = await open(page);
    expect(await page.locator('#preview-form').count()).toBe(1); expect(await page.locator('#preview-draft').count()).toBe(1);
    expect(await dialog.locator('#preview-form').count()).toBe(0); expect(await dialog.getByRole('button', { name: 'Preview action' }).count()).toBe(0);
    expect(await page.evaluate(() => (window as any).__cards.calls().previewMounts)).toBe(before);
    expect(await page.locator('#preview-draft').inputValue()).toBe('Caller preview state');
    expect(await activeState(page)).toMatchObject([{ generation: 1, triggerIsArticle: true, quickLook: true }]);
    expect(await page.locator('.zero-modal-backdrop').count()).toBe(1);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('.zero-content-card-trigger') === document.activeElement);
    expect(await page.getByRole('button', { name: 'Synthetic record', exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
    expect(await page.evaluate(() => (window as any).__cards.notifications())).toEqual([true, false]);
  } finally { await page.close(); }
}, 20_000);

browserTest('mouse-only feedback retargets its current pose, preserves caller transforms and obeys live reduced-motion changes', async () => {
  const page = await mount();
  try {
    const card = page.getByTestId('content-card');
    await card.evaluate(element => element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'pen' })));
    expect(await card.getAttribute('data-zero-card-hovered')).toBeNull();
    await card.hover();
    await page.waitForFunction(() => document.querySelector('[data-testid="content-card"]')?.getAnimations().some(animation => animation.effect?.getTiming().duration === 960));
    const current = await card.evaluate(element => {
      const animation = element.getAnimations().find(item => item.effect?.getTiming().duration === 960)!;
      animation.pause(); animation.currentTime = 360;
      return getComputedStyle(element).transform;
    });
    await page.getByTestId('outside').hover();
    await page.waitForFunction(() => document.querySelector('[data-testid="content-card"]')?.getAnimations().some(animation => animation.effect?.getTiming().duration === 480));
    const reverse = await card.evaluate(element => {
      const animation = element.getAnimations().find(item => item.effect?.getTiming().duration === 480)!;
      animation.pause(); animation.currentTime = 0;
      const from = getComputedStyle(element).transform; animation.finish();
      return { from, additive: (animation.effect as KeyframeEffect).composite };
    });
    const beforePose = current.match(/matrix\(([^)]+)\)/u)![1]!.split(',').map(Number);
    const afterPose = reverse.from.match(/matrix\(([^)]+)\)/u)![1]!.split(',').map(Number);
    expect(afterPose[4]).toBe(beforePose[4]); expect(afterPose[5]).toBeCloseTo(beforePose[5]!, 3); expect(reverse.additive).toBe('add');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="content-card"]')!).transform === 'matrix(1, 0, 0, 1, 4, 0)');
    await card.hover();
    await card.evaluate(element => element.getAnimations({ subtree: true }).forEach(animation => animation.finish()));
    expect(await card.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41)).toBe(4);
    expect(await card.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42)).toBe(-2);
    expect(await card.locator('.zero-content-card-media').evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).a)).toBeCloseTo(1.04, 3);
    await card.evaluate(element => { (element as HTMLElement).style.transform = 'translateX(11px)'; });
    expect(await card.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41)).toBe(11);
    expect(await card.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42)).toBe(-2);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="content-card"]')!).transform === 'matrix(1, 0, 0, 1, 11, 0)');
    expect(await card.locator('.zero-content-card-media').evaluate(element => getComputedStyle(element).transform)).toBe('none');
    expect(await page.evaluate(() => (window as any).__cards.calls().pointerEnter)).toBeGreaterThan(1);
    expect(await page.evaluate(() => (window as any).__cards.calls().pointerLeave)).toBeGreaterThan(0);
  } finally { await page.close(); }
}, 20_000);

browserTest('quick-look does not clone any native preview slot; custom details alone own dialog controls', async () => {
  const page = await mount({ reduced: true });
  try {
    await page.evaluate(() => (window as any).__cards.configure({ rich: true }));
    const dialog = await open(page);
    for (const id of ['preview-form', 'preview-draft', 'preview-media', 'preview-avatar', 'preview-meta', 'preview-description']) {
      expect(await page.locator(`#${id}`).count()).toBe(1); expect(await dialog.locator(`#${id}`).count()).toBe(0);
    }
    expect(await dialog.getByRole('textbox').count()).toBe(1);
    expect(await dialog.getAttribute('aria-describedby')).toBeNull();
    expect(await dialog.locator('.zero-modal__meta').count()).toBe(0);
    expect(await dialog.getByTestId('body-version').textContent()).toBe('Body revision 1');
  } finally { await page.close(); }
}, 20_000);

browserTest('changing media while hovered cleans its old owned effect and zooms only the current native element', async () => {
  const page = await mount();
  try {
    const card = page.getByTestId('content-card'); await card.hover();
    await card.locator('.zero-content-card-media').evaluate(element => { (window as any).__oldMedia = element; });
    await page.evaluate(() => (window as any).__cards.configure({ media: false }));
    await card.locator('.zero-content-card-media').waitFor({ state: 'detached' });
    expect(await page.evaluate(() => (window as any).__oldMedia.getAnimations().length)).toBe(0);
    await card.evaluate(element => element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })));
    await page.evaluate(() => (window as any).__cards.configure({ media: true }));
    const media = card.locator('.zero-content-card-media'); await media.waitFor();
    await page.waitForFunction(() => document.querySelector('.zero-content-card-media')?.getAnimations().some(animation => (animation.effect as KeyframeEffect).composite === 'add'));
    await media.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
    expect(await media.evaluate(element => element !== (window as any).__oldMedia)).toBe(true);
    expect(await media.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).a)).toBeCloseTo(1.04, 3);
    await page.getByTestId('outside').hover();
    await page.waitForFunction(() => document.querySelector('.zero-content-card-media')?.getAnimations().some(animation => animation.effect?.getTiming().duration === 480));
    await media.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.zero-content-card-media')!).transform === 'none');
  } finally { await page.close(); }
}, 20_000);

browserTest('status has one accessible current announcement and cancels blur/lift when reduced motion becomes active', async () => {
  const page = await mount();
  try {
    const status = page.getByTestId('content-card').getByRole('status');
    await page.evaluate(() => (window as any).__cards.configure({ status: 'Syncing new records' }));
    await page.waitForFunction(() => document.querySelector('[data-slot="card-status"] .sr-only')?.textContent === 'Syncing new records');
    expect(await status.locator('.sr-only').count()).toBe(1);
    expect(await status.locator('[aria-hidden="true"]').count()).toBe(1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('[data-slot="card-status"] [aria-hidden="true"]')?.childElementCount === 0);
    expect(await status.locator('[aria-hidden="true"]').textContent()).toBe('Syncing new records');
    expect(await status.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
    await page.evaluate(() => (window as any).__cards.configure({ status: 'Fully synchronized' }));
    await page.waitForFunction(() => document.querySelector('[data-slot="card-status"] .sr-only')?.textContent === 'Fully synchronized');
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('[data-slot="card-status"] [aria-hidden="true"] span')]
      .every(element => { const style = getComputedStyle(element); return style.filter === 'blur(0px)' && (style.transform === 'none' || style.transform === 'matrix(1, 0, 0, 1, 0, 0)'); }));
    expect(await status.innerText()).toContain('Fully synchronized');
    expect(await status.getAttribute('role')).toBe('status');
  } finally { await page.close(); }
}, 20_000);

browserTest('live quick-look header/body/status preserve draft focus, context signal, generation and owned child dialogs', async () => {
  const page = await mount({ reduced: true });
  try {
    const dialog = await open(page), input = dialog.getByRole('textbox', { name: 'Quick-look draft', exact: true });
    await input.fill('Preserved native draft'); await input.evaluate(element => { (window as any).__draftNode = element; });
    const before = (await activeState(page))[0];
    const mounts = await page.evaluate(() => (window as any).__cards.calls().detailsMounts);
    await page.evaluate(() => (window as any).__cards.configure({ title: 'Updated record', description: 'Updated supporting copy', meta: 'Updated metadata', status: 'Synced just now', version: 2 }));
    await page.getByRole('dialog', { name: 'Updated record', exact: true }).waitFor();
    expect(await input.inputValue()).toBe('Preserved native draft');
    expect(await input.evaluate(element => element === (window as any).__draftNode && element === document.activeElement)).toBe(true);
    expect(await dialog.getByTestId('body-version').textContent()).toBe('Body revision 2');
    expect(await page.evaluate(() => (window as any).__cards.context())).toEqual({ same: true, sameSignal: true, aborted: false });
    expect(await page.evaluate(() => (window as any).__cards.calls().detailsMounts)).toBe(mounts);
    expect((await activeState(page))[0]).toMatchObject({ id: before.id, generation: 1 });
    await dialog.getByRole('button', { name: 'Open owned child' }).click();
    const child = page.getByRole('dialog', { name: 'Owned quick-look child', exact: true }); await child.waitFor();
    await child.getByRole('textbox', { name: 'Child draft' }).fill('Child retained');
    await page.evaluate(() => (window as any).__cards.configure({ status: 'Fresh incoming update', version: 3 }));
    expect(await child.getByRole('textbox', { name: 'Child draft' }).inputValue()).toBe('Child retained');
    expect((await activeState(page))[1]).toMatchObject({ parentId: before.id, generation: 1 });
    await page.keyboard.press('Escape'); await child.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.textContent === 'Open owned child');
    expect(await dialog.getByRole('button', { name: 'Open owned child' }).evaluate(element => element === document.activeElement)).toBe(true);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
    await page.evaluate(() => (window as any).__cards.staleProjection());
    expect(await activeState(page)).toHaveLength(0);
    expect(await page.evaluate(() => (window as any).__cards.context().aborted)).toBe(true);
  } finally { await page.close(); }
}, 20_000);

browserTest('controlled dirty dismissal uses manager admission and cannot replay until a deliberate new open cycle', async () => {
  const page = await mount({ reduced: true, mode: 'controlled' });
  try {
    const dialog = quickLook(page); await dialog.waitFor();
    await page.evaluate(() => (window as any).__cards.dirty());
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    const decision = page.getByRole('alertdialog', { name: 'Discard unsaved changes?', exact: true }); await decision.waitFor();
    expect(await page.evaluate(() => (window as any).__cards.notifications())).toEqual([]);
    await decision.getByRole('button', { name: 'Keep editing', exact: true }).click(); await decision.waitFor({ state: 'detached' });
    expect(await quickLook(page).count()).toBe(1);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await decision.waitFor();
    await decision.getByRole('button', { name: 'Discard changes', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
    expect(await page.evaluate(() => (window as any).__cards.notifications())).toEqual([false]);
    await page.evaluate(() => (window as any).__cards.configure({ version: 2 }));
    await page.getByTestId('native-card').waitFor(); expect(await activeState(page)).toHaveLength(0);
    expect(await page.getByRole('button', { name: 'Synthetic record', exact: true }).getAttribute('aria-expanded')).toBe('false');
    await page.evaluate(() => (window as any).__cards.configure({ open: false }));
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    await page.evaluate(() => (window as any).__cards.configure({ open: true })); await quickLook(page).waitFor();
    expect(await page.evaluate(() => (window as any).__cards.admitted())).toHaveLength(2);
    await page.evaluate(() => (window as any).__cards.configure({ open: false })); await quickLook(page).waitFor({ state: 'detached' });
    expect(await page.evaluate(() => (window as any).__cards.notifications())).toEqual([false]);
  } finally { await page.close(); }
}, 20_000);

browserTest('StrictMode defaultOpen admits once; record replacement, removing details and unmount retire only the exact card-owned graph', async () => {
  const page = await mount({ reduced: true, mode: 'default' });
  try {
    await quickLook(page).waitFor(); expect(await page.evaluate(() => (window as any).__cards.admitted())).toHaveLength(1);
    const first = (await activeState(page))[0];
    await page.evaluate(() => (window as any).__cards.configure({ identity: 'record-b', title: 'Replacement record' }));
    await page.getByRole('dialog', { name: 'Replacement record', exact: true }).waitFor();
    expect(await page.evaluate(() => (window as any).__cards.admitted())).toHaveLength(2);
    const replacement = (await activeState(page))[0]; expect(replacement.id).not.toBe(first.id);
    await page.evaluate(() => (window as any).__cards.staleProjection()); expect((await activeState(page))[0].title).toBe('Replacement record');
    await page.evaluate(() => (window as any).__cards.configure({ details: false })); await quickLook(page).waitFor({ state: 'detached' });
    await page.evaluate(() => (window as any).__cards.configure({ details: true })); await quickLook(page).waitFor();
    await quickLook(page).getByRole('button', { name: 'Open owned child' }).click();
    await page.getByRole('dialog', { name: 'Owned quick-look child', exact: true }).waitFor();
    // Admit an unrelated manager-owned dialog without driving an inert source control.
    await page.evaluate(() => { document.querySelector<HTMLButtonElement>('button:not([aria-haspopup])')?.focus();
      const source = [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent === 'Open unrelated')!; source.click(); });
    await page.getByRole('dialog', { name: 'Unrelated owner', exact: true }).waitFor();
    await page.evaluate(() => (window as any).__cards.unmount());
    await quickLook(page).waitFor({ state: 'detached' });
    expect(await page.getByRole('dialog', { name: 'Owned quick-look child', exact: true }).count()).toBe(0);
    expect(await page.getByRole('dialog', { name: 'Unrelated owner', exact: true }).count()).toBe(1);
    expect(await activeState(page)).toMatchObject([{ title: 'Unrelated owner', quickLook: false }]);
  } finally { await page.close(); }
}, 20_000);

browserTest('a card inside a managed parent opens an owned child and returns keyboard focus to its title without closing the parent', async () => {
  const page = await mount({ reduced: true });
  try {
    await page.getByRole('button', { name: 'Open parent owner' }).click();
    const parent = page.getByRole('dialog', { name: 'Parent card owner', exact: true }); await parent.waitFor();
    const title = parent.getByRole('button', { name: 'Nested record', exact: true }); await title.focus(); await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Nested record', exact: true }).waitFor();
    const state = await activeState(page); expect(state).toHaveLength(2); expect(state[1].parentId).toBe(state[0].id);
    await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: 'Nested record', exact: true }).waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.textContent === 'Nested record');
    expect(await parent.count()).toBe(1); expect(await title.evaluate(element => element === document.activeElement)).toBe(true);
    await page.keyboard.press('Space'); await page.getByRole('dialog', { name: 'Nested record', exact: true }).waitFor();
    expect((await activeState(page))[1].parentId).toBe(state[0].id);
  } finally { await page.close(); }
}, 20_000);

browserTest('an async settlement notification failure is reported safely without replaying an already closed quick-look', async () => {
  for (const failure of ['throwNotification', 'rejectNotification'] as const) {
    const page = await mount({ reduced: true });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.evaluate(failure => (window as any).__cards.configure({ [failure]: true }), failure);
      const dialog = await open(page);
      await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
      await page.waitForFunction(() => (window as any).__cards.events().some((event: any) => event.metadata?.surface === 'content-card'));
      const events = await page.evaluate(() => (window as any).__cards.events().filter((event: any) => event.metadata?.surface === 'content-card'));
      expect(events).toHaveLength(1); expect(events[0].metadata.stage).toBe('notification');
      expect(JSON.stringify(events)).not.toContain('PRIVATE_CARD_NOTIFICATION_DETAIL');
      expect(errors).toEqual([]); expect(await activeState(page)).toHaveLength(0);
      expect(await page.evaluate(() => (window as any).__cards.notifications())).toEqual([true, false]);
      expect(await page.evaluate(() => (window as any).__cards.admitted())).toHaveLength(1);
    } finally { await page.close(); }
  }
}, 20_000);
