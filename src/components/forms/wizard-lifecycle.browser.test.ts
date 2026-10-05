/** Exercises real React rerenders without app config, transport, or live data. */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import {
  acquirePlaywrightTestBrowser,
  playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined;
let browser: Browser | undefined;
let bundle = '';

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser();
  browser = lease.browser;
  const wizardPath = JSON.stringify(`${import.meta.dir}/wizard.tsx`);
  const schemaPath = JSON.stringify(`${import.meta.dir}/../../schema/index.ts`);
  const contents = `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {Wizard} from ${wizardPath};
    import {defineSchema, field} from ${schemaPath};
    const initialSchema = defineSchema({first:field.text(),second:field.text(),third:field.text()});
    const replacementSchema = defineSchema({first:field.text(),second:field.text(),third:field.text()});
    function Harness(){
      const [schema,setSchema]=useState(initialSchema);
      const [steps,setSteps]=useState([
        {title:'First',fields:['first']},
        {title:'Second',fields:['second']},
        {title:'Third',fields:['third']}
      ]);
      return <>
        <button onClick={()=>setSteps([{title:'First',fields:['first']}])}>Shrink steps</button>
        <button onClick={()=>setSteps(steps.map(step=>({...step,fields:[...step.fields]})))}>Clone steps</button>
        <button onClick={()=>setSchema(replacementSchema)}>Replace schema</button>
        <Wizard schema={schema} steps={steps} onComplete={()=>{}}/>
      </>;
    }
    createRoot(document.getElementById('root')).render(<Harness/>);
  `;
  const result = await Bun.build({
    entrypoints: ['wizard-test:fixture'], target: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': JSON.stringify('test') },
    plugins: [{
      name: 'in-memory-wizard-fixture',
      setup(build) {
        build.onResolve({ filter: /^wizard-test:/ }, () => ({ path: 'fixture', namespace: 'wizard-test' }));
        build.onLoad({ filter: /.*/, namespace: 'wizard-test' }, () => ({
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
  await page.getByRole('heading', { name: 'First', exact: true }).waitFor();
  return page;
}

describe('Wizard dynamic step lifecycle', () => {
  browserTest('reconciles a shrinking step list without remounting or crashing', async () => {
    const page = await openHarness();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await page.getByRole('heading', { name: 'Second', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await page.getByRole('heading', { name: 'Third', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Shrink steps', exact: true }).click();
      await page.getByRole('heading', { name: 'First', exact: true }).waitFor({ timeout: 5000 });
      expect(errors).toEqual([]);
      expect(await page.locator('[data-slot="wizard"]').count()).toBe(1);
      expect(await page.getByRole('button', { name: 'Complete', exact: true }).count()).toBe(1);
    } finally {
      await page.close();
    }
  }, 30_000);

  browserTest('retains navigation and values for equivalent step arrays', async () => {
    const page = await openHarness();
    try {
      await page.getByRole('textbox').fill('Preserved');
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await page.getByRole('heading', { name: 'Second', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Clone steps', exact: true }).click();
      expect(await page.getByRole('heading', { name: 'Second', exact: true }).count()).toBe(1);
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('input')?.value === 'Preserved');
      expect(await page.getByRole('textbox').inputValue()).toBe('Preserved');
    } finally {
      await page.close();
    }
  }, 30_000);

  browserTest('resets navigation and completion when the schema is replaced', async () => {
    const page = await openHarness();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await page.getByRole('heading', { name: 'Second', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Replace schema', exact: true }).click();
      await page.getByRole('heading', { name: 'First', exact: true }).waitFor();
      expect(await page.getByRole('button', { name: 'Back', exact: true }).isEnabled()).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30_000);
});
