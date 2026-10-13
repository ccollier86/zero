/** Fresh installed picker/menu archive qualification; bounded synthetic consumers only, without publication or app bootstrap. */
import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const DIAGNOSTICS = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/ordinary-scroll-adoption';
const SOURCE_ROOT = new URL('../../../../', import.meta.url).pathname;
const ORIGINALS = {
  'src/components/controls/date-time/date-picker.tsx': '1ce7fd94485db70e992c37a79107a8ed15501d32b640bc03a568240e93b08787',
  'src/components/controls/date-time/calendar.tsx': 'f4bda65ee93e083ccb4361afddbff10f500dc048b83898e7c15db0935cd5095c',
  'src/components/controls/date-time/calendar-view-context.tsx': 'b0921a5c3d803c26b60eb2d2771257f5194898836ce08496167c104ce9a1eb2e',
  'src/components/controls/date-time/calendar-month-presentation.tsx': '63f508816375b8aa2bf45a7b1b8bc15ec7cc3294b0855f9a7bcac0edb11cfd25',
  'src/components/context-menu/context-menu-content.tsx': '4d73d76a333f21c798f568b3a4c6c7d3dbfbe4c171a8aad8a854a40270c3732c',
  'src/components/context-menu/context-menu-surface.tsx': '1319e5dabaf9c8192fd7ebc67ec1406c10e8650e093e238077cd1ac4ae759054',
  'src/components/context-menu/context-menu-styles.ts': '04ea6734cb8b8fccc0c998d97f5201ec2904cab8c0467f75adbf03bf208bdc6a',
  'src/modals/modal-shell.tsx': '08c87f4fadfdd31eb0b1c8f8554acf2aad1071855ec1c1f736d1497fb87251f9',
  'src/modals/modal-shell.css': 'c11d71c03295ace5a48549fbf98a15114099f261e92358cd5ec8af934ee1ad1f',
  'src/components/_internal/scroll-viewport/scroll-viewport.css': '8fb6b6ed8845afd8547a70dc08bc6bed4e6444de77f8d6c08cacadd9e3e992e5',
  'src/frontend/styles/globals.css': 'af1682801435cc0ceef66a2a472099b7adc25e9e55b626ce56d1815a9e2a282d',
} as const;
// Shared scroll policy/fade helpers and the next picker supplement have approved
// Oct 13 fixes. Installed/source identity still includes them; only the original
// picker/menu/modal owners, skin and legacy theme remain byte-frozen.
const QUALIFIED_SOURCE = [...new Set([
  ...Object.keys(ORIGINALS),
  'src/components/_internal/scroll-viewport/use-scroll-viewport.ts',
  'src/components/_internal/scroll-viewport/scroll-viewport-decoration.tsx',
  'src/components/_internal/scroll-viewport/scroll-viewport-metrics.ts',
  'src/components/ui/scroll-area.tsx', 'src/frontend/styles/theme-next.css',
  'src/components/controls/date-time/date-picker-scroll.tsx', 'src/components/controls/date-time/index.ts',
  'src/components/ui/date-picker.tsx', 'src/components/controls/date-time/calendar.tsx',
  'src/components/controls/date-time/calendar-view-context.tsx', 'src/components/controls/date-time/calendar-month-presentation.tsx',
  'src/components/context-menu/index.ts', 'src/components/context-menu/context-menu.props.ts',
  'src/components/context-menu/context-menu-scroll-content.tsx', 'src/components/context-menu/context-menu-scroll.css',
  'src/components/context-menu/context-menu-viewport.tsx',
  'src/components/context-menu/context-menu-floating-surface.ts',
  'src/components/context-menu/context-menu-root.tsx', 'src/components/context-menu/context-menu-items.tsx',
  'src/components/context-menu/context-menu-submenu.tsx',
  'src/components/_internal/scroll-viewport/scroll-viewport-attachment.tsx',
  'src/components/_internal/scroll-viewport/scroll-viewport-decoration-next.tsx',
  'src/components/_internal/scroll-viewport/scroll-viewport-interactions.ts',
  'src/components/_internal/scroll-viewport/scroll-viewport-next.css',
  'src/components/_internal/overlay-scope/overlay-scope.tsx',
  'src/frontend/index.ts', 'src/frontend/exports/controls/menus.ts', 'src/frontend/exports/controls/menu-scroll.ts', 'src/frontend/exports/controls/pickers.ts',
  'src/add/copy.ts', 'src/add/registry.ts', 'src/add/component-compatibility.ts',
  'src/add/run.ts', 'src/cli/run.ts', 'src/doctor/source-only-upgrade-exports.ts',
  'src/testing/test-suite-resources.ts',
])].sort();
const PUBLIC_TYPES = ['DatePickerProps', 'DatePickerCalendarProps', 'ContextMenuContentProps', 'ContextMenuSubContentProps', 'ContextMenuViewportProps', 'ContextMenuScrollOptions'];
const COPY_PATHS = ['components/ui/date-picker.tsx', 'components/controls/date-time/date-picker.tsx',
  'components/controls/date-time/date-picker-scroll.tsx', 'components/context-menu/index.ts',
  'components/context-menu/context-menu-content.tsx', 'components/context-menu/context-menu-scroll-content.tsx',
  'components/context-menu/context-menu-viewport.tsx', 'components/context-menu/context-menu-scroll.css',
  'components/context-menu/context-menu-floating-surface.ts',
  'components/_internal/scroll-viewport/scroll-viewport-attachment.tsx',
  'components/_internal/scroll-viewport/scroll-viewport-decoration-next.tsx',
  'components/_internal/scroll-viewport/scroll-viewport-interactions.ts',
  'components/_internal/scroll-viewport/scroll-viewport-next.css',
  'components/_internal/scroll-viewport/use-scroll-viewport.ts',
  'components/_internal/scroll-viewport/scroll-viewport.css'];

test('fresh installed ordinary-scroll archive retains public identity, native SSR, original bytes and actual CLI closure', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const allocation = await mkdtemp(join(SCRATCH, 'ordinary-scroll-package-'));
  const consumer = join(allocation, 'consumer'), archive = join(allocation, 'framework.tgz');
  try {
    await mkdir(consumer, { recursive: true });
    await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], SOURCE_ROOT);
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({ name: 'zero-ordinary-scroll-consumer', private: true, type: 'module',
      scripts: { postinstall: "bun --no-env-file -e \"require('node:fs').writeFileSync('POSTINSTALL_MUST_NOT_RUN','executed')\"" },
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4',
        '@types/bun': 'latest', '@types/react': '^19.2.14', '@types/react-dom': '^19.2.3', typescript: '^5.7.0' } }));
    await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext',
      moduleResolution: 'Bundler', strict: true, skipLibCheck: true, esModuleInterop: true, jsx: 'react-jsx',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: ['bun'], paths: { '@/*': ['./*'] } },
      include: ['consumer.tsx', 'copied-consumer.tsx'] }));
    await Bun.write(join(consumer, 'consumer.tsx'), CONSUMER);
    await Bun.write(join(consumer, 'verify.tsx'), VERIFY);
    await Bun.write(join(consumer, 'browser-consumer.ts'), BROWSER);
    const config = "import {writeFileSync} from 'node:fs';writeFileSync(new URL('./CONFIG_BOOT_MUST_NOT_RUN',import.meta.url),'executed');throw new Error('ORDINARY_SCROLL_CONFIG_MUST_NOT_EXECUTE');\n";
    await Bun.write(join(consumer, 'zero.config.ts'), config);
    await Bun.write(join(consumer, '.env'), 'ZERO_ORDINARY_SCROLL_ARCHIVE_ENV_TRIPWIRE=MUST_NOT_LOAD\n');
    await Bun.write(join(consumer, '.env.local'), 'ZERO_ORDINARY_SCROLL_ARCHIVE_LOCAL_ENV_TRIPWIRE=MUST_NOT_LOAD\n');
    await checked(['install', '--ignore-scripts'], consumer);
    const ownedOriginal = 'components/context-menu/context-menu-content.tsx';
    const initialCustom = await Bun.file(join(consumer, 'node_modules/@zero/framework/src', ownedOriginal)).text()
      + '\n/* CONSUMER ORIGINAL CUSTOMIZATION BEFORE FIRST ADD MUST SURVIVE */\n';
    await mkdir(dirname(join(consumer, ownedOriginal)), { recursive: true });
    await Bun.write(join(consumer, ownedOriginal), initialCustom);
    const addArgs = ['node_modules/@zero/framework/src/cli/run.ts', 'add', 'components/ui/date-picker', 'components/context-menu', '--target', consumer];
    expect(await checked(addArgs, consumer)).toContain('Zero add complete');
    expect(await Bun.file(join(consumer, ownedOriginal)).text()).toBe(initialCustom);
    for (const path of COPY_PATHS) expect(await Bun.file(join(consumer, path)).exists(), path).toBe(true);
    const custom = '\n/* CONSUMER-OWNED ORIGINAL MUST SURVIVE */\n';
    const customized = ['components/controls/date-time/date-picker.tsx', 'components/context-menu/context-menu-content.tsx',
      'components/context-menu/context-menu-styles.ts', 'components/_internal/scroll-viewport/scroll-viewport.css'];
    for (const path of customized) await Bun.write(join(consumer, path), await Bun.file(join(consumer, path)).text() + custom);
    expect(await checked(addArgs, consumer)).toMatch(/Written:\s+0 file\(s\)/u);
    for (const path of customized) expect(await Bun.file(join(consumer, path)).text(), path).toEndWith(custom);
    await Bun.write(join(consumer, 'copied-consumer.tsx'), COPIED_CONSUMER);
    await checked(['build', 'copied-consumer.tsx', '--target', 'browser', '--outdir', 'copied-build'], consumer);
    const copiedCss = await Bun.file(join(consumer, 'copied-build/copied-consumer.css')).text();
    for (const selector of ['.zero-scroll-decoration', 'data-zero-scroll-decoration', 'context-menu']) expect(copiedCss, selector).toContain(selector);
    await checked(['run', 'node_modules/typescript/bin/tsc', '--noEmit'], consumer);
    const result = JSON.parse((await checked(['verify.tsx'], consumer)).trim());
    expect(result.identity).toBe(true);
    expect(result.privateAdaptersExported).toBe(false);
    expect(result.publicTypes).toEqual(PUBLIC_TYPES);
    expect(result.sourceOnlyValues).toEqual(['available', 'available', 'available', 'available']);
    expect(result.sourceOnlyTypes).toEqual(PUBLIC_TYPES.map(() => 'available'));
    expect(result.ssrParity).toBe(true);
    expect(result.ssrComparisons).toBeGreaterThanOrEqual(6);
    expect(result.ssrNativeMenu).toContain('role="menu"');
    expect(result.ssrNativeMenu).toContain('role="menuitemcheckbox"');
    expect(result.ssrNativeMenu).not.toContain('zero-scroll-decoration');
    expect(result.ssrNativeMenu).not.toContain('data-zero-scroll-treatment');
    expect(result.ssrNativePicker).toContain('data-slot="date-picker"');
    expect(result.ssrNativePicker).toContain('data-slot="date-picker-trigger"');
    expect(result.ssrNativePicker).not.toContain('zero-scroll-decoration');
    expect(result.commandsInvoked).toBe(0);
    expect(result.originalThemeRetained).toBe(true);
    expect(result.browserFromInstalledArchive).toBe(true);
    expect(result.browserCss).toBe(true);
    expect(result.browserBytes).toBeGreaterThan(0);
    expect(result.copiedTestFiles).toEqual([]);
    expect(result.databaseFiles).toBe(0);
    expect(result.environmentNotLoaded).toBe(true);
    expect(result.applicationConfigNotExecuted).toBe(true);
    expect(result.installScriptsNotExecuted).toBe(true);
    expect(await Bun.file(join(consumer, 'zero.config.ts')).text()).toBe(config);
    const installed = join(consumer, 'node_modules/@zero/framework');
    const hashes: Record<string, string> = {};
    for (const path of QUALIFIED_SOURCE) {
      hashes[path] = await sha256(join(installed, path));
      expect(hashes[path], `Installed/source identity: ${path}`).toBe(await sha256(join(SOURCE_ROOT, path)));
    }
    for (const [path, hash] of Object.entries(ORIGINALS)) expect(hashes[path], `Retained original: ${path}`).toBe(hash);
    const metadata = await Bun.file(join(installed, 'package.json')).json();
    expect(metadata.exports['./components/context-menu']).toEqual({ types: './src/components/context-menu/index.ts', import: './src/components/context-menu/index.ts' });
    expect(metadata.exports['.']).toEqual(metadata.exports['./react']);
    await mkdir(DIAGNOSTICS, { recursive: true });
    await Bun.write(join(DIAGNOSTICS, 'package-consumer-evidence.json'), JSON.stringify({
      version: metadata.version, sha256: await sha256(archive), snapshot: 'dirty', published: false,
      scope: 'bounded DatePicker outer days/months + ContextMenu/SubContent additive scroll skins, explicit native/asChild fallback and composed viewport; synthetic consumers only',
      publicFacadeIdentity: true, publicTypeIdentity: true, publicTypes: PUBLIC_TYPES,
      strictProductionAndConsumerTypes: true, sourceOnlyNamedExports: true, privateAdaptersRemainPrivate: true,
      ssrOriginalParity: true, ssrComparisons: result.ssrComparisons,
      ssrScope: 'closed DatePicker input/button in both modes; native ContextMenu standard/asChild; opaque Arc asChild host',
      commandsInvoked: result.commandsInvoked,
      originalFilesByteIdentical: Object.keys(ORIGINALS).length, originalThemeRetained: true,
      browserFromInstalledArchive: true, browserCss: true, browserBytes: result.browserBytes,
      actualInstalledCliCopyBuild: true, copiedCustomOriginalsRetained: true, copiedTestFiles: result.copiedTestFiles,
      configTripwireNotExecuted: true, installScriptsNotExecuted: true, environmentNotLoaded: true, databaseFiles: 0,
      qualifiedSourceSha256: hashes, preservedOriginalSha256: ORIGINALS, verifiedAt: new Date().toISOString(),
    }, null, 2));
  } finally {
    // Only this exact newly allocated archive/consumer is disposable; all original framework files remain.
    await rm(allocation, { recursive: true, force: true });
  }
}, 240_000);

/** Minimal child environment with explicit .env suppression and bounded lifecycle-free commands. */
async function checked(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], { cwd, stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH, TMPDIR: SCRATCH, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' } });
  let expired = false;
  const timeout = setTimeout(() => { expired = true; child.kill(); }, 110_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (expired || code !== 0) throw new Error(`Ordinary scroll archive qualification failed (${expired ? 'timeout' : code}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally { clearTimeout(timeout); }
}
async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(new Uint8Array(await Bun.file(path).arrayBuffer())).digest('hex');
}

const CONSUMER = `
import * as React from 'react';
import * as Root from '@zero/framework';
import * as ReactFacade from '@zero/framework/react';
import * as Picker from '@zero/framework/components/ui/date-picker';
import * as Menu from '@zero/framework/components/context-menu';
type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
type Assert<T extends true> = T;
export type PublicTypeIdentity = [
  Assert<Equal<Picker.DatePickerProps,Root.DatePickerProps>>, Assert<Equal<Picker.DatePickerProps,ReactFacade.DatePickerProps>>,
  Assert<Equal<Picker.DatePickerCalendarProps,Root.DatePickerCalendarProps>>, Assert<Equal<Picker.DatePickerCalendarProps,ReactFacade.DatePickerCalendarProps>>,
  Assert<Equal<Menu.ContextMenuContentProps,Root.ContextMenuContentProps>>, Assert<Equal<Menu.ContextMenuContentProps,ReactFacade.ContextMenuContentProps>>,
  Assert<Equal<Menu.ContextMenuSubContentProps,Root.ContextMenuSubContentProps>>, Assert<Equal<Menu.ContextMenuSubContentProps,ReactFacade.ContextMenuSubContentProps>>,
  Assert<Equal<Menu.ContextMenuViewportProps,Root.ContextMenuViewportProps>>, Assert<Equal<Menu.ContextMenuViewportProps,ReactFacade.ContextMenuViewportProps>>,
  Assert<Equal<Menu.ContextMenuScrollOptions,Root.ContextMenuScrollOptions>>, Assert<Equal<Menu.ContextMenuScrollOptions,ReactFacade.ContextMenuScrollOptions>>,
  Assert<Equal<Picker.DatePickerProps['scrollTreatment'],'arc'|'native'|undefined>>,
  Assert<Equal<Menu.ContextMenuContentProps['scrollTreatment'],'arc'|'native'|undefined>>,
  Assert<Equal<Menu.ContextMenuSubContentProps['scrollTreatment'],'arc'|'native'|undefined>>,
];
export const identity = Picker.DatePicker===Root.DatePicker && Root.DatePicker===ReactFacade.DatePicker
  && Menu.ContextMenuContent===Root.ContextMenuContent && Root.ContextMenuContent===ReactFacade.ContextMenuContent
  && Menu.ContextMenuSubContent===Root.ContextMenuSubContent && Root.ContextMenuSubContent===ReactFacade.ContextMenuSubContent
  && Menu.ContextMenuViewport===Root.ContextMenuViewport && Root.ContextMenuViewport===ReactFacade.ContextMenuViewport;
export const publicTypes = ['DatePickerProps','DatePickerCalendarProps','ContextMenuContentProps','ContextMenuSubContentProps','ContextMenuViewportProps','ContextMenuScrollOptions'];
export const privateAdaptersExported = ['ScrollViewportDecorationNext','ScrollViewportAttachment'].some(name=>name in Root||name in ReactFacade||name in Picker||name in Menu);
let invoked=0;
export const commandsInvoked=()=>invoked;
export const arc: Picker.DatePickerProps = {scrollTreatment:'arc',value:new Date(2026,1,3),onChange:()=>{invoked++;},inputProps:{'aria-label':'Installed date'}};
export const native: Root.DatePickerProps = {...arc,scrollTreatment:'native'};
const content: Menu.ContextMenuContentProps = {scrollTreatment:'arc',portal:false,forceMount:true,orientation:'both',
  fadeEdges:true,scrollbars:'always',viewportRef:React.createRef<HTMLDivElement>(),viewportClassName:'bounded-actions',viewportStyle:{maxHeight:180}};
const subcontent: ReactFacade.ContextMenuSubContentProps = {scrollTreatment:'native',portal:false,forceMount:true,
  orientation:'vertical',fadeEdges:false,scrollbars:'hidden'};
const customViewport: Menu.ContextMenuViewportProps = {orientation:'horizontal',fadeEdges:true,scrollbars:'scroll',
  ref:React.createRef<HTMLDivElement>(),onScroll:event=>{const nativeViewport:HTMLDivElement=event.currentTarget;void nativeViewport;}};
export const invalidPicker: Picker.DatePickerProps = {
  // @ts-expect-error Only the two supported scroll treatments are admitted.
  scrollTreatment:'unapproved'};
export const invalidMenu: Menu.ContextMenuContentProps = {
  // @ts-expect-error Only the two supported scroll treatments are admitted.
  scrollTreatment:'unapproved'};
export const invalidSubMenu: Menu.ContextMenuSubContentProps = {
  // @ts-expect-error The submenu keeps the same two supported treatments.
  scrollTreatment:'unapproved'};
export const examples = <><Picker.DatePicker {...arc}/><Root.DatePicker {...native}/>
  <Menu.ContextMenu><Menu.ContextMenuTrigger>Record</Menu.ContextMenuTrigger><Menu.ContextMenuContent {...content}>
    <Menu.ContextMenuItem onSelect={()=>{invoked++;}}>Inspect</Menu.ContextMenuItem><Menu.ContextMenuSub>
      <Menu.ContextMenuSubTrigger>Export</Menu.ContextMenuSubTrigger><Menu.ContextMenuSubContent {...subcontent}>
        <Menu.ContextMenuItem>JSON</Menu.ContextMenuItem></Menu.ContextMenuSubContent></Menu.ContextMenuSub>
  </Menu.ContextMenuContent></Menu.ContextMenu>
  <Menu.ContextMenu><Menu.ContextMenuTrigger>Composed</Menu.ContextMenuTrigger><Menu.ContextMenuContent asChild>
    <section><Menu.ContextMenuViewport {...customViewport}><Menu.ContextMenuItem>Composed action</Menu.ContextMenuItem></Menu.ContextMenuViewport></section>
  </Menu.ContextMenuContent></Menu.ContextMenu></>;
`;
const COPIED_CONSUMER = `
import {DatePicker} from './components/ui/date-picker';
import type {DatePickerProps} from './components/ui/date-picker';
import {ContextMenu,ContextMenuTrigger,ContextMenuContent,ContextMenuSub,ContextMenuSubTrigger,ContextMenuSubContent,ContextMenuItem,ContextMenuViewport} from './components/context-menu';
import type {ContextMenuContentProps,ContextMenuSubContentProps,ContextMenuViewportProps} from './components/context-menu';
export const arc:DatePickerProps={scrollTreatment:'arc'};
export const native:DatePickerProps={scrollTreatment:'native'};
export const content:ContextMenuContentProps={scrollTreatment:'arc'};
export const subcontent:ContextMenuSubContentProps={scrollTreatment:'native'};
export const viewport:ContextMenuViewportProps={'aria-label':'Composed actions'};
export const example=<><DatePicker {...arc}/><DatePicker {...native}/><ContextMenu><ContextMenuTrigger>Copied record</ContextMenuTrigger>
  <ContextMenuContent {...content}><ContextMenuItem>Inspect</ContextMenuItem><ContextMenuSub><ContextMenuSubTrigger>Export</ContextMenuSubTrigger>
    <ContextMenuSubContent {...subcontent}><ContextMenuItem>JSON</ContextMenuItem></ContextMenuSubContent></ContextMenuSub></ContextMenuContent>
</ContextMenu><ContextMenu><ContextMenuTrigger>Custom copied</ContextMenuTrigger><ContextMenuContent asChild><section>
  <ContextMenuViewport {...viewport}><ContextMenuItem>Custom action</ContextMenuItem></ContextMenuViewport>
</section></ContextMenuContent></ContextMenu></>;
`;
const BROWSER = `
import '@zero/framework/styles.css';
export {DatePicker} from '@zero/framework/components/ui/date-picker';
export {ContextMenuContent,ContextMenuSubContent,ContextMenuViewport} from '@zero/framework/components/context-menu';
export {DatePicker as RootDatePicker,ContextMenuViewport as RootViewport} from '@zero/framework';
export {DatePicker as ReactDatePicker,ContextMenuViewport as ReactViewport} from '@zero/framework/react';
`;
const VERIFY = `
import * as React from 'react';
import {join} from 'node:path';
import {realpath} from 'node:fs/promises';
import {renderToStaticMarkup} from 'react-dom/server';
import * as Menu from '@zero/framework/components/context-menu';
import {DatePicker} from '@zero/framework/components/ui/date-picker';
import {DatePicker as NativeDatePicker} from './node_modules/@zero/framework/src/components/controls/date-time/date-picker';
import {ContextMenuContent as NativeContent,ContextMenuSubContent as NativeSubContent} from './node_modules/@zero/framework/src/components/context-menu/context-menu-content';
import {identity,publicTypes,privateAdaptersExported,arc,native,commandsInvoked} from './consumer';
const root=process.cwd(),installed=join(root,'node_modules/@zero/framework');
const metadata=await Bun.file(join(installed,'package.json')).json();
const {SourceOnlyUpgradeExports}=await import(join(installed,'src/doctor/source-only-upgrade-exports.ts'));
const inspector=new SourceOnlyUpgradeExports(installed,metadata.exports),sourceOnlyValues=[],sourceOnlyTypes=[];
sourceOnlyValues.push((await inspector.inspect('@zero/framework/components/ui/date-picker','DatePicker','value')).status);
for(const name of ['ContextMenuContent','ContextMenuSubContent','ContextMenuViewport']) sourceOnlyValues.push((await inspector.inspect('@zero/framework/components/context-menu',name,'value')).status);
for(const name of publicTypes) sourceOnlyTypes.push((await inspector.inspect(name.startsWith('Date')?'@zero/framework/components/ui/date-picker':'@zero/framework/components/context-menu',name,'any')).status);
const normalize=value=>value.replace(/_R_[^" ]*_/gu,'SSR-ID');
const menuMarkup=(original,asChild=false,scrollTreatment='native')=>{
  const Content=original?NativeContent:Menu.ContextMenuContent,SubContent=original?NativeSubContent:Menu.ContextMenuSubContent;
  const rows=<><Menu.ContextMenuLabel>Record actions</Menu.ContextMenuLabel><Menu.ContextMenuItem>Inspect</Menu.ContextMenuItem>
    <Menu.ContextMenuCheckboxItem checked indicatorPosition="right">Pinned</Menu.ContextMenuCheckboxItem>
    <Menu.ContextMenuSub><Menu.ContextMenuSubTrigger>Export</Menu.ContextMenuSubTrigger>
      <SubContent portal={false} forceMount {...(original?{}:{scrollTreatment:asChild?'native':scrollTreatment})}><Menu.ContextMenuItem>JSON</Menu.ContextMenuItem></SubContent>
    </Menu.ContextMenuSub></>;
  return renderToStaticMarkup(<Menu.ContextMenu><Menu.ContextMenuTrigger>Installed record</Menu.ContextMenuTrigger>
    <Content portal={false} forceMount asChild={asChild} {...(original?{}:{scrollTreatment})}>
      {asChild?<section aria-label="Owned native host">{rows}</section>:rows}</Content></Menu.ContextMenu>);
};
let ssrParity=true,ssrComparisons=0;
const {scrollTreatment,...nativeProps}=native;
for(const appearance of ['input','button']) {
  const legacy=normalize(renderToStaticMarkup(<NativeDatePicker {...nativeProps} appearance={appearance}/>));
  for(const treatment of ['arc','native']) {ssrParity=ssrParity&&legacy===normalize(renderToStaticMarkup(<DatePicker {...nativeProps} appearance={appearance} scrollTreatment={treatment}/>));ssrComparisons++;}
}
for(const asChild of [false,true]) {
  ssrParity=ssrParity&&normalize(menuMarkup(true,asChild))===normalize(menuMarkup(false,asChild));ssrComparisons++;
}
ssrParity=ssrParity&&normalize(menuMarkup(true,true))===normalize(menuMarkup(false,true,'arc'));ssrComparisons++;
const browser=await Bun.build({entrypoints:[join(root,'browser-consumer.ts')],target:'browser',format:'esm'});
if(!browser.success) throw new Error(browser.logs.map(log=>log.message).join('\\n'));
const css=(await Promise.all(browser.outputs.filter(output=>output.path.endsWith('.css')).map(output=>output.text()))).join('\\n');
const browserCss=['.zero-scroll-decoration','data-zero-scroll-decoration','context-menu'].every(selector=>css.includes(selector));
const browserFromInstalledArchive=(await realpath(Bun.resolveSync('@zero/framework/components/ui/date-picker',root))).startsWith(await realpath(installed)+'/')
  &&(await realpath(Bun.resolveSync('@zero/framework/components/context-menu',root))).startsWith(await realpath(installed)+'/');
const application=await Bun.file(Bun.resolveSync('@zero/framework/styles.css',root)).text();
const originalThemeRetained=Bun.resolveSync('@zero/framework/styles-legacy.css',root).endsWith('/src/frontend/styles/globals.css')
  &&application.includes('@import "./globals.css";')&&application.includes('@import "./theme-next.css";');
const copied=[...new Bun.Glob('**/*.{ts,tsx,css}').scanSync({cwd:root,onlyFiles:true})].filter(path=>/^(components|hooks|lib|modals)\\//u.test(path));
const copiedTestFiles=copied.filter(path=>/\\.(?:test|spec)\\.|\\.(?:browser|test|package)-fixture\\./u.test(path));
const databaseFiles=[...new Bun.Glob('**/*.{db,sqlite,sqlite3}').scanSync({cwd:root,onlyFiles:true})].filter(path=>!path.startsWith('node_modules/')).length;
console.log(JSON.stringify({identity,publicTypes,privateAdaptersExported,sourceOnlyValues,sourceOnlyTypes,ssrParity,ssrComparisons,
  ssrNativeMenu:menuMarkup(false),ssrNativePicker:renderToStaticMarkup(<DatePicker {...native}/>),commandsInvoked:commandsInvoked(),
  originalThemeRetained,browserFromInstalledArchive,browserCss,browserBytes:browser.outputs.reduce((sum,output)=>sum+output.size,0),copiedTestFiles,databaseFiles,
  environmentNotLoaded:process.env.ZERO_ORDINARY_SCROLL_ARCHIVE_ENV_TRIPWIRE===undefined&&process.env.ZERO_ORDINARY_SCROLL_ARCHIVE_LOCAL_ENV_TRIPWIRE===undefined,
  applicationConfigNotExecuted:!(await Bun.file(join(root,'CONFIG_BOOT_MUST_NOT_RUN')).exists()),
  installScriptsNotExecuted:!(await Bun.file(join(root,'POSTINSTALL_MUST_NOT_RUN')).exists())}));
`;
