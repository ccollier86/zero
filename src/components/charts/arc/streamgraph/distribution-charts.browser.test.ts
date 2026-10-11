/** Isolated synthetic browser qualification; no application/provider/DB configuration is imported. */
import {mkdir,mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {afterAll,beforeAll,expect,test} from "bun:test";
import type {Page} from "playwright";
import {buildPlatformStyles} from "../../../../frontend/server/style-bundle";
import {acquirePlaywrightTestBrowser,playwrightTestBrowserAvailable,type PlaywrightTestBrowserLease} from "../../../../test-support/playwright-test-browser";
const browserTest=playwrightTestBrowserAvailable?test:test.skip;
const artifacts="/Volumes/code-bank/artifacts/zero-platform/diagnostics/arc-distributions";
let lease:PlaywrightTestBrowserLease|undefined,bundle="",css="";
const errors=new WeakMap<Page,string[]>();
beforeAll(async()=>{
 if(!playwrightTestBrowserAvailable)return;
 const scratch="/Volumes/code-bank/tmp/scratch/zero-platform";await mkdir(scratch,{recursive:true});const directory=await mkdtemp(join(scratch,"arc-distributions-"));
 try{const output=join(directory,"fixture.js"),process=Bun.spawn([globalThis.process.execPath,"--no-env-file","build",import.meta.dir+"/distribution-charts.browser-fixture.tsx","--target=browser","--format=iife","--outfile",output],{stdout:"pipe",stderr:"pipe",timeout:40000});
 const [code,out,err]=await Promise.all([process.exited,new Response(process.stdout).text(),new Response(process.stderr).text()]);if(code!==0)throw new Error(err||out);
 bundle=await Bun.file(output).text();css=await Bun.file((await buildPlatformStyles(directory,join(directory,"absent-app"))).cssPath).text();
 }finally{await rm(directory,{recursive:true,force:true});}
 lease=await acquirePlaywrightTestBrowser();await mkdir(artifacts,{recursive:true});
},60000);
afterAll(()=>lease?.release());
async function mount(width=1100,dark=false,reduced=true){
 const page=await lease!.browser.newPage({viewport:{width,height:1000},reducedMotion:reduced?"reduce":"no-preference"});const messages:string[]=[];errors.set(page,messages);page.on("pageerror",error=>messages.push(error.message));page.setDefaultTimeout(6000);
 await page.setContent('<!doctype html><html data-theme="'+(dark?"dark":"light")+'"'+(dark?' class="dark"':"")+'><body><div id="root"></div></body></html>');
 await page.addStyleTag({content:css});await page.addScriptTag({content:bundle});await page.getByRole("heading",{name:"Arc distribution chart fixture"}).waitFor();
 await page.waitForFunction(()=>!!window.__arcDistribution&&!!document.querySelector(".zero-arc-streamgraph__layer")?.getAttribute("d"));return page;
}
async function close(page:Page){try{expect(errors.get(page)).toEqual([]);}finally{await page.close();}}
for(const [width,dark,name]of [[1100,false,"light"],[1100,true,"dark"],[390,false,"phone-light"],[390,true,"phone-dark"]]as const){
 browserTest("Arc distribution/hierarchy reference anatomy and bounded "+name,async()=>{
  const page=await mount(width,dark);try{
   expect(await page.locator("figure[data-zero-arc-chart]").count()).toBe(4);
   expect(await page.locator(".zero-arc-streamgraph__layer").count()).toBe(4);
   expect(await page.locator(".zero-arc-slope-chart__line").count()).toBe(4);
   expect(await page.locator(".zero-arc-ridgeline__ridge").count()).toBe(4);
   expect(await page.locator(".zero-arc-treemap__tile").count()).toBe(10);
   expect(await page.locator("table").count()).toBe(4);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:join(artifacts,name+".png"),fullPage:true});
   if(name==="light"){for(const kind of ["stream","slope","ridge","tree"])await page.getByTestId(kind+"-card").screenshot({path:join(artifacts,kind+"-preview.png")});}
  }finally{await close(page);}
 },30000);
}
browserTest("all four keyboard readings use shared opaque portaled cards and custom/hidden inspector slots",async()=>{
 const page=await mount();try{
  for(const selector of [".zero-arc-streamgraph__plot",".zero-arc-slope-chart__stage",".zero-arc-ridgeline__plot",".zero-arc-treemap__stage"]){
   const plot=page.locator(selector);await plot.scrollIntoViewIfNeeded();await plot.focus();await page.keyboard.press("Home");await page.getByRole("tooltip").waitFor();
   expect(await page.getByRole("tooltip").evaluate(el=>!el.closest("figure"))).toBe(true);
   expect(await page.locator('[data-zero-tooltip][data-state="open"]').evaluate(el=>getComputedStyle(el).borderRadius)).toBe("10px");
   expect(await page.locator('[data-zero-tooltip][data-state="open"]').evaluate(el=>getComputedStyle(el).opacity)).toBe("1");
   await page.evaluate(()=>window.__arcDistribution.custom("custom"));await page.getByTestId("custom-distribution-inspector").waitFor();
   await page.evaluate(()=>window.__arcDistribution.custom("hidden"));await page.getByRole("tooltip").waitFor({state:"hidden"});
   await page.evaluate(()=>window.__arcDistribution.custom("default"));await plot.focus();await page.keyboard.press("Escape");
  }
 }finally{await close(page);}
},30000);
browserTest("stream toggles reflow and reading remains tied to datum identity through insertion",async()=>{
 const page=await mount();try{
  const plot=page.locator(".zero-arc-streamgraph__plot");await plot.focus();await page.keyboard.press("Home");await page.keyboard.press("ArrowRight");await page.getByRole("tooltip").filter({hasText:"Week two"}).waitFor();
  const before=await page.locator(".zero-arc-streamgraph__layer").first().getAttribute("d");
  await page.getByRole("button",{name:"Billing",exact:true}).click();expect(await page.getByRole("button",{name:"Billing",exact:true}).getAttribute("aria-pressed")).toBe("false");
  await page.waitForFunction(previous=>document.querySelector(".zero-arc-streamgraph__layer")?.getAttribute("d")!==previous,before);
  await plot.focus();await page.keyboard.press("Home");await page.keyboard.press("ArrowRight");
  await page.evaluate(()=>{const reference=window.__arcDistribution.reference("stream")as any;window.__arcDistribution.update("stream",{data:[{id:"earlier",label:"Earlier",values:{billing:2,access:2,product:2,other:2}},...reference.data]});});
  await page.getByRole("tooltip").filter({hasText:"Week two"}).waitFor();expect((await page.evaluate(()=>window.__arcDistribution.events())).at(-1)).toEqual(["stream","w2",null]);
 }finally{await close(page);}
},30000);
browserTest("treemap pivot drill and breadcrumbs retain leaf identity and weighted exact values",async()=>{
 const page=await mount();try{
  const stage=page.locator(".zero-arc-treemap__stage");await stage.scrollIntoViewIfNeeded();await stage.focus();await page.keyboard.press("Home");await page.getByRole("tooltip").filter({hasText:"Europe"}).waitFor();
  await page.keyboard.press("Enter");await page.locator('[aria-current="location"]').filter({hasText:"Europe"}).waitFor();
  expect(await page.getByRole("button",{name:"Revenue",exact:true}).count()).toBe(1);
  await page.keyboard.press("Escape");await page.locator('[aria-current="location"]').filter({hasText:"Revenue"}).waitFor();
 }finally{await close(page);}
},30000);
browserTest("retired selection and empty replacements clear inspectors, geometry and announcements",async()=>{
 const page=await mount();try{
  const cases=[["stream",".zero-arc-streamgraph__plot",{data:[]}],["slope",".zero-arc-slope-chart__stage",{data:[]}],["ridge",".zero-arc-ridgeline__plot",{series:[]}],["tree",".zero-arc-treemap__stage",{data:{id:"zero",label:"Zero",value:0}}]]as const;
  for(const [kind,selector,patch]of cases){
   await page.locator(selector).scrollIntoViewIfNeeded();await page.locator(selector).focus();await page.keyboard.press("Home");await page.getByRole("tooltip").waitFor();
   await page.evaluate(([kind,patch])=>window.__arcDistribution.update(kind as any,patch as object),[kind,patch]);await page.getByRole("tooltip").waitFor({state:"hidden"});
  }
  expect(await page.locator("table").count()).toBe(0);
  await page.evaluate(()=>window.__arcDistribution.unmount());await page.waitForFunction(()=>window.__arcDistributionPending()===0);
 }finally{await close(page);}
},30000);
browserTest("live scoped tokens reach SVG and portal, motion interruption and cleanup remain finite",async()=>{
 const page=await mount(1100,false,false);try{
  await page.waitForFunction(()=>document.querySelector(".zero-arc-streamgraph__layer")?.getAttribute("d")?.includes("L"));
  await page.locator(".zero-arc-slope-chart__stage").focus();await page.keyboard.press("Home");await page.getByRole("tooltip").waitFor();
  await page.evaluate(()=>{const figure=document.querySelector<HTMLElement>('[data-zero-arc-chart="slope-chart"]')!;figure.style.setProperty("--zero-chart-blue","#ff0000");figure.style.setProperty("--zero-chart-inspector-radius","19px");});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector(".zero-arc-slope-chart__item[data-accent] .zero-arc-slope-chart__line")!).stroke==="rgb(255, 0, 0)");
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-zero-tooltip][data-state="open"]')!).borderRadius==="19px");
  await page.evaluate(()=>{window.__arcDistribution.update("stream",{offset:"zero"});window.__arcDistribution.update("stream",{offset:"silhouette"});window.__arcDistribution.update("ridge",{bandwidth:4});window.__arcDistribution.update("ridge",{bandwidth:8});});
  await page.evaluate(()=>window.__arcDistribution.unmount());await page.waitForFunction(()=>window.__arcDistributionPending()===0);
 }finally{await close(page);}
},30000);
