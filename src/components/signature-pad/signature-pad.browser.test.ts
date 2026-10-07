/** Styled production signature interactions in a synthetic browser, never a live app or signing service. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { OBS_CODES } from '../../observability/codes';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
import type { SignaturePadStroke } from './signature-pad.types';

const TIMEOUT = 45_000, SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const ARTIFACTS = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/signature-pad';
let lease: PlaywrightTestBrowserLease | undefined;
let directory: string | undefined, evidence: string | undefined, script = '', css = '';
const SEED: readonly SignaturePadStroke[] = [{ points: [[12, 30, 2], [60, 45, 2], [100, 20, 2]] }];

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) throw new Error('Signature acceptance requires the existing Playwright Chromium test browser.');
  lease = await acquirePlaywrightTestBrowser();
  await mkdir(SCRATCH, { recursive: true }); await mkdir(ARTIFACTS, { recursive: true });
  directory = await mkdtemp(join(SCRATCH, 'signature-browser-'));
  evidence = await mkdtemp(join(ARTIFACTS, 'acceptance-'));
  const result = await Bun.build({ entrypoints: [join(import.meta.dir, 'signature-pad.browser-fixture.tsx')],
    outdir: directory, naming: 'bundle.js', target: 'browser', format: 'iife' });
  if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n'));
  script = await Bun.file(join(directory, 'bundle.js')).text();
  css = await Bun.file((await buildPlatformStyles(directory, join(directory, 'missing-app'))).cssPath).text();
}, TIMEOUT);
afterAll(async () => { try { if (directory) await rm(directory, { recursive: true, force: true }); } finally { lease?.release(); } }, TIMEOUT);

async function open(width = 1080, dark = false, touch = false): Promise<Page> {
  if (!lease) throw new Error('Signature browser fixture was not initialized.');
  const page = await lease.browser.newPage({ viewport: { width, height: 900 }, hasTouch: touch });
  page.setDefaultTimeout(4_000);
  await page.setContent(`<!doctype html><html${dark ? ' class="dark"' : ''}><head></head><body><div id="root"></div></body></html>`);
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await page.getByTestId('fixture-ready').waitFor();
  await page.waitForFunction(() => !!window.__signatureHarness);
  return page;
}
function area(page: Page): Locator { return page.getByTestId('signature-area'); }
async function configure(page: Page, options: Parameters<Window['__signatureHarness']['configure']>[0]): Promise<void> {
  await page.evaluate((options) => window.__signatureHarness.configure(options), options);
  await page.waitForTimeout(20);
}
async function draw(page: Page, target = area(page), offset = 0): Promise<void> {
  const box = await target.boundingBox(); if (!box) throw new Error('Signature area is not visible.');
  await page.mouse.move(box.x + 40 + offset, box.y + 65);
  await page.mouse.down();
  await page.mouse.move(box.x + 80 + offset, box.y + 95, { steps: 5 });
  await page.mouse.move(box.x + 130 + offset, box.y + 55, { steps: 6 });
  await page.mouse.up();
}
async function ink(page: Page): Promise<readonly SignaturePadStroke[]> {
  return page.evaluate(() => window.__signatureHarness.api()?.strokes ?? []);
}
async function dispatchPointer(page: Page, type: string, options: { pointerId: number; pointerType: string; x?: number; y?: number; pressure?: number; button?: number; isPrimary?: boolean }): Promise<void> {
  const target = area(page); const box = await target.boundingBox(); if (!box) throw new Error('No pointer target.');
  await target.dispatchEvent(type, { bubbles: true, pointerId: options.pointerId, pointerType: options.pointerType,
    clientX: box.x + (options.x ?? 40), clientY: box.y + (options.y ?? 65), pressure: options.pressure ?? 0.5,
    button: options.button ?? 0, buttons: type === 'pointerup' ? 0 : 1, isPrimary: options.isPrimary ?? true });
}
async function currentSave(page: Page): Promise<number> {
  await page.waitForFunction(() => window.__signatureHarness.saveRequests().some((request) => !request.settled));
  return page.evaluate(() => window.__signatureHarness.saveRequests().find((request) => !request.settled)!.id);
}
async function currentSign(page: Page): Promise<number> {
  await page.waitForFunction(() => window.__signatureHarness.signRequests().some((request) => !request.settled));
  return page.evaluate(() => window.__signatureHarness.signRequests().find((request) => !request.settled)!.id);
}

describe('SignaturePad public browser composition', () => {
  test('captures actual mouse ink and pins clear/save controls within the muted area', async () => {
    const page = await open(); try {
      expect(await page.getByRole('button', { name: 'Save signature', exact: true }).isDisabled()).toBe(true);
      await draw(page);
      expect((await ink(page)).length).toBe(1);
      expect((await ink(page))[0]!.points.length).toBeGreaterThan(2);
      expect(await page.getByTestId('stroke-starts').textContent()).toBe('["mouse"]');
      expect(await page.getByTestId('stroke-ends').textContent()).toBe('1');
      expect(await page.getByRole('button', { name: 'Save signature', exact: true }).isEnabled()).toBe(true);
      expect(await area(page).evaluate((element) => {
        const box = element.getBoundingClientRect();
        return [...element.querySelectorAll('[data-slot="signature-pad-controls"]')].every((control) => {
          const bounds = control.getBoundingClientRect(); return bounds.left >= box.left && bounds.right <= box.right
            && bounds.top >= box.top && bounds.bottom <= box.bottom;
        });
      })).toBe(true);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('undo, redo and clear operate on complete strokes with Ctrl+Z and Ctrl+Shift+Z', async () => {
    const page = await open(); try {
      await draw(page); await draw(page, area(page), 150);
      await area(page).focus(); await page.keyboard.press('Control+z');
      expect((await ink(page)).length).toBe(1);
      await page.keyboard.press('Control+Shift+z'); expect((await ink(page)).length).toBe(2);
      await page.getByRole('button', { name: 'Clear signature', exact: true }).click(); expect(await ink(page)).toEqual([]);
      await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect((await ink(page)).length).toBe(2);
      await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(await ink(page)).toEqual([]);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('keyboard history stays local and does not steal input undo or outside shortcuts', async () => {
    const page = await open(); try {
      await draw(page); await page.getByRole('textbox', { name: 'Outside notes' }).focus();
      await page.keyboard.press('Control+z'); expect((await ink(page)).length).toBe(1);
      await page.getByRole('textbox', { name: 'Local notes' }).fill('Notes');
      await page.keyboard.press('Control+z'); expect((await ink(page)).length).toBe(1);
      await area(page).focus(); await page.keyboard.press('Control+z'); expect(await ink(page)).toEqual([]);
      await page.keyboard.press('Control+y'); expect((await ink(page)).length).toBe(1);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('pen pressure and touch pointer callbacks are admitted without cross-pointer mixing', async () => {
    const page = await open(); try {
      await configure(page, { sizing: 'pressure' });
      await dispatchPointer(page, 'pointerdown', { pointerId: 21, pointerType: 'pen', pressure: 0.1 });
      await dispatchPointer(page, 'pointermove', { pointerId: 22, pointerType: 'touch', x: 300, pressure: 1 });
      await dispatchPointer(page, 'pointermove', { pointerId: 21, pointerType: 'pen', x: 120, pressure: 0.9 });
      await dispatchPointer(page, 'pointerup', { pointerId: 21, pointerType: 'pen', x: 140, pressure: 0.8 });
      expect((await ink(page)).length).toBe(1);
      const sizes = (await ink(page))[0]!.points.map((point) => point[2]);
      expect(Math.max(...sizes)).toBeGreaterThan(Math.min(...sizes));
      expect(await page.getByTestId('stroke-starts').textContent()).toBe('["pen"]');
      await dispatchPointer(page, 'pointerdown', { pointerId: 31, pointerType: 'touch', x: 200 });
      await dispatchPointer(page, 'pointermove', { pointerId: 31, pointerType: 'touch', x: 240 });
      await dispatchPointer(page, 'pointerup', { pointerId: 31, pointerType: 'touch', x: 280 });
      expect((await ink(page)).length).toBe(2);
      expect(await page.getByTestId('stroke-starts').textContent()).toBe('["pen","touch"]');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('native touch input creates ink and prevents page panning within the signature area', async () => {
    const page = await open(390, false, true); try {
      const box = await area(page).boundingBox(); if (!box) throw new Error('No touch area.');
      await page.touchscreen.tap(box.x + 70, box.y + 80);
      expect((await ink(page)).length).toBe(1);
      expect(await area(page).evaluate((element) => getComputedStyle(element).touchAction)).toBe('none');
      expect(await page.getByTestId('stroke-starts').textContent()).toBe('["touch"]');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('cancel and lost capture discard incomplete strokes rather than submitting partial ink', async () => {
    const page = await open(); try {
      for (const terminal of ['pointercancel', 'lostpointercapture']) {
        await dispatchPointer(page, 'pointerdown', { pointerId: 42, pointerType: 'pen' });
        await dispatchPointer(page, 'pointermove', { pointerId: 42, pointerType: 'pen', x: 120 });
        await dispatchPointer(page, terminal, { pointerId: 42, pointerType: 'pen' });
        expect(await ink(page)).toEqual([]);
        expect(await page.evaluate(() => window.__signatureHarness.api()?.isDrawing)).toBe(false);
      }
      expect(await page.getByTestId('stroke-ends').textContent()).toBe('0');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('pointer capture completes a mouse stroke released outside the surface', async () => {
    const page = await open(); try {
      const box = await area(page).boundingBox(); if (!box) throw new Error('No capture area.');
      await page.mouse.move(box.x + 60, box.y + 70); await page.mouse.down();
      await page.mouse.move(box.x + box.width + 80, box.y + 75, { steps: 10 }); await page.mouse.up();
      expect((await ink(page)).length).toBe(1);
      expect(await page.evaluate(() => window.__signatureHarness.api()?.isDrawing)).toBe(false);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('pointer restrictions and non-primary/right-button input do not create ink', async () => {
    const page = await open(); try {
      await configure(page, { pointerTypes: ['pen'] }); await draw(page); expect(await ink(page)).toEqual([]);
      await dispatchPointer(page, 'pointerdown', { pointerId: 51, pointerType: 'pen', button: 2 });
      await dispatchPointer(page, 'pointerup', { pointerId: 51, pointerType: 'pen', button: 2 });
      await dispatchPointer(page, 'pointerdown', { pointerId: 52, pointerType: 'pen', isPrimary: false });
      await dispatchPointer(page, 'pointerup', { pointerId: 52, pointerType: 'pen', isPrimary: false });
      expect(await ink(page)).toEqual([]); expect(await page.getByTestId('stroke-starts').textContent()).toBe('[]');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('changed ink options retire an active gesture while equivalent pointer choices preserve it', async () => {
    const page = await open(); try {
      const changes: Parameters<Window['__signatureHarness']['flags']>[0][] = [
        { color: '#3366FF' }, { minWidth: 1.1 }, { maxWidth: 5 }, { smoothing: .1 },
        { sizing: 'pressure' }, { pointerTypes: ['mouse'] },
      ];
      for (const change of changes) {
        await configure(page, {});
        await dispatchPointer(page, 'pointerdown', { pointerId: 77, pointerType: 'pen' });
        await dispatchPointer(page, 'pointermove', { pointerId: 77, pointerType: 'pen', x: 90 });
        expect(await page.evaluate(() => window.__signatureHarness.api()?.isDrawing)).toBe(true);
        await page.evaluate((change) => window.__signatureHarness.flags(change), change);
        await page.waitForFunction(() => window.__signatureHarness.api()?.isDrawing === false);
        await dispatchPointer(page, 'pointerup', { pointerId: 77, pointerType: 'pen', x: 130 });
        expect(await ink(page)).toEqual([]); expect(await page.getByTestId('stroke-ends').textContent()).toBe('0');
      }
      await configure(page, {});
      await dispatchPointer(page, 'pointerdown', { pointerId: 78, pointerType: 'pen' });
      await page.evaluate(() => window.__signatureHarness.flags({ pointerTypes: ['mouse', 'pen', 'touch'] }));
      expect(await page.evaluate(() => window.__signatureHarness.api()?.isDrawing)).toBe(true);
      await dispatchPointer(page, 'pointermove', { pointerId: 78, pointerType: 'pen', x: 90 });
      await dispatchPointer(page, 'pointerup', { pointerId: 78, pointerType: 'pen', x: 130 });
      expect((await ink(page)).length).toBe(1);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('read-only and disabled flags also guard imperative mutation methods', async () => {
    const page = await open(); try {
      await draw(page); const before = await ink(page);
      for (const flag of ['readOnly', 'disabled'] as const) {
        await page.evaluate((flag) => window.__signatureHarness.flags({ readOnly: flag === 'readOnly', disabled: flag === 'disabled' }), flag);
        await page.waitForFunction((flag) => window.__signatureHarness.api()?.[flag] === true, flag);
        for (const action of ['clear', 'undo', 'redo', 'reset'] as const) await page.evaluate((action) => window.__signatureHarness.invoke(action), action);
        await draw(page); expect(await ink(page)).toEqual(before);
        expect(await page.getByRole('button', { name: 'Save signature', exact: true }).isDisabled()).toBe(true);
      }
    } finally { await page.close(); }
  }, TIMEOUT);

  test('saved API references cannot mutate or publish callbacks after unmount', async () => {
    const page = await open(); try {
      await draw(page); const before = await page.getByTestId('signature-changes').textContent();
      await page.evaluate(() => window.__signatureHarness.unmount()); await area(page).waitFor({ state: 'detached' });
      for (const action of ['clear', 'undo', 'redo', 'reset'] as const) await page.evaluate((action) => window.__signatureHarness.invoke(action, true), action);
      expect(await page.getByTestId('signature-changes').textContent()).toBe(before);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('required native field blocks empty submission and submits an SVG data URL after drawing', async () => {
    const page = await open(); try {
      await configure(page, { mode: 'form' }); await page.getByRole('button', { name: 'Clear signature', exact: true }).click();
      expect(await page.getByTestId('signature-form').evaluate((form) => (form as HTMLFormElement).checkValidity())).toBe(false);
      await page.getByRole('button', { name: 'Submit form' }).click(); expect(await page.getByTestId('submitted').textContent()).toBe('[]');
      await draw(page); expect(await page.getByTestId('signature-form').evaluate((form) => (form as HTMLFormElement).checkValidity())).toBe(true);
      await page.getByRole('button', { name: 'Submit form' }).click();
      const submitted = JSON.parse(await page.getByTestId('submitted').textContent() ?? '[]') as string[][];
      expect(submitted[0]?.[0]).toBe('signature'); expect(submitted[0]?.[1]).toStartWith('data:image/svg+xml;charset=utf-8,');
      expect(decodeURIComponent(submitted[0]![1]!.split(',')[1]!)).toContain('<path');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('native reset restores initial ink/history but a cancelled form reset preserves the draft', async () => {
    const page = await open(); try {
      await configure(page, { mode: 'form' }); expect(await ink(page)).toEqual(SEED);
      await draw(page); expect((await ink(page)).length).toBe(2);
      await page.getByRole('button', { name: 'Reset form' }).click(); await page.waitForFunction(() => window.__signatureHarness.api()?.strokes.length === 1);
      expect(await ink(page)).toEqual(SEED); expect(await page.evaluate(() => window.__signatureHarness.api()?.canUndo)).toBe(false);
      await draw(page); const before = await ink(page); await page.evaluate(() => window.__signatureHarness.cancelReset(true));
      await page.waitForTimeout(20); await page.getByRole('button', { name: 'Reset form' }).click();
      await page.waitForTimeout(20); expect(await ink(page)).toEqual(before);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('external form binding includes the signature and disabled fields are excluded', async () => {
    const page = await open(); try {
      await configure(page, { mode: 'external-form' }); await draw(page);
      await page.getByRole('button', { name: 'Submit form' }).click(); expect(await page.getByTestId('submitted').textContent()).toContain('signature');
      await page.evaluate(() => window.__signatureHarness.flags({ disabled: true }));
      await page.waitForFunction(() => window.__signatureHarness.api()?.disabled === true);
      await page.getByRole('button', { name: 'Submit form' }).click(); expect(await page.getByTestId('submitted').textContent()).toBe('[]');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('JSON form format submits stroke data rather than an image or unrelated drawing', async () => {
    const page = await open(); try {
      await configure(page, { mode: 'form', format: 'json' }); await page.getByRole('button', { name: 'Submit form' }).click();
      const submitted = JSON.parse(await page.getByTestId('submitted').textContent() ?? '[]') as string[][];
      expect(JSON.parse(submitted[0]![1]!)).toEqual(SEED);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('save awaits its callback, prevents duplicate submissions and freezes drawing/history while pending', async () => {
    const page = await open(); try {
      await draw(page); const before = await ink(page); const save = page.getByRole('button', { name: 'Save signature', exact: true });
      await save.click(); const id = await currentSave(page); expect(await save.isDisabled()).toBe(true);
      await save.dispatchEvent('click'); expect(await page.evaluate(() => window.__signatureHarness.saveRequests().length)).toBe(1);
      await draw(page); await page.evaluate(() => window.__signatureHarness.invoke('clear')); expect(await ink(page)).toEqual(before);
      const submitted = await page.evaluate(() => window.__signatureHarness.saveRequests()[0]!);
      expect(submitted.strokes).toEqual(before); expect(submitted.value).toStartWith('data:image/svg+xml;charset=utf-8,');
      await page.evaluate((id) => window.__signatureHarness.resolveSave(id), id);
      await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-slot="signature-pad-save"]')?.disabled);
      expect(await ink(page)).toEqual(before);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('save failure stays editable and emits only bounded code metadata', async () => {
    const page = await open(); try {
      await draw(page); await page.getByRole('button', { name: 'Save signature', exact: true }).click(); const id = await currentSave(page);
      await page.evaluate((id) => window.__signatureHarness.rejectSave(id), id);
      await page.waitForFunction((code) => window.__signatureHarness.events().some((event) => event.code === code), OBS_CODES.FRONTEND_SIGNATURE_PAD_SAVE_FAILED.code);
      expect(await page.getByRole('button', { name: 'Save signature', exact: true }).isEnabled()).toBe(true);
      expect(JSON.stringify(await page.evaluate(() => window.__signatureHarness.events()))).not.toContain('private signature');
      expect(JSON.stringify(await page.evaluate(() => window.__signatureHarness.events()))).not.toContain('<svg');
      await page.getByRole('button', { name: 'Save signature', exact: true }).click(); expect(await page.evaluate(() => window.__signatureHarness.saveRequests().length)).toBe(2);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('declined saves do not announce acceptance and caller-owned feedback can suppress inline results', async () => {
    const page = await open(); try {
      await draw(page); await page.getByRole('button', { name: 'Save signature', exact: true }).click(); const declined = await currentSave(page);
      await page.evaluate((id) => window.__signatureHarness.resolveSave(id, false), declined);
      await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-slot="signature-pad-save"]')?.disabled);
      expect(await page.getByText('Signature accepted by the save callback.', { exact: true }).count()).toBe(0);
      expect(await page.evaluate(() => window.__signatureHarness.events().length)).toBe(0);
      await page.evaluate(() => window.__signatureHarness.flags({ showFeedback: false }));
      await page.getByRole('button', { name: 'Save signature', exact: true }).click(); const rejected = await currentSave(page);
      await page.evaluate((id) => window.__signatureHarness.rejectSave(id), rejected);
      await page.waitForFunction((code) => window.__signatureHarness.events().some((event) => event.code === code), OBS_CODES.FRONTEND_SIGNATURE_PAD_SAVE_FAILED.code);
      await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-slot="signature-pad-save"]')?.disabled);
      expect(await page.getByRole('alert').count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Save signature', exact: true }).isEnabled()).toBe(true);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('rejected change notifications report once after accepted ink but not after a retired scope', async () => {
    const page = await open(); try {
      await configure(page, { deferChangeNotifications: true }); await draw(page);
      const accepted = await ink(page);
      const id = await page.evaluate(() => window.__signatureHarness.changeRequests().find((request) => !request.settled)!.id);
      await page.evaluate((id) => window.__signatureHarness.rejectChange(id), id);
      await page.waitForFunction((code) => window.__signatureHarness.events().some((event) => event.code === code), OBS_CODES.FRONTEND_SIGNATURE_PAD_CALLBACK_FAILED.code);
      const failures = await page.evaluate(() => window.__signatureHarness.events());
      expect(failures.length).toBe(1); expect(failures[0]?.metadata).toEqual({ operation: 'change' });
      expect(JSON.stringify(failures)).not.toContain('private signature'); expect(JSON.stringify(failures)).not.toContain('<svg');
      expect(await ink(page)).toEqual(accepted);
      await draw(page, area(page), 150);
      const retired = await page.evaluate(() => window.__signatureHarness.changeRequests().find((request) => !request.settled)!.id);
      await page.evaluate(() => window.__signatureHarness.scope('organization-b:contract-1'));
      await page.waitForFunction(() => window.__signatureHarness.api()?.isEmpty === true);
      await page.evaluate(() => window.__signatureHarness.scope('organization-a:contract-1'));
      await page.waitForTimeout(20);
      await page.evaluate((id) => window.__signatureHarness.rejectChange(id), retired);
      await page.waitForTimeout(20);
      expect(await page.evaluate(() => window.__signatureHarness.events().length)).toBe(1);
      expect(await ink(page)).toEqual([]);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('scope changes reset local ink and fence late failures including A→B→A', async () => {
    const page = await open(); try {
      await draw(page); await page.getByRole('button', { name: 'Save signature', exact: true }).click(); const id = await currentSave(page);
      await page.evaluate(() => window.__signatureHarness.scope('organization-b:contract-1'));
      await page.waitForFunction(() => window.__signatureHarness.api()?.isEmpty === true);
      await page.evaluate(() => window.__signatureHarness.scope('organization-a:contract-1')); await page.waitForTimeout(20);
      await draw(page); const before = await ink(page); await page.evaluate((id) => window.__signatureHarness.rejectSave(id), id);
      await page.waitForTimeout(20); expect(await ink(page)).toEqual(before);
      expect(await page.evaluate(() => window.__signatureHarness.events().length)).toBe(0);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('a controlled interior-point replacement clears obsolete history and cancels active drawing', async () => {
    const page = await open(); try {
      await configure(page, { mode: 'controlled' }); await page.evaluate((strokes) => window.__signatureHarness.externalValue(strokes), SEED);
      await page.waitForFunction(() => window.__signatureHarness.api()?.strokes.length === 1);
      await draw(page); expect(await page.evaluate(() => window.__signatureHarness.api()?.canUndo)).toBe(true);
      await dispatchPointer(page, 'pointerdown', { pointerId: 61, pointerType: 'pen' });
      const external: readonly SignaturePadStroke[] = [{ points: [[12, 30, 2], [65, 90, 2], [100, 20, 2]] }];
      await page.evaluate((strokes) => window.__signatureHarness.externalValue(strokes), external);
      await page.waitForFunction(() => window.__signatureHarness.api()?.strokes[0]?.points[1]?.[1] === 90);
      expect(await ink(page)).toEqual(external); expect(await page.evaluate(() => window.__signatureHarness.api()?.canUndo)).toBe(false);
      expect(await page.evaluate(() => window.__signatureHarness.api()?.isDrawing)).toBe(false);
      await dispatchPointer(page, 'pointerup', { pointerId: 61, pointerType: 'pen' }); expect(await ink(page)).toEqual(external);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('replacing a controlled draft during a pending save retires its lock and feedback', async () => {
    const page = await open(); try {
      await configure(page, { mode: 'controlled' }); await draw(page);
      await page.getByRole('button', { name: 'Save signature', exact: true }).click(); const id = await currentSave(page);
      await page.evaluate((strokes) => window.__signatureHarness.externalValue(strokes), SEED);
      await page.waitForFunction(() => window.__signatureHarness.api()?.strokes[0]?.points[0]?.[0] === 12);
      expect(await page.getByRole('button', { name: 'Save signature', exact: true }).isEnabled()).toBe(true);
      await page.evaluate((id) => window.__signatureHarness.rejectSave(id), id);
      await page.waitForTimeout(20); expect(await ink(page)).toEqual(SEED);
      expect(await page.evaluate(() => window.__signatureHarness.events().length)).toBe(0);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('caller-held arrays and callback snapshots cannot alias or mutate the current drawing', async () => {
    const page = await open(); try {
      await configure(page, { mode: 'controlled' });
      await page.evaluate(() => {
        const source = [{ points: [[12, 30, 2], [60, 45, 2], [100, 20, 2]] }];
        window.__signatureHarness.externalValue(source as unknown as SignaturePadStroke[]);
        (window as unknown as { __source: typeof source }).__source = source;
      });
      await page.waitForFunction(() => window.__signatureHarness.api()?.strokes.length === 1);
      const before = await ink(page);
      await page.evaluate(() => { (window as unknown as { __source: { points: number[][] }[] }).__source[0]!.points[1]![1] = 999; });
      expect(await ink(page)).toEqual(before);
      expect(await page.evaluate(() => { const strokes = window.__signatureHarness.api()!.strokes;
        return Object.isFrozen(strokes) && Object.isFrozen(strokes[0]) && Object.isFrozen(strokes[0]!.points)
          && Object.isFrozen(strokes[0]!.points[0]); })).toBe(true);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('light/dark signing surface and responsive pinned controls use the actual platform styles', async () => {
    for (const [width, dark] of [[1080, false], [1080, true], [390, false], [390, true]] as const) {
      const page = await open(width, dark); try {
        await draw(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(await area(page).evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
        expect(await page.getByRole('button', { name: 'Save signature', exact: true }).isVisible()).toBe(true);
        if (evidence) await page.screenshot({ path: join(evidence, `signature-${width}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
      } finally { await page.close(); }
    }
  }, TIMEOUT);
});

describe('Signature agreement and clause initials prefabs', () => {
  async function preparedAgreement(page: Page): Promise<void> {
    await configure(page, { mode: 'agreement' });
    await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Fixture signer');
    await draw(page, page.getByRole('application', { name: 'Agreement signature', exact: true }));
    await page.getByRole('checkbox', { name: 'I agree to the project terms.', exact: true }).click();
  }

  test('agreement requires ink, name and optional consent then locks only after the app returns a date', async () => {
    const page = await open(); try {
      await configure(page, { mode: 'agreement' });
      const sign = page.getByRole('button', { name: 'Sign agreement', exact: true });
      expect(await sign.isDisabled()).toBe(true);
      await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Fixture signer');
      await draw(page, page.getByRole('application', { name: 'Agreement signature', exact: true }));
      expect(await sign.isDisabled()).toBe(true);
      await page.getByRole('checkbox', { name: 'I agree to the project terms.', exact: true }).click();
      await sign.click(); const id = await currentSign(page);
      expect(await page.locator('[data-slot="signature-agreement-card"]').getAttribute('data-state')).toBe('pending');
      expect(await page.locator('time').count()).toBe(0);
      await page.getByRole('button', { name: 'Confirming…', exact: true }).dispatchEvent('click');
      expect(await page.evaluate(() => window.__signatureHarness.signRequests().length)).toBe(1);
      const submitted = await page.evaluate(() => window.__signatureHarness.signRequests()[0]!.payload);
      expect(submitted.svg).toStartWith('<svg'); expect(submitted.signerName).toBe('Fixture signer');
      await page.evaluate((id) => window.__signatureHarness.resolveSign(id, { signedAt: '2026-10-05T12:00:00Z', signerName: 'Verified signer' }), id);
      await page.waitForFunction(() => document.querySelector('[data-slot="signature-agreement-card"]')?.getAttribute('data-state') === 'signed');
      expect(await page.getByText('Signed by Verified signer', { exact: true }).count()).toBe(1);
      expect(await page.locator('time').getAttribute('datetime')).toBe('2026-10-05T12:00:00Z');
      expect(await page.getByRole('button', { name: 'Clear signature', exact: true }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Sign agreement', exact: true }).count()).toBe(0);
      expect(await page.getByRole('application', { name: 'Signed agreement signature', exact: true }).getAttribute('data-readonly')).not.toBeNull();
      expect(await page.evaluate(() => window.__signatureHarness.notifications()[0]!.strokes)).toEqual(submitted.strokes);
      if (evidence) await page.screenshot({ path: join(evidence, 'agreement-signed-light.png'), fullPage: true });
    } finally { await page.close(); }
  }, TIMEOUT);

  test('a rejected or invalid signing acknowledgement remains unsigned and retryable', async () => {
    const page = await open(); try {
      await preparedAgreement(page); await page.getByRole('button', { name: 'Sign agreement', exact: true }).click();
      const id = await currentSign(page); await page.evaluate((id) => window.__signatureHarness.rejectSign(id), id);
      await page.getByRole('alert').waitFor(); expect(await page.locator('time').count()).toBe(0);
      expect(await page.getByText('Signature accepted by the save callback.', { exact: true }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Sign agreement', exact: true }).isEnabled()).toBe(true);
      await page.getByRole('button', { name: 'Sign agreement', exact: true }).click(); const invalid = await currentSign(page);
      await page.evaluate((id) => window.__signatureHarness.resolveSign(id, { signedAt: 'not-a-date' }), invalid);
      await page.waitForFunction(() => document.querySelector('[data-slot="signature-agreement-card"]')?.getAttribute('data-state') === 'draft');
      expect(await page.locator('time').count()).toBe(0); expect(await page.evaluate(() => window.__signatureHarness.notifications().length)).toBe(0);
      const events = JSON.stringify(await page.evaluate(() => window.__signatureHarness.events()));
      expect(events).not.toContain('Fixture signer'); expect(events).not.toContain('private signature'); expect(events).not.toContain('<svg');
    } finally { await page.close(); }
  }, TIMEOUT);

  test('switching agreement source A→B→A retires the old receipt without signing the new document', async () => {
    const page = await open(); try {
      await preparedAgreement(page); await page.getByRole('button', { name: 'Sign agreement', exact: true }).click(); const id = await currentSign(page);
      await page.evaluate(() => window.__signatureHarness.scope('organization-b:contract-1'));
      await page.getByRole('textbox', { name: 'Full name', exact: true }).waitFor();
      expect(await page.getByRole('textbox', { name: 'Full name', exact: true }).inputValue()).toBe('');
      await page.evaluate(() => window.__signatureHarness.scope('organization-a:contract-1')); await page.waitForTimeout(20);
      await page.evaluate((id) => window.__signatureHarness.resolveSign(id, { signedAt: '2026-10-05T12:00:00Z' }), id);
      await page.waitForTimeout(20);
      expect(await page.locator('[data-slot="signature-agreement-card"]').getAttribute('data-state')).toBe('draft');
      expect(await page.getByText('Signature accepted by the save callback.', { exact: true }).count()).toBe(0);
      expect(await page.locator('time').count()).toBe(0); expect(await page.evaluate(() => window.__signatureHarness.notifications().length)).toBe(0);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('unmounted agreements do not publish a late acknowledgement', async () => {
    const page = await open(); try {
      await preparedAgreement(page); await page.getByRole('button', { name: 'Sign agreement', exact: true }).click(); const id = await currentSign(page);
      await page.evaluate(() => window.__signatureHarness.unmount()); await page.locator('[data-slot="signature-agreement-card"]').waitFor({ state: 'detached' });
      await page.evaluate((id) => window.__signatureHarness.resolveSign(id, { signedAt: '2026-10-05T12:00:00Z' }), id);
      await page.waitForTimeout(20); expect(await page.evaluate(() => window.__signatureHarness.notifications().length)).toBe(0);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('prefilled receipts regenerate safe ink instead of rendering supplied arbitrary SVG', async () => {
    const page = await open(); try {
      await configure(page, { mode: 'agreement' });
      await page.evaluate((strokes) => window.__signatureHarness.signedReceipt({
        signedAt: '2026-10-05T12:00:00Z', signerName: 'Verified signer', strokes,
        svg: '<svg><script>window.unsafeSignature=true</script><image href="https://private.example.invalid" /></svg>',
      }), SEED);
      await page.waitForFunction(() => document.querySelector('[data-slot="signature-agreement-card"]')?.getAttribute('data-state') === 'signed');
      expect(await page.locator('[data-slot="signature-agreement-card"] script').count()).toBe(0);
      expect(await page.locator('[data-slot="signature-agreement-card"] image').count()).toBe(0);
      expect(await page.getByRole('application', { name: 'Signed agreement signature' }).locator('path[data-slot="signature-pad-stroke"]').count()).toBe(1);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('clause initials count actual drawings, clear individually and drop removed clauses from the count', async () => {
    const page = await open(); try {
      await configure(page, { mode: 'clauses' }); const counter = page.locator('[data-slot="clause-initials-completion"]');
      expect(await counter.textContent()).toBe('0 of 2 initialed');
      await draw(page, page.getByRole('application', { name: 'Initials for clause 1' })); expect(await counter.textContent()).toBe('1 of 2 initialed');
      await draw(page, page.getByRole('application', { name: 'Initials for clause 2' })); expect(await counter.textContent()).toBe('2 of 2 initialed');
      const inputs = await page.locator('input[name^="initials."]').evaluateAll((elements) => elements.map((element) => ({ name: (element as HTMLInputElement).name, value: (element as HTMLInputElement).value })));
      expect(inputs.map((input) => input.name)).toEqual(['initials.confidentiality', 'initials.delivery']);
      expect(inputs.every((input) => input.value.startsWith('data:image/svg+xml;charset=utf-8,'))).toBe(true);
      await page.locator('[data-slot="clause-initials-item"]').first().getByRole('button', { name: 'Clear signature', exact: true }).click();
      expect(await counter.textContent()).toBe('1 of 2 initialed');
      await page.evaluate(() => window.__signatureHarness.keepFirstClause());
      // Updating the controlled clause list schedules a React render; evaluating
      // the fixture callback does not itself acknowledge that render.
      await page.waitForFunction(() => document.querySelector('[data-slot="clause-initials-completion"]')?.textContent === '0 of 1 initialed');
      expect(await counter.textContent()).toBe('0 of 1 initialed');
      expect(await page.locator('[data-slot="clause-initials-item"]').count()).toBe(1);
      expect(await page.locator('input[name^="initials."]').evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).name)))
        .toEqual(['initials.confidentiality']);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('clause scope boundaries reset local drawings and read-only clauses expose no clear action', async () => {
    const page = await open(); try {
      await configure(page, { mode: 'clauses' }); await draw(page, page.getByRole('application', { name: 'Initials for clause 1' }));
      await page.evaluate(() => window.__signatureHarness.scope('organization-b:contract-2'));
      await page.waitForFunction(() => document.querySelector('[data-slot="clause-initials-completion"]')?.textContent === '0 of 2 initialed');
      await page.evaluate(() => window.__signatureHarness.flags({ readOnly: true }));
      expect(await page.getByRole('button', { name: 'Clear signature', exact: true }).count()).toBe(0);
      await draw(page, page.getByRole('application', { name: 'Initials for clause 1' }));
      expect(await page.locator('[data-slot="clause-initials-completion"]').textContent()).toBe('0 of 2 initialed');
      if (evidence) await page.screenshot({ path: join(evidence, 'clause-initials-readonly-light.png'), fullPage: true });
    } finally { await page.close(); }
  }, TIMEOUT);

  test('native multi-clause form reset clears every initial in one event without losing earlier field updates', async () => {
    const page = await open(); try {
      await configure(page, { mode: 'clauses' });
      await draw(page, page.getByRole('application', { name: 'Initials for clause 1' }));
      await draw(page, page.getByRole('application', { name: 'Initials for clause 2' }));
      expect(await page.locator('[data-slot="clause-initials-completion"]').textContent()).toBe('2 of 2 initialed');
      await page.getByRole('button', { name: 'Reset initials', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[data-slot="clause-initials-completion"]')?.textContent === '0 of 2 initialed');
      expect(await page.locator('input[name^="initials."]').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toEqual(['', '']);
      expect(await page.getByTestId('clause-form').evaluate((form) => (form as HTMLFormElement).checkValidity())).toBe(false);
      await draw(page, page.getByRole('application', { name: 'Initials for clause 1' }));
      await draw(page, page.getByRole('application', { name: 'Initials for clause 2' }));
      await page.evaluate(() => window.__signatureHarness.clearClausesTogether());
      await page.waitForFunction(() => document.querySelector('[data-slot="clause-initials-completion"]')?.textContent === '0 of 2 initialed');
      expect(await page.locator('input[name^="initials."]').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toEqual(['', '']);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('agreement and clause controls remain reachable at mobile widths in both themes', async () => {
    for (const dark of [false, true]) {
      const page = await open(390, dark); try {
        await preparedAgreement(page);
        await page.waitForTimeout(550); // The reused Checkbox's color/check transitions take up to 500ms.
        expect(await page.getByRole('checkbox', { name: 'I agree to the project terms.', exact: true }).getAttribute('aria-checked')).toBe('true');
        expect(await page.getByRole('checkbox', { name: 'I agree to the project terms.', exact: true }).locator('svg path').evaluate((path) =>
          Number(getComputedStyle(path).opacity))).toBeGreaterThan(.9);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const sign = page.getByRole('button', { name: 'Sign agreement', exact: true });
        expect(await sign.isVisible()).toBe(true);
        const bounds = await sign.boundingBox(); expect(bounds?.width).toBeGreaterThan(90);
        if (evidence) await page.screenshot({ path: join(evidence, `agreement-mobile-${dark ? 'dark' : 'light'}.png`), fullPage: true });
        await sign.click(); await currentSign(page);
        const pending = page.getByRole('button', { name: 'Confirming…', exact: true });
        expect(await pending.isDisabled()).toBe(true);
        if (evidence) await page.screenshot({ path: join(evidence, `agreement-pending-mobile-${dark ? 'dark' : 'light'}.png`), fullPage: true });
        await configure(page, { mode: 'clauses' });
        await draw(page, page.getByRole('application', { name: 'Initials for clause 1' }));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        if (evidence) await page.screenshot({ path: join(evidence, `clause-initials-mobile-${dark ? 'dark' : 'light'}.png`), fullPage: true });
      } finally { await page.close(); }
    }
  }, TIMEOUT);
});
