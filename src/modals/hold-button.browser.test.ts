/** Verifies hold confirmation lifecycle with a deterministic browser frame clock. */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import {
  acquirePlaywrightTestBrowser,
  playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../test-support/playwright-test-browser';

declare global {
  interface Window {
    __holdButtonHarness: {
      advance(milliseconds: number): void;
      unmount(): void;
      confirmations(): number;
      pendingFrames(): number;
      replaceAction(): void;
      replaceDuration(milliseconds: number): void;
      replacementConfirmations(): number;
      shiftWallClock(milliseconds: number): void;
    };
  }
}

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined;
let browser: Browser | undefined;
let bundle = '';

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser();
  browser = lease.browser;
  const holdButtonPath = JSON.stringify(`${import.meta.dir}/hold-button.tsx`);
  const contents = `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {HoldButton} from ${holdButtonPath};
    let now=0, wallClockOffset=0, nextFrame=0, confirmations=0, replacementConfirmations=0;
    const frames=new Map();
    Date.now=()=>now+wallClockOffset;
    Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
    window.requestAnimationFrame=callback=>{const id=++nextFrame;frames.set(id,callback);return id;};
    window.cancelAnimationFrame=id=>frames.delete(id);
    const root=createRoot(document.getElementById('root'));
    window.__holdButtonHarness={
      advance(milliseconds){now+=milliseconds;const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback(now));},
      unmount(){root.unmount();},
      confirmations(){return confirmations;},
      replacementConfirmations(){return replacementConfirmations;},
      shiftWallClock(milliseconds){wallClockOffset+=milliseconds;},
      pendingFrames(){return frames.size;}
    };
    const originalAction=()=>confirmations++;
    const replacementAction=()=>replacementConfirmations++;
    function Harness(){
      const [action,setAction]=useState(()=>originalAction);
      const [duration,setDuration]=useState(200);
      window.__holdButtonHarness.replaceAction=()=>setAction(()=>replacementAction);
      window.__holdButtonHarness.replaceDuration=milliseconds=>setDuration(milliseconds);
      return <HoldButton holdDuration={duration} label='Hold to Confirm' holdingLabel='Confirming' onConfirm={action}/>;
    }
    root.render(<Harness/>);
  `;
  const result = await Bun.build({
    entrypoints: ['hold-test:fixture'], target: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': JSON.stringify('test') },
    plugins: [{
      name: 'in-memory-hold-fixture',
      setup(build) {
        build.onResolve({ filter: /^hold-test:/ }, () => ({ path: 'fixture', namespace: 'hold-test' }));
        build.onLoad({ filter: /.*/, namespace: 'hold-test' }, () => ({
          contents, loader: 'tsx', resolveDir: process.cwd(),
        }));
      },
    }],
  });
  if (!result.success) throw new Error(result.logs.map((entry) => entry.message).join('\n'));
  bundle = await result.outputs[0]!.text();
}, 60_000);

afterAll(() => lease?.release());

async function openHarness(): Promise<Page> {
  if (!browser) throw new Error('Browser unavailable');
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'Hold to Confirm', exact: true }).waitFor();
  return page;
}

describe('HoldButton confirmation lifecycle', () => {
  browserTest('completes a pointer hold exactly once, even with repeated starts', async () => {
    const page = await openHarness();
    try {
      const button = page.locator('button');
      await button.dispatchEvent('pointerdown', { button: 0, isPrimary: true });
      await button.dispatchEvent('pointerdown', { button: 0, isPrimary: true });
      expect(await page.evaluate(() => window.__holdButtonHarness.pendingFrames())).toBe(1);
      await page.evaluate(() => window.__holdButtonHarness.advance(200));
      expect(await page.evaluate(() => window.__holdButtonHarness.confirmations())).toBe(1);
      await page.evaluate(() => window.__holdButtonHarness.advance(200));
      expect(await page.evaluate(() => window.__holdButtonHarness.confirmations())).toBe(1);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('cancels pending confirmation when unmounted', async () => {
    const page = await openHarness();
    try {
      await page.locator('button').dispatchEvent('pointerdown', { button: 0, isPrimary: true });
      await page.evaluate(() => window.__holdButtonHarness.unmount());
      expect(await page.evaluate(() => window.__holdButtonHarness.pendingFrames())).toBe(0);
      await page.evaluate(() => window.__holdButtonHarness.advance(200));
      expect(await page.evaluate(() => window.__holdButtonHarness.confirmations())).toBe(0);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('cancels a browser pointer cancellation', async () => {
    const page = await openHarness();
    try {
      await page.locator('button').dispatchEvent('pointerdown', { button: 0, isPrimary: true });
      await page.locator('button').dispatchEvent('pointercancel');
      await page.evaluate(() => window.__holdButtonHarness.advance(200));
      expect(await page.evaluate(() => window.__holdButtonHarness.confirmations())).toBe(0);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('ignores a secondary pointer button', async () => {
    const page = await openHarness();
    try {
      await page.locator('button').dispatchEvent('pointerdown', { button: 2, isPrimary: true });
      await page.evaluate(() => window.__holdButtonHarness.advance(200));
      expect(await page.evaluate(() => window.__holdButtonHarness.confirmations())).toBe(0);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('supports sustained Space and Enter without key-repeat restarts', async () => {
    const page = await openHarness();
    try {
      await page.locator('button').focus();
      await page.keyboard.down('Space');
      await page.evaluate(() => window.__holdButtonHarness.advance(100));
      await page.keyboard.down('Space');
      await page.evaluate(() => window.__holdButtonHarness.advance(100));
      expect(await page.evaluate(() => window.__holdButtonHarness.confirmations())).toBe(1);
      await page.keyboard.up('Space');
      await page.keyboard.down('Enter');
      await page.evaluate(() => window.__holdButtonHarness.advance(200));
      expect(await page.evaluate(() => window.__holdButtonHarness.confirmations())).toBe(2);
      await page.keyboard.up('Enter');
    } finally { await page.close(); }
  }, 30_000);

  browserTest('cancels early keyboard release and blur', async () => {
    const page = await openHarness();
    try {
      await page.locator('button').focus();
      await page.keyboard.down('Space');
      await page.keyboard.up('Space');
      await page.evaluate(() => window.__holdButtonHarness.advance(200));
      expect(await page.evaluate(() => window.__holdButtonHarness.confirmations())).toBe(0);
      await page.keyboard.down('Enter');
      await page.locator('button').evaluate((button) => button.blur());
      await page.evaluate(() => window.__holdButtonHarness.advance(200));
      expect(await page.evaluate(() => window.__holdButtonHarness.confirmations())).toBe(0);
      await page.keyboard.up('Enter');
    } finally { await page.close(); }
  }, 30_000);

  browserTest('cancels pointer release and pointer leave before the duration', async () => {
    const page = await openHarness();
    try {
      for (const cancellation of ['pointerup', 'pointerleave']) {
        await page.locator('button').dispatchEvent('pointerdown', { button: 0, isPrimary: true });
        await page.evaluate(() => window.__holdButtonHarness.advance(100));
        if (cancellation === 'pointerleave') {
          // React synthesizes onPointerLeave from the browser's pointerout.
          await page.locator('button').evaluate((button) => button.dispatchEvent(
            new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }),
          ));
        } else {
          await page.locator('button').dispatchEvent(cancellation);
        }
        expect(await page.evaluate(() => window.__holdButtonHarness.pendingFrames())).toBe(0);
        await page.evaluate(() => window.__holdButtonHarness.advance(200));
        expect(await page.evaluate(() => window.__holdButtonHarness.confirmations())).toBe(0);
      }
    } finally { await page.close(); }
  }, 30_000);

  browserTest('cancels when the browser window loses focus', async () => {
    const page = await openHarness();
    try {
      await page.locator('button').dispatchEvent('pointerdown', { button: 0, isPrimary: true });
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.evaluate(() => window.__holdButtonHarness.advance(200));
      expect(await page.evaluate(() => window.__holdButtonHarness.confirmations())).toBe(0);
      expect(await page.evaluate(() => window.__holdButtonHarness.pendingFrames())).toBe(0);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('cancels before a hidden document can resume a throttled frame', async () => {
    const page = await openHarness();
    try {
      await page.locator('button').dispatchEvent('pointerdown', { button: 0, isPrimary: true });
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(await page.evaluate(() => window.__holdButtonHarness.pendingFrames())).toBe(0);
      await page.evaluate(() => window.__holdButtonHarness.advance(200));
      expect(await page.evaluate(() => window.__holdButtonHarness.confirmations())).toBe(0);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('cancels the pending hold when its action or duration changes', async () => {
    const page = await openHarness();
    try {
      await page.locator('button').dispatchEvent('pointerdown', { button: 0, isPrimary: true });
      await page.evaluate(() => window.__holdButtonHarness.replaceAction());
      await page.waitForFunction(() => window.__holdButtonHarness.pendingFrames() === 0);
      await page.evaluate(() => window.__holdButtonHarness.advance(200));
      expect(await page.evaluate(() => window.__holdButtonHarness.confirmations())).toBe(0);
      expect(await page.evaluate(() => window.__holdButtonHarness.replacementConfirmations())).toBe(0);

      await page.locator('button').dispatchEvent('pointerdown', { button: 0, isPrimary: true });
      await page.evaluate(() => window.__holdButtonHarness.replaceDuration(400));
      await page.waitForFunction(() => window.__holdButtonHarness.pendingFrames() === 0);
      await page.evaluate(() => window.__holdButtonHarness.advance(400));
      expect(await page.evaluate(() => window.__holdButtonHarness.replacementConfirmations())).toBe(0);

      await page.locator('button').dispatchEvent('pointerdown', { button: 0, isPrimary: true });
      await page.evaluate(() => window.__holdButtonHarness.advance(399));
      expect(await page.evaluate(() => window.__holdButtonHarness.replacementConfirmations())).toBe(0);
      await page.evaluate(() => window.__holdButtonHarness.advance(1));
      expect(await page.evaluate(() => window.__holdButtonHarness.replacementConfirmations())).toBe(1);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('measures hold duration independently of wall-clock adjustments', async () => {
    const page = await openHarness();
    try {
      await page.locator('button').dispatchEvent('pointerdown', { button: 0, isPrimary: true });
      await page.evaluate(() => {
        window.__holdButtonHarness.advance(100);
        window.__holdButtonHarness.shiftWallClock(60_000);
        window.__holdButtonHarness.advance(1);
      });
      expect(await page.evaluate(() => window.__holdButtonHarness.confirmations())).toBe(0);
      await page.evaluate(() => {
        window.__holdButtonHarness.shiftWallClock(-120_000);
        window.__holdButtonHarness.advance(99);
      });
      expect(await page.evaluate(() => window.__holdButtonHarness.confirmations())).toBe(1);
    } finally { await page.close(); }
  }, 30_000);
});
