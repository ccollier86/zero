/** Install the actual archive, then exercise only public component/schema imports in Chromium. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable } from '../../test-support/playwright-test-browser';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;

browserTest('packed DataTableView and MasterDetail preserve their stable source through public key/context refresh', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'table-refresh-package-'));
  const consumer = join(root, 'consumer'), archive = join(root, 'framework.tgz');
  const lease = await acquirePlaywrightTestBrowser();
  try {
    await mkdir(consumer);
    const supplied = process.env.ZERO_UI_QUALIFICATION_ARCHIVE;
    if (supplied) await Bun.write(archive, Bun.file(supplied));
    else await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], process.cwd());
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({ name: 'zero-table-refresh-proof', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4' } }));
    await Bun.write(join(consumer, 'entry.tsx'), FIXTURE);
    await checked(['install', '--ignore-scripts'], consumer);
    await checked(['build', 'entry.tsx', '--target=browser', '--format=iife', '--outdir', 'output', '--entry-naming', 'bundle-[hash].[ext]'], consumer);
    const output = join(consumer, 'output'), bundle = (await readdir(output)).find(file => file.endsWith('.js'))!;
    for (const mode of ['table', 'detail']) {
      const page = await lease.browser.newPage();
      page.setDefaultTimeout(10_000);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.setContent('<div id="root"></div>');
        await page.addScriptTag({ path: join(output, bundle) });
        if (mode === 'detail') await page.getByRole('button', { name: 'Use master detail', exact: true }).click();
        await page.locator('tbody').getByText('Original joined row', { exact: true }).waitFor();
        if (mode === 'table') await page.getByLabel('Select row', { exact: true }).click();
        const before = await page.locator('[data-testid="queries"]').textContent();
        await page.getByRole('button', { name: 'External accepted action', exact: true }).click();
        await page.locator('tbody').getByText('After external action', { exact: true }).waitFor();
        expect(Number(await page.locator('[data-testid="queries"]').textContent())).toBe(Number(before) + 1);
        if (mode === 'table') expect(await page.getByLabel('Select row', { exact: true }).getAttribute('aria-checked')).toBe('true');
        else expect(await page.locator('[data-testid="selected"]').textContent()).toBe('record');
        await page.getByRole('button', { name: 'Context refresh', exact: true }).click();
        await page.locator('tbody').getByText('After context action', { exact: true }).waitFor();
        await page.waitForFunction(() => document.querySelector('[data-testid="completions"]')?.textContent === '1', undefined, { timeout: 10_000 });
        if (mode === 'detail') {
          await page.getByRole('button', { name: 'Detail accepted edit', exact: true }).click();
          await page.locator('tbody').getByText('After detail edit', { exact: true }).waitFor();
          expect(await page.locator('[data-testid="selected"]').textContent()).toBe('record');
        }
        expect(await page.getByText(/new records/i).count()).toBe(0);
      } catch (error) { throw new Error(`Packed ${mode} refresh failed: ${String(error)}. Browser errors: ${errors.join('; ')}`); }
      finally { await page.close(); }
    }
    const docs = await Bun.file(join(consumer, 'node_modules/@zero/framework/docs-next/frontend/data-controls/data-table/server-sources.md')).text();
    expect(docs).toContain('refreshKey'); expect(docs).toContain('refresh(): Promise<void>');
  } finally { lease.release(); await rm(root, { recursive: true, force: true }); }
}, 240_000);

async function checked(args: string[], cwd: string): Promise<void> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], { cwd, stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH, TMPDIR: SCRATCH, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' } });
  const timer = setTimeout(() => child.kill(), 120_000);
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(`Public table consumer failed (${code}): ${stdout}\n${stderr}`);
  } finally { clearTimeout(timer); }
}

const FIXTURE = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DataTable, DataTableView } from '@zero/framework/components/data-table';
import { MasterDetailPage, MasterDetailView } from '@zero/framework/components/master-detail';
import { defineSchema, field } from '@zero/framework/schema';
if(DataTable!==DataTableView||MasterDetailPage!==MasterDetailView)throw new Error('Public alias mismatch');
const schema=defineSchema({name:field.text()});
let name='Original joined row', publish, calls=0;
const adapter={async query(query){calls++;publish(calls);return {rows:[{id:'record',name}],page:{mode:'offset',offset:0,hasMore:false,total:1}};}};
const source={type:'server',table:'joined_records',adapter,prefetch:false};
function Fixture(){
  const [detail,setDetail]=useState(false),[key,setKey]=useState(0),[queries,setQueries]=useState(0),[completions,setCompletions]=useState(0);
  publish=setQueries;
  const actions=({refresh})=><button onClick={async()=>{name='After context action';await refresh();setCompletions(value=>value+1);}}>Context refresh</button>;
  return <><button onClick={()=>{name='Original joined row';setDetail(true);}}>Use master detail</button>
    <button onClick={()=>{name='After external action';setKey(value=>value+1);}}>External accepted action</button>
    <output data-testid='queries'>{queries}</output><output data-testid='completions'>{completions}</output>
    {detail?<MasterDetailView schema={schema} source={source} listColumns={['name']} refreshKey={key}
      tableToolbarSlots={{actions}} onUpdate={async()=>{name='After detail edit';}}
      renderDetail={(item,context)=><><span data-testid='selected'>{context.selectedId}</span><button onClick={()=>context.update({name:'After detail edit'})}>Detail accepted edit</button></>}/>
      :<DataTableView schema={schema} source={source} columns={['name']} refreshKey={key} selectable toolbarSlots={{actions}}/>}
  </>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
