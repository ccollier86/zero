/** Exercises shared server-query controls and acknowledged detail writes with synthetic data. */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import {
  acquirePlaywrightTestBrowser,
  playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';

type TestRow = { id?: string; order_id?: number; name: string };
declare global {
  interface Window {
    __masterDetailHarness: {
      queries: Array<{ search: string; sorting: Array<{ id: string }>; pagination: { mode: string; pageIndex: number; pageSize: number; cursor?: string | null } }>;
      settle(index: number, rows: TestRow[], hasMore?: boolean): void;
      aborted(index: number): boolean;
      configure(mode: string, table?: string): void;
      errors: string[];
      writes: number;
      customWrites: number;
      accept(): void;
      reject(): void;
      update(): Promise<void>;
      retain(): void;
      retainedUpdate(): Promise<string | null>;
      selected(): string | null;
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
  const component = JSON.stringify(`${import.meta.dir}/master-detail-page.tsx`);
  const schemaPath = JSON.stringify(`${import.meta.dir}/../../schema/index.ts`);
  const contents = `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {MasterDetailPage} from ${component};
    import {defineSchema,field} from ${schemaPath};
    const schema=defineSchema({name:field.text({label:'Name',required:true})});
    const pending=new Map();
    let context,retained,accept,reject;
    const records=[{id:'record-1',name:'Before'}];
    const harness=window.__masterDetailHarness={queries:[], errors:[], writes:0, customWrites:0,
      aborted:index=>pending.get(index)?.signal.aborted??false,
      settle(index,rows,hasMore=false){const query=harness.queries[index];pending.get(index)?.resolve({rows,page:query.pagination.mode==='cursor'
        ?{mode:'cursor',hasMore,nextCursor:hasMore?'next-'+query.pagination.pageIndex:null}
        :{mode:'offset',hasMore,offset:query.pagination.pageIndex*query.pagination.pageSize}});},
      accept:()=>accept(),reject:()=>reject(new Error('Write rejected')),
      update:()=>context.update({name:'From context'}),
      retain:()=>retained=context,
      async retainedUpdate(){try{await retained.update({name:'Stale context'});return null;}catch(error){return error.code??error.message;}},
      selected:()=>context?.selectedId??null
    };
    const adapter={query(query,{signal}){const index=harness.queries.push(structuredClone(query))-1;return new Promise(resolve=>pending.set(index,{signal,resolve}));}};
    const numericId=row=>row.order_id;
    const write=()=>{harness.writes++;return new Promise((resolve,rejectWrite)=>{accept=resolve;reject=rejectWrite;});};
    const customWrite=()=>{harness.customWrites++;return write();};
    function Harness(){
      const [configuration,setConfiguration]=useState({mode:'server',table:'records'});
      harness.configure=(mode,table='records')=>setConfiguration({mode,table});
      const {mode,table}=configuration;
      const source=['server','cursor','numeric'].includes(mode)
        ?{type:'server',table,adapter,pagination:mode==='cursor'?'cursor':'offset',...(mode==='numeric'?{getRowId:numericId}:{})}
        :{type:'data',data:records,...(mode==='readonly'?{}:{actions:{update:write}})};
      return <MasterDetailPage schema={schema} listColumns={['name']} source={source}
        searchable={{fields:['name'],ariaLabel:'Search records'}} paginated={{pageSize:2}}
        onUpdate={mode==='custom'?customWrite:undefined} onUpdateError={error=>harness.errors.push(error)}
        detailFooter={(_item,next)=>{context=next;return <span data-testid='selected'>selected:{next.selectedId??'none'}</span>;}}/>;
    }
    createRoot(document.getElementById('root')).render(<Harness/>);
  `;
  const result = await Bun.build({
    entrypoints: ['master-detail-test:fixture'], target: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': JSON.stringify('test') },
    plugins: [{
      name: 'in-memory-master-detail-fixture',
      setup(build) {
        build.onResolve({ filter: /^master-detail-test:/ }, () => ({ path: 'fixture', namespace: 'master-detail-test' }));
        build.onLoad({ filter: /.*/, namespace: 'master-detail-test' }, () => ({ contents, loader: 'tsx', resolveDir: process.cwd() }));
      },
    }],
  });
  if (!result.success) throw new Error(result.logs.map((entry) => entry.message).join('\n'));
  bundle = await result.outputs[0]!.text();
}, 60_000);

afterAll(() => lease?.release());

async function mount(): Promise<Page> {
  if (!browser) throw new Error('Browser unavailable');
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => window.__masterDetailHarness?.queries.length > 0);
  return page;
}

async function settle(page: Page, rows: TestRow[], hasMore = false): Promise<void> {
  await page.evaluate(({ rows, hasMore }) => {
    const harness = window.__masterDetailHarness;
    harness.settle(harness.queries.length - 1, rows, hasMore);
  }, { rows, hasMore });
  await page.locator('tbody').getByText(rows[0]!.name, { exact: true }).waitFor();
}

describe('MasterDetail query and acceptance contracts', () => {
  browserTest('connects search to the server while loading and does not filter accepted pages again', async () => {
    const page = await mount();
    try {
      const search = page.getByRole('searchbox', { name: 'Search records' });
      await search.waitFor({ timeout: 1_000 });
      expect(await page.evaluate(() => window.__masterDetailHarness.queries[0]!.pagination.pageSize)).toBe(2);
      await search.fill('Ada');
      await page.waitForFunction(() => window.__masterDetailHarness.queries.at(-1)?.search === 'Ada', undefined, { timeout: 1_000 });
      expect(await page.evaluate(() => window.__masterDetailHarness.aborted(0))).toBe(true);
      await settle(page, [{ id: '2', name: 'Server result outside local search' }]);
      expect(await page.locator('tbody').getByText('Server result outside local search', { exact: true }).count()).toBe(1);
      await page.evaluate(() => window.__masterDetailHarness.settle(0, [{ id: '1', name: 'Late private result' }]));
      expect(await page.getByText('Late private result', { exact: true }).count()).toBe(0);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('drives offset pagination and server sorting without an exact count', async () => {
    const page = await mount();
    try {
      await settle(page, [{ id: '1', name: 'one' }, { id: '2', name: 'two' }], true);
      expect(await page.getByLabel('Last page').count()).toBe(0);
      await page.getByLabel('Next page').click({ timeout: 1_000 });
      await page.waitForFunction(() => window.__masterDetailHarness.queries.at(-1)?.pagination.pageIndex === 1, undefined, { timeout: 1_000 });
      await settle(page, [{ id: '3', name: 'three' }, { id: '4', name: 'four' }]);
      expect(await page.getByText('Showing 3-4', { exact: true }).count()).toBe(1);
      expect(await page.evaluate(() => window.__masterDetailHarness.selected())).toBe('3');
      await page.getByRole('button', { name: 'Name', exact: true }).click();
      await page.waitForFunction(() => {
        const query = window.__masterDetailHarness.queries.at(-1);
        return query?.pagination.pageIndex === 0 && query.sorting[0]?.id === 'name';
      }, undefined, { timeout: 1_000 });
    } finally { await page.close(); }
  }, 30_000);

  browserTest('uses opaque cursor history and clears details on a source replacement', async () => {
    const page = await mount();
    try {
      await page.evaluate(() => window.__masterDetailHarness.configure('cursor'));
      await page.waitForFunction(() => window.__masterDetailHarness.queries.at(-1)?.pagination.mode === 'cursor');
      await settle(page, [{ id: '1', name: 'Cursor first' }], true);
      await page.getByLabel('Next page').click({ timeout: 1_000 });
      await page.waitForFunction(() => window.__masterDetailHarness.queries.at(-1)?.pagination.cursor === 'next-0', undefined, { timeout: 1_000 });
      await settle(page, [{ id: '2', name: 'Cursor second' }]);
      await page.evaluate(() => window.__masterDetailHarness.configure('cursor', 'other_records'));
      await page.waitForFunction(() => window.__masterDetailHarness.selected() === null);
      expect(await page.getByText('Cursor second', { exact: true }).count()).toBe(0);
      expect(await page.evaluate(() => window.__masterDetailHarness.queries.at(-1)?.pagination)).toMatchObject({ pageIndex: 0, cursor: null });
      await settle(page, [{ id: '2', name: 'Replacement own row' }]);
      expect(await page.evaluate(() => window.__masterDetailHarness.selected())).toBe('2');
    } finally { await page.close(); }
  }, 30_000);

  browserTest('awaits generated detail writes and exposes rejection instead of premature completion', async () => {
    const page = await mount();
    try {
      await page.evaluate(() => window.__masterDetailHarness.configure('data'));
      const input = page.locator('input[name="name"]');
      await input.waitFor();
      await input.fill('After');
      await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
      await page.waitForFunction(() => window.__masterDetailHarness.writes === 1);
      expect(await page.getByRole('button', { name: 'Save Changes', exact: true }).isDisabled()).toBe(true);
      await page.evaluate(() => window.__masterDetailHarness.reject());
      await page.waitForFunction(() => window.__masterDetailHarness.errors.length === 1);
      expect(await page.evaluate(() => window.__masterDetailHarness.errors)).toEqual(['Write rejected']);
      expect(await page.getByRole('button', { name: 'Save Changes', exact: true }).isEnabled()).toBe(true);
      await page.evaluate(() => window.__masterDetailHarness.configure('custom'));
      await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
      await page.waitForFunction(() => window.__masterDetailHarness.customWrites === 1);
      expect(await page.getByRole('button', { name: 'Save Changes', exact: true }).isDisabled()).toBe(true);
      await page.evaluate(() => window.__masterDetailHarness.accept());
      await page.getByRole('button', { name: 'Save Changes', exact: true }).waitFor();
    } finally { await page.close(); }
  }, 30_000);

  browserTest('propagates context-update rejection and rejects missing writers or retained source contexts', async () => {
    const page = await mount();
    try {
      await page.evaluate(() => window.__masterDetailHarness.configure('data'));
      await page.locator('input[name="name"]').waitFor();
      await page.evaluate(() => {
        void window.__masterDetailHarness.update().catch((error) => window.__masterDetailHarness.errors.push(error.message));
      });
      await page.waitForFunction(() => window.__masterDetailHarness.writes === 1);
      await page.evaluate(() => window.__masterDetailHarness.reject());
      await page.waitForFunction(() => window.__masterDetailHarness.errors.length === 1);
      await page.evaluate(() => window.__masterDetailHarness.retain());
      await page.evaluate(() => window.__masterDetailHarness.configure('server', 'other_records'));
      await page.waitForFunction(() => window.__masterDetailHarness.selected() === null);
      expect(await page.evaluate(() => window.__masterDetailHarness.retainedUpdate())).toBe('DATA_TABLE_MUTATION_SCOPE_UNAVAILABLE');
      expect(await page.evaluate(() => window.__masterDetailHarness.writes)).toBe(1);
      await page.evaluate(() => window.__masterDetailHarness.configure('readonly'));
      await page.locator('input[name="name"]').waitFor();
      await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
      await page.waitForFunction(() => window.__masterDetailHarness.errors.length === 2);
      expect(await page.evaluate(() => window.__masterDetailHarness.errors[1])).toBe('This table source does not provide a update operation.');
    } finally { await page.close(); }
  }, 30_000);

  browserTest('uses the same numeric custom server identity for the table and selected detail', async () => {
    const page = await mount();
    try {
      await page.evaluate(() => window.__masterDetailHarness.configure('numeric'));
      await page.waitForFunction(() => window.__masterDetailHarness.queries.length > 1);
      await settle(page, [{ order_id: 42, name: 'Numeric record' }]);
      expect(await page.evaluate(() => window.__masterDetailHarness.selected())).toBe('42');
      expect(await page.locator('[data-testid="selected"]').textContent()).toBe('selected:42');
    } finally { await page.close(); }
  }, 30_000);

  browserTest('fences context completion when its source changes during a pending accepted write', async () => {
    const page = await mount();
    try {
      await page.evaluate(() => window.__masterDetailHarness.configure('data'));
      await page.locator('input[name="name"]').waitFor();
      await page.evaluate(() => {
        void window.__masterDetailHarness.update().catch((error) => window.__masterDetailHarness.errors.push(error.code));
      });
      await page.waitForFunction(() => window.__masterDetailHarness.writes === 1);
      await page.evaluate(() => window.__masterDetailHarness.configure('server', 'replacement_records'));
      await page.waitForFunction(() => window.__masterDetailHarness.selected() === null);
      await page.evaluate(() => window.__masterDetailHarness.accept());
      await page.waitForFunction(() => window.__masterDetailHarness.errors.length === 1);
      expect(await page.evaluate(() => window.__masterDetailHarness.errors)).toEqual(['DATA_TABLE_MUTATION_SCOPE_UNAVAILABLE']);
      expect(await page.evaluate(() => window.__masterDetailHarness.writes)).toBe(1);
    } finally { await page.close(); }
  }, 30_000);
});
