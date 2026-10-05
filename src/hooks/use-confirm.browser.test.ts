/** Verifies confirmation promise ownership in an isolated React browser fixture. */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import {
  acquirePlaywrightTestBrowser,
  playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined;
let browser: Browser | undefined;
let bundle = '';
const errors = new WeakMap<Page, string[]>();

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser();
  browser = lease.browser;
  const hookPath = JSON.stringify(`${import.meta.dir}/use-confirm.tsx`);
  const contents = `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {ConfirmProvider, useConfirm} from ${hookPath};
    const settlements=[];
    let retainedConfirm;
    const record=(name,promise)=>promise.then(value=>settlements.push({name,value}));
    function Requester(){
      const confirm=useConfirm();
      retainedConfirm=confirm;
      return <>
        <button onClick={()=>record('first',confirm({title:'First confirmation'}))}>First request</button>
        <button onClick={()=>{
          record('first',confirm({title:'First confirmation'}));
          record('second',confirm({title:'Second confirmation'}));
        }}>Two rapid requests</button>
      </>;
    }
    function Harness(){
      const [mounted,setMounted]=useState(true);
      window.__confirmHarness={
        settlements:()=>settlements,
        requestAfterUnmount:()=>record('retained',retainedConfirm({title:'Detached confirmation'})),
      };
      return <>
        <button onClick={()=>setMounted(false)}>Unmount provider</button>
        {mounted ? <ConfirmProvider><Requester/></ConfirmProvider> : <p>Provider removed</p>}
      </>;
    }
    createRoot(document.getElementById('root')).render(<Harness/>);
  `;
  const result = await Bun.build({
    entrypoints: ['confirm-test:fixture'], target: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': JSON.stringify('test') },
    plugins: [{
      name: 'in-memory-confirm-fixture',
      setup(build) {
        build.onResolve({ filter: /^confirm-test:/ }, () => ({ path: 'fixture', namespace: 'confirm-test' }));
        build.onLoad({ filter: /.*/, namespace: 'confirm-test' }, () => ({
          contents, loader: 'tsx', resolveDir: process.cwd(),
        }));
      },
    }],
  });
  if (!result.success) throw new Error(result.logs.map((entry) => entry.message).join('\n'));
  bundle = await result.outputs[0]!.text();
}, 60_000);

afterAll(() => lease?.release());

async function openHarness(reducedMotion: 'reduce' | 'no-preference' = 'no-preference'): Promise<Page> {
  if (!browser) throw new Error('Browser unavailable');
  const page = await browser.newPage({ reducedMotion });
  const pageErrors: string[] = [];
  errors.set(page, pageErrors);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'First request', exact: true }).waitFor();
  return page;
}

async function settlements(page: Page): Promise<Array<{ name: string; value: boolean }>> {
  return page.evaluate(() => (window as any).__confirmHarness.settlements());
}

describe('ConfirmProvider promise lifecycle', () => {
  browserTest('cancels a superseded request and settles the latest confirmation once', async () => {
    const page = await openHarness();
    try {
      await page.getByRole('button', { name: 'Two rapid requests', exact: true }).click();
      await page.getByRole('heading', { name: 'Second confirmation', exact: true }).waitFor();
      expect(await settlements(page)).toEqual([{ name: 'first', value: false }]);
      await page.getByRole('button', { name: 'Confirm', exact: true }).click();
      await page.waitForFunction(() => (window as any).__confirmHarness.settlements().length === 2);
      expect(await settlements(page)).toEqual([
        { name: 'first', value: false }, { name: 'second', value: true },
      ]);
      expect(errors.get(page)).toEqual([]);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('cancels pending confirmation on provider unmount', async () => {
    const page = await openHarness();
    try {
      await page.getByRole('button', { name: 'First request', exact: true }).click();
      await page.getByRole('heading', { name: 'First confirmation', exact: true }).waitFor();
      // External component lifecycle, not a real app action or data deletion.
      await page.evaluate(() => (document.querySelector('button') as HTMLButtonElement).click());
      await page.getByText('Provider removed', { exact: true }).waitFor();
      expect(await settlements(page)).toEqual([{ name: 'first', value: false }]);
      expect(errors.get(page)).toEqual([]);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('rejects a retained confirmation function after unmount without hanging', async () => {
    const page = await openHarness();
    try {
      await page.getByRole('button', { name: 'Unmount provider', exact: true }).click();
      await page.getByText('Provider removed', { exact: true }).waitFor();
      await page.evaluate(() => (window as any).__confirmHarness.requestAfterUnmount());
      expect(await settlements(page)).toEqual([{ name: 'retained', value: false }]);
      expect(await page.getByRole('alertdialog').count()).toBe(0);
      expect(errors.get(page)).toEqual([]);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('preserves ordinary cancellation and a later independent request', async () => {
    const page = await openHarness();
    try {
      await page.getByRole('button', { name: 'First request', exact: true }).click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('alertdialog').waitFor({ state: 'hidden', timeout: 10_000 });
      expect(await settlements(page)).toEqual([{ name: 'first', value: false }]);
      await page.waitForFunction(() => document.activeElement?.textContent === 'First request');
      expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('First request');
      expect(await page.evaluate(() => document.body.style.pointerEvents)).toBe('');
      await page.getByRole('button', { name: 'First request', exact: true }).click();
      await page.getByRole('button', { name: 'Confirm', exact: true }).click();
      await page.waitForFunction(() => (window as any).__confirmHarness.settlements().length === 2);
      expect(await settlements(page)).toEqual([
        { name: 'first', value: false }, { name: 'first', value: true },
      ]);
      expect(errors.get(page)).toEqual([]);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('retires content and releases pointer isolation with reduced motion', async () => {
    const page = await openHarness('reduce');
    try {
      await page.getByRole('button', { name: 'First request', exact: true }).click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('alertdialog').waitFor({ state: 'hidden', timeout: 10_000 });
      expect(await settlements(page)).toEqual([{ name: 'first', value: false }]);
      expect(await page.evaluate(() => document.body.style.pointerEvents)).toBe('');
      expect(errors.get(page)).toEqual([]);
    } finally { await page.close(); }
  }, 30_000);
});
