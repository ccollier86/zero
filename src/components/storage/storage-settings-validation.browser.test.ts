/** Isolated existing component; no app configuration/provider/storage is opened. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Browser } from 'playwright';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = test;
let directory: string | undefined;
let browser: Browser | undefined, lease: PlaywrightTestBrowserLease | undefined, bundle = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) throw new Error('Storage visibility acceptance requires the existing Chromium fixture browser.');
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform'; await mkdir(scratch,{recursive:true});
  directory = await mkdtemp(join(scratch,'storage-settings-')); const builder=join(directory,'build.ts');
  await Bun.write(builder,`const build=await Bun.build({entrypoints:[${JSON.stringify(join(import.meta.dir,'storage-settings-validation.browser-fixture.tsx'))}],
    target:'browser',format:'iife',outdir:${JSON.stringify(directory)},naming:'bundle.js',define:{'process.env.NODE_ENV':'"test"'}});
    if(!build.success){console.error(build.logs.map(log=>log.message).join('\\n'));process.exit(1)}`);
  const build=Bun.spawn({cmd:[process.execPath,'--no-env-file',builder],cwd:process.cwd(),stdout:'pipe',stderr:'pipe'});
  const [stdout,stderr,status]=await Promise.all([new Response(build.stdout).text(),new Response(build.stderr).text(),build.exited]);
  if(status!==0)throw new Error(`${stdout}\n${stderr}`);
  bundle=await Bun.file(join(directory,'bundle.js')).text();
  lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
});
afterAll(async()=>{try{if(directory)await rm(directory,{recursive:true,force:true})}finally{lease?.release()}});

browserTest('malformed limits never dispatch unlimited settings; explicit empty/zero remains supported', async () => {
  const page = await browser!.newPage();
  try {
    await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle });
    const limit = page.getByLabel('Drive limit', { exact: true });
    await limit.waitFor();
    for (const invalid of ['not bytes', '-1', '1.5', '9007199254740992']) {
      await limit.fill(invalid); await page.getByRole('button', { name: 'Save settings', exact: true }).click();
      expect(await page.getByRole('status', { name: 'Save result', exact: true }).textContent()).toBe('No mutation');
    }
    await limit.fill(''); await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    const saved = await page.getByRole('status', { name: 'Save result', exact: true }).textContent();
    expect(JSON.parse(saved!).max_size_bytes).toBe(0);
    expect(JSON.parse(saved!).max_file_size_bytes).toBe(100);
  } finally { await page.close(); }
});

browserTest('parent-reported rejected saves remain failed without unhandled browser rejection', async () => {
  const page = await browser!.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle });
    const save = page.getByRole('button', { name: 'Save settings', exact: true });
    await save.waitFor();
    await page.getByRole('button', { name: 'Reject next save', exact: true }).click();
    await save.click();
    expect(await page.getByRole('status', { name: 'Save result', exact: true }).textContent()).toBe('Server rejected');
    expect(await save.isEnabled()).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

browserTest('public visibility is explicit, policy-gated and can always remediate an existing public flag', async()=>{
  const page=await browser!.newPage();page.setDefaultTimeout(4_000);
  try{
    await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle});
    const driveVisibility=page.getByRole('combobox',{name:'Drive visibility',exact:true});await driveVisibility.waitFor();
    const fileSharing=page.getByRole('region',{name:'File sharing fixture'});
    await page.getByRole('button',{name:'Disable public policy',exact:true}).click();
    expect(await driveVisibility.isVisible()).toBe(true);expect(await driveVisibility.isDisabled()).toBe(true);
    expect(await fileSharing.getByRole('button',{name:'Make public',exact:true}).isDisabled()).toBe(true);
    expect(await page.getByText('Public files are disabled by this app’s storage policy.',{exact:false}).isVisible()).toBe(true);
    await page.getByRole('button',{name:'Enable public policy',exact:true}).click();
    expect(await driveVisibility.isEnabled()).toBe(true);
    await driveVisibility.click();await page.getByRole('option',{name:'Public read',exact:true}).click();
    await page.getByRole('button',{name:'Save settings',exact:true}).click();
    expect(JSON.parse((await page.getByRole('status',{name:'Save result',exact:true}).textContent())!).public).toBe('1');
    await fileSharing.getByRole('button',{name:'Make public',exact:true}).click();
    expect(await fileSharing.getByRole('button',{name:'Make private',exact:true}).isEnabled()).toBe(true);
    await page.getByRole('button',{name:'Disable public policy',exact:true}).click();
    await fileSharing.getByRole('button',{name:'Make private',exact:true}).click();
    expect(await page.getByRole('status',{name:'Visibility writes',exact:true}).textContent()).toBe('2');
    await page.getByRole('button',{name:'Seed public drive',exact:true}).click();
    expect(await driveVisibility.isEnabled()).toBe(true);
    expect(await fileSharing.getByRole('button',{name:'Drive is public',exact:true}).isDisabled()).toBe(true);
    expect(await fileSharing.getByText(/Make the drive private before restricting this object/).isVisible()).toBe(true);
    await driveVisibility.click();await page.getByRole('option',{name:'Private',exact:true}).click();
    await page.getByRole('button',{name:'Save settings',exact:true}).click();
    expect(JSON.parse((await page.getByRole('status',{name:'Save result',exact:true}).textContent())!).public).toBe('0');
  }finally{await page.close()}
});
