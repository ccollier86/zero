/** Styled browser qualification of the shared shell, portals, focus and acknowledged submit. */
import { beforeAll, afterAll, test, expect } from 'bun:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises'; // Bun has no directory/temp/removal API.
import { buildPlatformStyles } from '../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, type PlaywrightTestBrowserLease } from '../test-support/playwright-test-browser';

let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
beforeAll(async () => {
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/modal-browser-');
  try {
    const output = `${directory}/fixture.js`;
    const build = Bun.spawn([process.execPath,'--no-env-file','build',`${import.meta.dir}/modal-manager.browser-fixture.tsx`,
      '--target=browser','--format=iife','--outfile',output], { stdout:'pipe',stderr:'pipe',timeout:40_000 });
    const [code,stdout,stderr] = await Promise.all([build.exited,new Response(build.stdout).text(),new Response(build.stderr).text()]);
    if (code) throw new Error(`Modal fixture build failed: ${stderr || stdout}`);
    bundle = await Bun.file(output).text();
    css = await Bun.file((await buildPlatformStyles(directory,`${directory}/absent-app`)).cssPath).text();
  } finally { await rm(directory,{recursive:true,force:true}); }
  lease = await acquirePlaywrightTestBrowser();
},60_000);
afterAll(() => lease?.release());
async function open(width=1100,reduced=true,siblings=false) {
  const page=await lease!.browser.newPage({viewport:{width,height:800},reducedMotion:reduced?'reduce':'no-preference'});
  page.setDefaultTimeout(5000);
  await page.setContent(`<!doctype html><div id="root"${siblings ? ' data-siblings="true"' : ''}></div>`);
  await page.addStyleTag({content:css}); await page.addScriptTag({content:bundle});
  await page.getByRole('button',{name:siblings?'Open first owner':'Open content',exact:true}).waitFor(); return page;
}

test('standard shell reserves close controls, submits the exact owned native form and restores focus',async()=>{
  const page=await open();
  try {
    const opener=page.getByRole('button',{name:'Open content',exact:true}); await opener.click();
    const dialog=page.getByRole('dialog',{name:'Invite teammate'}); await dialog.waitFor();
    expect(await dialog.getByRole('heading',{name:'Invite teammate'}).count()).toBe(1);
    const title=await dialog.getByRole('heading').boundingBox(),close=await dialog.getByRole('button',{name:'Close',exact:true}).boundingBox();
    expect(title!.x+title!.width).toBeLessThanOrEqual(close!.x);
    await dialog.getByRole('button',{name:'Save changes'}).click();
    expect(await page.getByTestId('saves').textContent()).toBe('0'); // Native required-field validation.
    await dialog.getByLabel('Name',{exact:true}).fill('Synthetic name');
    await dialog.getByRole('button',{name:'Save changes'}).click();
    await dialog.waitFor({state:'detached'});
    expect(await page.getByTestId('outcome').textContent()).toBe('accepted');
    expect(await page.getByTestId('saves').textContent()).toBe('1');
    await page.waitForFunction(()=>document.activeElement?.textContent==='Open content');
    expect(await page.evaluate(()=>document.body.style.overflow)).toBe('');
  }finally{await page.close();}
},30_000);

test('inert exit paint removes password, revealed-password, OTP and SecretField copies',async()=>{
  const page=await open(1100,false);
  try {
    await page.getByRole('button',{name:'Sensitive paint',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Sensitive paint'}); await dialog.waitFor();
    await dialog.getByRole('button',{name:'Show password',exact:true}).click();
    expect(await dialog.getByLabel('Synthetic password').getAttribute('type')).toBe('text');
    await dialog.getByRole('button',{name:'Close',exact:true}).click();
    const paint=page.locator('.zero-modal__exit-paint'); await paint.waitFor({state:'attached'});
    expect(await paint.locator('input').evaluateAll(elements=>elements.map(element=>(element as HTMLInputElement).value))).toEqual(['','']);
    expect(await paint.locator('input').evaluateAll(elements=>elements.map(element=>element.getAttribute('value')))).toEqual([null,null]);
    expect(await paint.textContent()).not.toContain('synthetic-key-secret');
    await paint.waitFor({state:'detached'}); await page.waitForFunction(()=>document.body.style.overflow==='');
  }finally{await page.close();}
},30_000);

test('owning sibling-host teardown retires its opening before another host can remount the body',async()=>{
  const page=await open(1100,true,true);
  try {
    await page.getByRole('button',{name:'Open first owner',exact:true}).click();
    await page.getByRole('dialog',{name:'First owner'}).waitFor();
    await page.getByLabel('Sibling draft').fill('Owned draft');
    const mounts=await page.getByTestId('mounts').textContent();
    // Authoritative host teardown bypasses advisory leave admission, like an app boundary change.
    await page.getByTestId('retire-first-host').evaluate(element=>(element as HTMLButtonElement).click());
    await page.getByRole('dialog',{name:'First owner'}).waitFor({state:'detached'});
    await page.waitForFunction(()=>document.querySelector('[data-testid="sibling-outcome"]')?.textContent==='retired');
    expect(await page.getByTestId('mounts').textContent()).toBe(mounts);
    await page.getByRole('button',{name:'Open next owner'}).click();
    const next=page.getByRole('dialog',{name:'Next owner'}); await next.waitFor();
    expect(await page.getByText('Fresh owned body').count()).toBe(1);
    await next.getByRole('button',{name:'Close',exact:true}).click();
    await next.waitFor({state:'detached'}); await page.waitForFunction(()=>document.body.style.overflow==='');
  }finally{await page.close();}
},30_000);

test('owned Select and Popover portals sit above their modal and Escape closes only the floating child',async()=>{
  const page=await open();
  try {
    await page.getByRole('button',{name:'Open content',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Invite teammate'});
    const ownerLayer=await dialog.evaluate(e=>Number(getComputedStyle(e.parentElement!).zIndex));
    await dialog.getByRole('combobox',{name:'Role'}).click();
    const list=page.getByRole('listbox'); await list.waitFor();
    expect(await list.evaluate(e=>Number(getComputedStyle(e).zIndex))).toBeGreaterThan(ownerLayer);
    await page.getByRole('option',{name:'Admin',exact:true}).click();
    expect(await dialog.getByRole('combobox',{name:'Role'}).textContent()).toContain('Admin');
    await dialog.getByRole('button',{name:'Open picker'}).click();
    await page.getByLabel('Picker search').fill('Synthetic'); await page.keyboard.press('Escape');
    await page.getByLabel('Picker search').waitFor({state:'detached'});
    expect(await page.getByLabel('Picker search').count()).toBe(0);
    expect(await dialog.isVisible()).toBe(true);
    await dialog.getByRole('button',{name:'Open child'}).click();
    const child=page.getByRole('dialog',{name:'Child picker'}); await child.waitFor();
    expect(await page.locator('[data-zero-modal-id]').filter({has:page.getByRole('heading',{name:'Invite teammate',includeHidden:true})}).evaluate(e=>e.parentElement!.inert)).toBe(true);
    await page.keyboard.press('Escape'); await child.waitFor({state:'detached'});
    expect(await dialog.isVisible()).toBe(true);
    expect(await dialog.evaluate(e=>e.parentElement!.inert)).toBe(false);
  }finally{await page.close();}
},30_000);

test('tab drafts and scroll positions survive, only body scrolls, and mobile nav is a bounded tab strip',async()=>{
  for(const width of [1100,375]){
    const page=await open(width);
    try{
      await page.getByRole('button',{name:'Open nav',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'Preferences'}); await dialog.waitFor();
      await dialog.getByLabel('Name',{exact:true}).fill('Retained draft');
      await dialog.getByRole('tab',{name:'Members 12'}).click();
      const panel=dialog.getByRole('tabpanel',{name:'Members 12'});
      expect(await panel.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
      await panel.evaluate(e=>{e.scrollTop=180;});
      await dialog.getByRole('tab',{name:'General'}).click();
      expect(await dialog.getByLabel('Name',{exact:true}).inputValue()).toBe('Retained draft');
      await dialog.getByRole('tab',{name:'Members 12'}).click();
      expect(await panel.evaluate(e=>e.scrollTop)).toBe(180);
      const bounds=await dialog.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width);
      expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(800);
      expect(await dialog.getByRole('tablist').getAttribute('aria-orientation')).toBe(width===375?'horizontal':'vertical');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const directory='/Volumes/code-bank/artifacts/zero-platform/diagnostics/modal-system';
      await mkdir(directory,{recursive:true}); await page.screenshot({path:`${directory}/nav-${width}.png`});
    }finally{await page.close();}
  }
},30_000);

test('origin and programmatic rise use exact approved timings, with one backdrop and no leaked exits',async()=>{
  const page=await open(1100,false);
  try{
    await page.getByRole('button',{name:'Open content',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Invite teammate'}); await dialog.waitFor();
    expect(await dialog.evaluate(e=>e.getAnimations().map(a=>a.effect!.getTiming().duration))).toContain(975);
    await dialog.getByRole('button',{name:'Close',exact:true}).click(); await dialog.waitFor({state:'detached'});
    await page.waitForFunction(()=>document.body.style.overflow==='');
    await page.getByRole('button',{name:'Programmatic',exact:true}).click(); await dialog.waitFor();
    expect(await dialog.evaluate(e=>e.getAnimations().map(a=>a.effect!.getTiming().duration))).toContain(900);
    expect(await page.locator('.zero-modal-backdrop').count()).toBe(1);
    await page.emulateMedia({reducedMotion:'reduce'}); await page.keyboard.press('Escape');
    await dialog.waitFor({state:'detached'}); await page.waitForFunction(()=>document.body.style.overflow==='');
    expect(await page.locator('.zero-modal-layer').count()).toBe(0);
  }finally{await page.close();}
},30_000);

test('required steps keep the standardized frame and nudge denied Escape without dismissing',async()=>{
  const page=await open(1100,false);
  try {
    await page.getByRole('button',{name:'Required step',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Required review'}); await dialog.waitFor();
    expect(await dialog.getByRole('button',{name:'Close',exact:true}).count()).toBe(0);
    await dialog.evaluate(async element=>{await Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{})));});
    await page.keyboard.press('Escape');
    expect(await dialog.isVisible()).toBe(true);
    expect(await dialog.evaluate(element=>element.getAnimations().map(animation=>animation.effect!.getTiming().duration))).toContain(390);
    await dialog.getByRole('button',{name:'Accept',exact:true}).click();
    await dialog.waitFor({state:'detached'}); await page.waitForFunction(()=>document.body.style.overflow==='');
  }finally{await page.close();}
},30_000);

test('specialized command dialogs keep cmdk anatomy but inherit modal portal layers and Escape ownership',async()=>{
  const page=await open();
  try {
    await page.getByRole('button',{name:'Open content',exact:true}).click();
    const parent=page.getByRole('dialog',{name:'Invite teammate'}); await parent.waitFor();
    const layer=await parent.evaluate(element=>Number(getComputedStyle(element.parentElement!).zIndex));
    await parent.getByRole('button',{name:'Open commands'}).click();
    const command=page.getByRole('dialog',{name:'Scoped commands'}); await command.waitFor();
    expect(await command.evaluate(element=>Number(getComputedStyle(element).zIndex))).toBeGreaterThan(layer);
    expect(await command.locator('[cmdk-root]').count()).toBe(1);
    await command.getByRole('combobox').focus();
    await page.keyboard.press('Escape'); await command.waitFor({state:'detached'});
    expect(await parent.isVisible()).toBe(true);
    await page.keyboard.press('Escape'); await parent.waitFor({state:'detached'});
    await page.waitForFunction(()=>document.body.style.overflow==='');
  }finally{await page.close();}
},30_000);
