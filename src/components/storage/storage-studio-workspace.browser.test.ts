/** Real-browser coverage for Storage Studio editing and responsive selection. */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import {
  acquirePlaywrightTestBrowser,
  playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';

declare global {
  interface Window {
    __storageStudioHarness: {
      resolve: () => void;
      remote: (name: string) => void;
      clearSelection: () => void;
      commits: () => string[];
      page: () => number;
      showAccess: () => void;
    };
    __storagePermissionHarness: {
      write(kind:'grant'|'revoke',target:string):Promise<void>;
      writes():{id:number;kind:'grant'|'revoke';target:string;settled:boolean}[];
      resolve(id:number):void;reject(id:number):void;
      refresh():void;refreshes():number;changes():number;events():unknown[];
      target(value:string):void;scope(value:string):void;admin(value:boolean):void;remove():void;
    };
    __storagePermissionScope: string;
  }
}

const browserTest = test;
const TEST_TIMEOUT = 60_000;
let browser: Browser | undefined;
let browserLease: PlaywrightTestBrowserLease | undefined;
let buildDir: string | undefined;
let bundlePath: string | undefined;
let stylesheetPath: string | undefined;
let evidenceDir: string | undefined;

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) throw new Error('Storage UI acceptance requires the existing Chromium fixture browser.');
  browserLease = await acquirePlaywrightTestBrowser();
  browser = browserLease.browser;
  const scratchRoot = '/Volumes/code-bank/tmp/scratch/zero-platform';
  await mkdir(scratchRoot, { recursive: true });
  buildDir = await mkdtemp(join(scratchRoot, 'storage-studio-browser-'));
  const entrypoint = join(buildDir, 'entry.tsx');
  bundlePath = join(buildDir, 'bundle.js');
  await Bun.write(entrypoint, fixtureSource(
    join(import.meta.dir, 'storage-studio-workspace.tsx'),
  ));
  const builder = join(buildDir, 'build.ts');
  const authSource = `export function useStorageAuthConfig(){return {loading:false,error:null,config:{
    authorization:{roles:{member:{label:'Organization member'},builder:{label:'Builder with a long readable name'}}},
    userProperties:{department:{key:'department',label:'Department',useInPolicies:true,values:['Engineering','Operations']}}
  }}}`;
  const permissionSource = `const permissions=Array.from({length:45},(_,i)=>({permission_id:'permission-'+i,drive_id:'drive-1',object_id:null,
    grant_type:i%2?'role':'user',grant_key:null,grant_value:(i%2?'organization-member-':'synthetic-user-')+i+'-'+('long-target-'.repeat(12)),
    permission:i%3===0?'admin':i%3===1?'write':'read',created_at:1}));
    export function useStoragePermissions(driveId){return {permissions:permissions.map(item=>({...item,drive_id:driveId})),loading:false,error:null,refresh(){window.__storagePermissionHarness.refresh()}}}
    export function usePresignedUrl(){return {url:null,loading:false,error:null}}
    export function useStorageActions(){return {grantPermission(driveId){return window.__storagePermissionHarness.write('grant',driveId)},
      revokePermission(id){return window.__storagePermissionHarness.write('revoke',id)}}}`;
  const boundarySource = `export function useAuthorizationScopeBoundary(){return {key:window.__storagePermissionScope,scopeKey:window.__storagePermissionScope,
    dataRevision:0,ready:true,stable:true,phase:'idle'}}
    export function isAuthorizationScopeCallbackCurrent(current,ready,captured){return ready && current===captured}`;
  await Bun.write(builder, `const result = await Bun.build({
    entrypoints: [${JSON.stringify(entrypoint)}],
    root: ${JSON.stringify(join(import.meta.dir, '../../..'))},
    outdir: ${JSON.stringify(buildDir)},
    naming: 'bundle.js',
    target: 'browser',
    format: 'iife',
    plugins: [{ name: 'synthetic-storage-permission-data', setup(build) {
      build.onResolve({ filter: /storage-hooks$/ }, () => ({ path: 'permissions', namespace: 'storage-ui-fixture' }));
      build.onResolve({ filter: /use-storage-auth-config$/ }, () => ({ path: 'auth-config', namespace: 'storage-ui-fixture' }));
      build.onResolve({ filter: /authorization-scope-hooks$/ }, () => ({ path: 'boundary', namespace: 'storage-ui-fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'storage-ui-fixture' }, ({ path }) => ({ loader: 'js', contents: path === 'auth-config'
        ? ${JSON.stringify(authSource)} : path === 'boundary' ? ${JSON.stringify(boundarySource)} : ${JSON.stringify(permissionSource)} }));
    } }],
  });
  if (!result.success) { console.error(result.logs.map((log) => log.message).join('\\n')); process.exit(1); }`);
  const build = Bun.spawn({ cmd: [process.execPath, '--no-env-file', builder], cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, status] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
  if (status !== 0) throw new Error(`${stdout}\n${stderr}`);
  stylesheetPath = (await buildPlatformStyles(buildDir, join(buildDir, 'missing-app'))).cssPath;
  const artifactRoot = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/storage-studio-permissions';
  await mkdir(artifactRoot, { recursive: true }); evidenceDir = await mkdtemp(join(artifactRoot, 'acceptance-'));
}, TEST_TIMEOUT);

afterAll(async () => {
  try {
    if (buildDir) await rm(buildDir, { recursive: true, force: true });
  } finally {
    browserLease?.release();
  }
}, TEST_TIMEOUT);

describe('StorageStudioWorkspace browser contract', () => {
  browserTest('keeps inline editing stable and protects stale drafts', async () => {
    const page = await openHarness();
    try {
      const cell = page.locator('[data-slot="inline-edit-text"]').first();
      const before = await cell.boundingBox();
      if (!before) throw new Error('Expected a drive name cell');

      await page.getByRole('button', { name: /Edit drive name/ }).click();
      const input = page.getByRole('textbox', { name: 'Edit drive name' });
      const during = await cell.boundingBox();
      const style = await input.evaluate((element) => {
        const computed = getComputedStyle(element);
        return { background: computed.backgroundColor, border: computed.borderTopWidth };
      });
      expect(during?.width).toBeCloseTo(before.width, 1);
      expect(during?.height).toBeCloseTo(before.height, 1);
      expect(style).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px' });

      await input.fill('Discarded');
      await input.press('Escape');
      expect(await cell.textContent()).toContain('Clinical files');

      await page.getByRole('button', { name: /Edit drive name/ }).click();
      await input.fill('Updated drive');
      await input.press('Enter');
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="inline-edit-text"]')
          ?.getAttribute('data-save-state') === 'pending'
      ));
      await page.evaluate(() => window.__storageStudioHarness.resolve());
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="inline-edit-text"]')
          ?.getAttribute('data-save-state') === 'saved'
      ));
      expect(await cell.textContent()).toContain('Updated drive');

      await page.getByRole('button', { name: /Edit drive name/ }).click();
      await input.fill('Stale local name');
      await page.evaluate(() => window.__storageStudioHarness.remote('Remote drive'));
      await page.waitForFunction(() => (
        document.querySelector('[data-slot="inline-edit-text"]')
          ?.getAttribute('data-save-state') === 'conflict'
      ));
      expect(await cell.textContent()).toContain('Remote drive');
      expect(await page.evaluate(() => window.__storageStudioHarness.commits())).toEqual(['Updated drive']);
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT);

  browserTest('moves between the mobile catalog and inspector without duplicating the workspace', async () => {
    const page = await openHarness();
    try {
      await page.setViewportSize({ width: 390, height: 800 });
      await page.evaluate(() => window.__storageStudioHarness.clearSelection());

      const workspace = page.locator('[data-slot="storage-studio-workspace"]');
      const list = page.locator('[data-slot="storage-studio-list"]');
      const inspector = page.locator('[data-slot="storage-studio-inspector"]');
      expect(await workspace.count()).toBe(1);
      expect(await list.isVisible()).toBe(true);
      expect(await inspector.isVisible()).toBe(false);

      await page.locator('[data-storage-item-id="drive-1"] td').nth(2).click();
      await page.getByRole('button', { name: 'Back to drives' }).waitFor({ state: 'visible' });
      expect(await list.isVisible()).toBe(false);
      expect(await inspector.isVisible()).toBe(true);

      await page.getByRole('button', { name: 'Back to drives' }).click();
      await list.waitFor({ state: 'visible' });
      expect(await inspector.isVisible()).toBe(false);
      expect(await workspace.count()).toBe(1);
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT);

  browserTest('navigates cursor pages through the bounded controller actions', async () => {
    const page = await openHarness();
    try {
      expect(await page.evaluate(() => window.__storageStudioHarness.page())).toBe(1);
      await page.getByRole('button', { name: 'Next page' }).click();
      await page.waitForFunction(() => window.__storageStudioHarness.page() === 2);
      expect(await page.getByText('Page 2', { exact: false }).count()).toBe(1);
      await page.getByRole('button', { name: 'Previous page' }).click();
      await page.waitForFunction(() => window.__storageStudioHarness.page() === 1);
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT);

  browserTest('grant controls fit a narrow desktop inspector and current grants use compact bounded scrolling', async () => {
    const page = await openHarness(); try {
      await page.setViewportSize({ width: 1000, height: 800 });
      await page.evaluate(() => window.__storageStudioHarness.showAccess());
      await page.getByRole('tab', { name: /^access$/i }).click();
      const pane = page.locator('[data-slot="storage-studio-inspector"]');
      const form = pane.locator('[data-slot="storage-permission-grant-form"]'); await form.waitFor();
      expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      const paneBox = await pane.boundingBox(), formBox = await form.boundingBox();
      expect(paneBox!.width).toBeGreaterThanOrEqual(330); expect(paneBox!.width).toBeLessThanOrEqual(450);
      expect(formBox!.x).toBeGreaterThanOrEqual(paneBox!.x); expect(formBox!.x + formBox!.width).toBeLessThanOrEqual(paneBox!.x + paneBox!.width + 1);
      const list = pane.locator('[data-slot="storage-permission-list"]'); await list.waitFor();
      expect(await list.locator('[data-slot="storage-permission-row"]').count()).toBe(45);
      expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === 'auto')).toBe(true);
      const row = list.locator('[data-slot="storage-permission-row"]').first();
      const rowBox = await row.boundingBox(); expect(rowBox!.height).toBeLessThanOrEqual(60);
      const bar = page.locator('[data-slot="storage-studio-action-bar"]'), before = await bar.boundingBox();
      await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      const after = await bar.boundingBox(); expect(after!.y).toBeCloseTo(before!.y, 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await page.getByRole('button', { name: 'Grant', exact: true }).isVisible()).toBe(true);
      await list.evaluate((element) => { element.scrollTop = 0; });
      await page.waitForFunction(() => {
        const content = document.querySelector('[data-slot="storage-studio-inspector"] [role="tabpanel"][data-state="active"]');
        if (!content) return false;
        const style = getComputedStyle(content);
        return Number(style.opacity) >= 0.999 && (style.filter === 'none' || style.filter === 'blur(0px)');
      });
      for (const dark of [false, true]) {
        await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
        await page.waitForTimeout(350);
        await page.screenshot({ path: join(evidenceDir!, `${dark ? 'dark' : 'light'}-narrow-inspector.png`) });
      }
    } finally { await page.close(); }
  }, TEST_TIMEOUT);

  browserTest('one panel reserves grant/revoke synchronously and awaits the accepted change', async()=>{
    const page=await openPermissionHarness();try{
      await chooseGrantRole(page);
      await page.getByRole('button',{name:'Grant',exact:true}).evaluate(button=>{
        (button as HTMLButtonElement).click();
        (document.querySelector('[aria-label^="Revoke admin access"]') as HTMLButtonElement)?.click();
      });
      await page.waitForFunction(()=>window.__storagePermissionHarness.writes().length===1);
      expect(await page.evaluate(()=>window.__storagePermissionHarness.writes()[0]!.kind)).toBe('grant');
      expect(await page.evaluate(()=>window.__storagePermissionHarness.refreshes())).toBe(0);
      expect(await page.getByRole('button',{name:/Revoke admin access/}).first().isDisabled()).toBe(true);
      await page.evaluate(()=>window.__storagePermissionHarness.resolve(1));
      await page.waitForFunction(()=>window.__storagePermissionHarness.changes()===1);
      expect(await page.evaluate(()=>window.__storagePermissionHarness.refreshes())).toBe(1);
      await page.getByRole('button',{name:/Revoke admin access/}).first().evaluate(button=>{
        (button as HTMLButtonElement).click();(button as HTMLButtonElement).click();
      });
      await page.waitForFunction(()=>window.__storagePermissionHarness.writes().length===2);
      expect(await page.evaluate(()=>window.__storagePermissionHarness.writes().map(item=>item.kind))).toEqual(['grant','revoke']);
      await page.evaluate(()=>window.__storagePermissionHarness.resolve(2));
      await page.waitForFunction(()=>window.__storagePermissionHarness.changes()===2);
      expect(await page.evaluate(()=>window.__storagePermissionHarness.refreshes())).toBe(2);
    }finally{await page.close()}
  },TEST_TIMEOUT);

  browserTest('target, scope and admin ABA retire deferred outcomes without stale presentation or successor refresh',async()=>{
    for(const kind of ['target','scope','admin','remove'] as const){
      const page=await openPermissionHarness();try{
        await chooseGrantRole(page);await page.getByRole('button',{name:'Grant',exact:true}).click();
        await page.waitForFunction(()=>window.__storagePermissionHarness.writes().length===1);
        if(kind==='remove'){
          await page.evaluate(()=>window.__storagePermissionHarness.remove());
          await page.getByText('Permission editor removed',{exact:true}).waitFor();
        }else{
          await page.evaluate(kind=>{
            if(kind==='target')window.__storagePermissionHarness.target('drive-b');
            else if(kind==='scope')window.__storagePermissionHarness.scope('organization-b');
            else window.__storagePermissionHarness.admin(false);
          },kind);
          await page.waitForFunction(kind=>{
            const element=document.querySelector('[data-testid="grant-context"]');
            return element?.getAttribute(`data-${kind}`)===(kind==='admin'?'false':kind==='scope'?'organization-b':'drive-b');
          },kind);
          await page.evaluate(kind=>{
            if(kind==='target')window.__storagePermissionHarness.target('drive-1');
            else if(kind==='scope')window.__storagePermissionHarness.scope('organization-a');
            else window.__storagePermissionHarness.admin(true);
          },kind);
          await page.waitForFunction(kind=>{
            const element=document.querySelector('[data-testid="grant-context"]');
            return element?.getAttribute(`data-${kind}`)===(kind==='admin'?'true':kind==='scope'?'organization-a':'drive-1');
          },kind);
          await chooseGrantRole(page);await page.getByRole('button',{name:'Grant',exact:true}).click();
          await page.waitForFunction(()=>window.__storagePermissionHarness.writes().length===2);
        }
        await page.evaluate(()=>window.__storagePermissionHarness.reject(1));
        await page.waitForFunction(()=>window.__storagePermissionHarness.events().length===1);
        expect(await page.evaluate(()=>window.__storagePermissionHarness.refreshes())).toBe(0);
        expect(await page.evaluate(()=>window.__storagePermissionHarness.changes())).toBe(0);
        expect(await page.locator('[data-sonner-toast]').count()).toBe(0);
        const events=JSON.stringify(await page.evaluate(()=>window.__storagePermissionHarness.events()));
        expect(events).not.toContain('Synthetic private grant error');
        if(kind!=='remove'){
          expect(await page.getByRole('button',{name:'Saving…',exact:true}).isDisabled()).toBe(true);
          await page.evaluate(()=>window.__storagePermissionHarness.resolve(2));
          await page.waitForFunction(()=>window.__storagePermissionHarness.changes()===1);
          expect(await page.evaluate(()=>window.__storagePermissionHarness.refreshes())).toBe(1);
        }
      }finally{await page.close()}
    }
  },TEST_TIMEOUT);
});

async function openPermissionHarness():Promise<Page>{
  const page=await openHarness();await page.evaluate(()=>window.__storageStudioHarness.showAccess());
  await page.getByRole('tab',{name:/^access$/i}).click();
  await page.locator('[data-slot="storage-permission-grant-form"]').waitFor();return page;
}
async function chooseGrantRole(page:Page):Promise<void>{
  await page.getByRole('combobox',{name:'Role',exact:true}).click();
  await page.getByRole('option',{name:'Organization member',exact:true}).click();
}

async function openHarness(): Promise<Page> {
  if (!browser || !bundlePath || !stylesheetPath) throw new Error('Browser harness unavailable');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(4_000);
  await page.setContent('<body class="bg-background text-foreground"><div id="root" style="height:760px"></div></body>');
  await page.addStyleTag({ path: stylesheetPath });
  await page.addScriptTag({ path: bundlePath });
  await page.waitForFunction(() => typeof window.__storageStudioHarness === 'object');
  return page;
}

function fixtureSource(componentPath: string): string {
  return `
import * as React from ${JSON.stringify(Bun.resolveSync('react', import.meta.dir))};
import { createRoot } from ${JSON.stringify(Bun.resolveSync('react-dom/client', import.meta.dir))};
import { StorageStudioWorkspace } from ${JSON.stringify(componentPath)};
import { StorageDrivePermissionsPanel } from ${JSON.stringify(join(import.meta.dir, 'storage-drive-permissions-panel.tsx'))};
import { Toaster } from ${JSON.stringify(join(import.meta.dir, '../ui/sonner.tsx'))};
import { configureFrontendObservability } from ${JSON.stringify(join(import.meta.dir, '../../frontend/client/observability.ts'))};

const createdAt = Date.UTC(2026, 9, 3, 12);
let driveName = 'Clinical files';
let revision = 1;
let selected = null;
let pending = null;
let commitValues = [];
let currentPage = 1;
let permissionTarget='drive-1',permissionAdmin=true,permissionVisible=true;
let grantSequence=0,permissionRefreshes=0,permissionChanges=0;
const permissionWrites=[],permissionEvents=[];
window.__storagePermissionScope='organization-a';
configureFrontendObservability({sink:{emit(event){permissionEvents.push({code:event.code,message:event.message,metadata:event.metadata})}}});
const root = createRoot(document.getElementById('root'));

function drive() {
  return {
    drive: {
      drive_id: 'drive-1', tenant_id: 'tenant-1', name: driveName,
      owner_id: 'user-1', max_size_bytes: 1024, max_file_size_bytes: 512,
      allowed_mime_types: '*', public: 0, created_at: createdAt,
      access: { effectiveAccess: 'admin', canRead: true, canWrite: true,
        canAdmin: true, isOwner: true, isPlatformAdmin: false, isPublic: false },
    },
    profile: {
      driveId: 'drive-1', key: 'clinical-files', ownerKind: 'organization',
      ownerId: 'tenant-1', scopeKind: 'tenant', lifecycle: 'ready', revision,
      isolation: 'shared-cas', generation: 1, createdAt, updatedAt: createdAt,
      readyAt: createdAt, degradedAt: null, suspendedAt: null, deletingAt: null,
      deletedAt: null, restoringAt: null, failedAt: null, failureCode: null,
    },
    control: { canManage: true, canDelete: true, canSuspend: true, canRestore: false },
  };
}

function capabilities() {
  return {
    enabled: true, scopeKind: 'tenant', ownerChoices: ['organization', 'personal'],
    canReadCatalog: true, canProvisionOrganization: true, canProvisionPersonal: true,
    canManage: true, canDelete: true,
    policy: { isolation: 'shared-cas', allowPublicDrives: false,
      allowPublicObjects: false, maxCapabilityTTL: 3600, maxOrganizationDrives: 25,
      maxPersonalDrivesPerUser: 2, defaultDriveSizeBytes: 1024,
      defaultFileSizeBytes: 512, maxDriveSizeBytes: 2048, maxFileSizeBytes: 1024,
      maxObjectsPerDrive: 100, maxConcurrentUploadBytes: 1024 },
  };
}

function commitName(next) {
  commitValues.push(next);
  return new Promise((resolve) => {
    pending = () => {
      driveName = next;
      revision += 1;
      render();
      resolve();
    };
  });
}

function render() {
  const current = drive();
  const controller = {
    status: 'ready', capabilities: capabilities(), view: 'drives', drives: [current], files: [],
    selectedDrive: selected ? current : null, selectedFile: null, selectedFileAccess: null,
    currentPath: null, breadcrumbs: [{ label: 'Root', path: null }], usage: null, jobs: [],
    drivePagination: { page: currentPage, count: 1, hasPrevious: currentPage > 1, hasNext: currentPage < 2 },
    filters: { search: '', owner: 'all', lifecycle: 'all', objectType: 'all', sortBy: 'name', sortDir: 'asc' },
    setSearch() {}, setOwnerFilter() {}, setLifecycleFilter() {}, setObjectTypeFilter() {},
    setSortBy() {}, setSortDir() {},
    selectDrive(id) { selected = id; render(); },
    openDrive() {}, selectFile() {}, openFolder() {}, openBreadcrumb() {},
    showDriveCatalog() {}, refresh() {},
    previousDrivePage() { currentPage = Math.max(1, currentPage - 1); render(); },
    nextDrivePage() { currentPage = Math.min(2, currentPage + 1); render(); },
    operations: { createDrive() {}, renameDrive(_drive, name) { return commitName(name); }, deleteDrive() {} },
  };
  root.render(React.createElement(React.Fragment,null,React.createElement(StorageStudioWorkspace, { controller,
    inspectorSlots:{driveAccess:()=>React.createElement('div',{'data-testid':'grant-context','data-target':permissionTarget,
      'data-scope':window.__storagePermissionScope,'data-admin':String(permissionAdmin)},permissionVisible?React.createElement(StorageDrivePermissionsPanel,{driveId:permissionTarget,canAdmin:permissionAdmin,
      onChanged(){permissionChanges+=1}}):React.createElement('p',null,'Permission editor removed'))} }),React.createElement(Toaster)));
}

window.__storagePermissionHarness={
  write(kind,target){return new Promise((resolve,reject)=>{permissionWrites.push({id:++grantSequence,kind,target,settled:false,resolve,reject})})},
  writes(){return permissionWrites.map(({id,kind,target,settled})=>({id,kind,target,settled}))},
  resolve(id){const item=permissionWrites.find(item=>item.id===id);item.settled=true;item.resolve()},
  reject(id){const item=permissionWrites.find(item=>item.id===id);item.settled=true;item.reject(new Error('Synthetic private grant error'))},
  refresh(){permissionRefreshes+=1},refreshes(){return permissionRefreshes},changes(){return permissionChanges},events(){return permissionEvents},
  target(value){permissionTarget=value;render()},scope(value){window.__storagePermissionScope=value;render()},
  admin(value){permissionAdmin=value;render()},remove(){permissionVisible=false;render()},
};

window.__storageStudioHarness = {
  resolve() { pending?.(); pending = null; },
  remote(name) { driveName = name; revision += 1; render(); },
  clearSelection() { selected = null; render(); },
  commits() { return commitValues; },
  page() { return currentPage; },
  showAccess() { selected = 'drive-1'; render(); },
};
render();
`;
}
