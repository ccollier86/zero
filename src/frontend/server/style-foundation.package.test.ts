/** Qualify the backing facade, managed build and source-only Doctor in an isolated installed archive; never publish or start services. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const DIAGNOSTICS = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/theme-foundation';
const QUALIFIED_SOURCE = [
  'src/doctor/source-only-doctor.ts', 'src/doctor/source-only-types.ts', 'src/doctor/run.ts',
  'src/cli/run.ts', 'src/doctor/source-only-theme-foundation.ts',
  'src/doctor/source-only-upgrade-types.ts', 'src/doctor/source-only-upgrade-catalog.ts',
  'src/doctor/source-only-upgrade-target.ts', 'src/doctor/source-only-upgrade-exports.ts',
  'src/doctor/source-only-upgrade-bindings.ts', 'src/doctor/source-only-upgrade-checks.ts',
  'src/doctor/source-only-upgrade-assets.ts',
  'src/add/registry.ts', 'src/add/copy.ts', 'src/add/component-compatibility.ts', 'src/frontend/index.ts',
  ...[...new Bun.Glob('src/frontend/exports/**/*.ts').scanSync({ cwd: process.cwd(), onlyFiles: true })].sort(),
  'src/components/surfaces/card/index.ts', 'src/components/surfaces/card/card.tsx',
  'src/components/surfaces/card/content-card.tsx', 'src/components/surfaces/card/content-card.css',
  'src/components/surfaces/card/card-presentation.ts', 'src/components/surfaces/card/card-status.tsx',
  'src/components/controls/select/index.ts', 'src/components/controls/select/select.tsx',
  'src/components/controls/select/select-morph.css', 'src/components/controls/select/select-morph-motion.ts',
  'src/components/controls/select/select-magnetic.ts', 'src/components/controls/select/select-motion-geometry.ts',
  'src/components/controls/select/select-paint.ts',
  'src/components/ui/card.tsx', 'src/components/ui/content-card.tsx', 'src/components/ui/content-card.css',
  'src/components/ui/card-presentation.ts', 'src/components/ui/card-status.tsx',
  'src/components/ui/select.tsx', 'src/components/ui/select-morph.css', 'src/components/ui/select-morph-motion.ts',
  'src/components/ui/select-magnetic.ts', 'src/components/ui/select-motion-geometry.ts', 'src/components/ui/select-paint.ts',
  ...[
    ...new Bun.Glob('src/components/controls/date-time/*.{ts,tsx}').scanSync({ cwd: process.cwd(), onlyFiles: true }),
    ...new Bun.Glob('src/components/surfaces/popover/*.{ts,tsx}').scanSync({ cwd: process.cwd(), onlyFiles: true }),
    ...new Bun.Glob('src/components/_internal/**/*.{ts,tsx,css}').scanSync({ cwd: process.cwd(), onlyFiles: true }),
  ].filter(path => !/\.(?:test|spec)\.|\.browser-fixture\./u.test(path)).sort(),
  ...['calendar.tsx', 'calendar-month-presentation.tsx', 'calendar-view-context.tsx', 'calendar-view-model.ts',
    'calendar-view-motion.ts', 'calendar-motion.ts', 'date-picker.tsx', 'date-picker-value.ts', 'date-range-picker.tsx',
    'time-picker.tsx', 'time-picker-value.ts', 'picker-value-text.tsx', 'picker-popover-motion.ts'].map(name => `src/components/ui/${name}`),
  'src/components/popover/index.ts', 'src/components/animate-ui/components/radix/popover.tsx',
  'src/components/animate-ui/primitives/radix/popover.tsx',
  ...['overlay-scope.tsx', 'anchored-surface-motion.ts', 'anchored-surface.css', 'scroll-viewport-decoration.tsx',
    'use-scroll-viewport.ts', 'scroll-viewport-metrics.ts', 'scroll-viewport.css', 'menu-active-highlight.tsx',
    'menu-active-highlight.css'].map(name => `src/components/overlays/${name}`),
  'src/frontend/styles/application.css', 'src/frontend/styles/globals.css', 'src/frontend/styles/theme-next.css',
] as const;

test('packed theme backing defaults to next CSS and checks sources without importing application configuration', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'theme-foundation-package-'));
  const consumer = join(root, 'consumer'), archive = join(root, 'framework.tgz');
  try {
    await mkdir(join(consumer, 'app'), { recursive: true });
    await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], process.cwd());
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({ name: 'zero-theme-backing-consumer', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4',
        '@types/bun': 'latest', '@types/react': '^19.2.14', '@types/react-dom': '^19.2.3', typescript: '^5.7.0' } }));
    await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext',
      moduleResolution: 'Bundler', strict: true, skipLibCheck: true, esModuleInterop: true, jsx: 'react-jsx',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: ['bun'] }, include: ['consumer.ts'] }));
    await Bun.write(join(consumer, 'consumer.ts'), CONSUMER);
    await Bun.write(join(consumer, 'verify.ts'), VERIFY);
    await Bun.write(join(consumer, 'zero.config.ts'), "throw new Error('APPLICATION_CONFIG_MUST_NOT_EXECUTE');\n");
    await Bun.write(join(consumer, '.env'), 'THEME_CONFIG_TRIPWIRE=MUST_NOT_LOAD\n');
    await Bun.write(join(consumer, 'app/theme-usage.ts'), "import { createThemeAttributes } from '@zero/framework/design-system';\nexport const attributes = createThemeAttributes();\nexport const style = 'color:var(--zero-theme-text-primary)';\n");
    await checked(['install', '--ignore-scripts'], consumer);
    await checked(['run', 'node_modules/typescript/bin/tsc', '--noEmit'], consumer);
    const result = JSON.parse((await checked(['verify.ts'], consumer)).trim());
    expect(result.foundation).toBe('next');
    expect(result.managedDefault).toBe('next');
    expect(result.explicitLegacy).toBe('legacy');
    expect(result.cssScoped).toBe(true);
    expect(result.parity).toBe(true);
    expect(result.roles).toBeGreaterThanOrEqual(405);
    expect(result.browserBytes).toBeGreaterThan(0);
    expect(result.html).toContain('<h1');
    expect(result.html).toContain('data-zero-typography="page"');
    expect(result.defaultShellHtml).toContain('data-zero-theme="next"');
    expect(result.defaultShellHtml).toContain('data-zero-density="compact"');
    expect(result.legacyShellHtml).not.toContain('data-zero-theme');
    expect(result.defaultShellHtml.replace(/ data-zero-theme="next"| data-zero-density="compact"/gu, '')).toBe(result.legacyShellHtml);
    expect(result.stylesApplicationEntry).toBe(true);
    expect(result.stylesApplicationImports).toBe(true);
    expect(result.stylesLegacyEntry).toBe(true);
    expect(result.browserAppShell).toBe(true);
    expect(result.browserControls).toBe(true);
    expect(result.dateTimeSsr).toBe(true);
    expect(result.organizedIdentity).toBe(true);
    expect(result.runtimeSetups).toBe(0);
    expect(result.databaseFiles).toBe(0);
    expect(result.environmentNotLoaded).toBe(true);
    const report = JSON.parse((await checked(['run', 'node_modules/@zero/framework/src/cli/run.ts', 'doctor', '--source-only',
      '--theme-foundation', '--upgrade', '--project-root', consumer, '--usage-include', 'app', '--json'], consumer)).trim());
    expect(report.mode).toBe('source-only');
    expect(report.themeFoundation.bundledStyles).toBe('verified');
    expect(report.themeFoundation.reviewCounts.unresolvedCanonicalReferences).toBe(0);
    expect(report.findings.filter((finding: { severity: string }) => finding.severity === 'error')).toEqual([]);
    expect(report.upgrade.catalogVersion).toBe(1);
    expect(report.upgrade.target.status).toBe('installed');
    expect(report.upgrade.target.capabilities.contentCard).toBe('available');
    expect(report.upgrade.target.capabilities.dropdownInnerViewport).toBe('available');
    expect(report.upgrade.target.fingerprint.value).toMatch(/^[a-f\d]{64}$/u);
    expect(report.upgrade.coverage).toBe('bounded-static');
    const sourceHashes: Record<string, string> = {};
    for (const path of QUALIFIED_SOURCE) {
      const installed = createHash('sha256').update(new Uint8Array(await Bun.file(join(consumer, 'node_modules/@zero/framework', path)).arrayBuffer())).digest('hex');
      const current = createHash('sha256').update(new Uint8Array(await Bun.file(path).arrayBuffer())).digest('hex');
      expect(installed, `Installed qualification must match the final source snapshot: ${path}`).toBe(current);
      sourceHashes[path] = installed;
    }
    await mkdir(DIAGNOSTICS, { recursive: true });
    await Bun.write(join(DIAGNOSTICS, 'package-consumer-evidence.json'), JSON.stringify({
      version: (await Bun.file('package.json').json()).version,
      sha256: createHash('sha256').update(new Uint8Array(await Bun.file(archive).arrayBuffer())).digest('hex'),
      snapshot: 'dirty', scope: 'fresh installed archive consumer; no publication or application services',
      managedNextBuild: true, foundationParity: true, publicConsumerTypes: true,
      publicAppShellTypes: true, appShellDefaultNextSsr: true, appShellExplicitLegacySsr: true,
      publicStylesheetExports: true, browserAppShell: result.browserAppShell,
      organizedFamilies: ['card', 'select', 'date-time', 'popover', 'shared-overlay-mechanisms'],
      dateTimeSsr: result.dateTimeSsr, organizedIdentity: result.organizedIdentity,
      sourceOnlyUpgrade: true, upgradeCatalogVersion: report.upgrade.catalogVersion,
      upgradeTargetFingerprint: report.upgrade.target.fingerprint,
      qualifiedSourceSha256: sourceHashes,
      browserBytes: result.browserBytes, sourceOnlyDoctor: true, configTripwireNotExecuted: true,
      environmentNotLoaded: true, databaseFiles: result.databaseFiles, verifiedAt: new Date().toISOString(),
    }, null, 2));
  } finally { await rm(root, { recursive: true, force: true }); }
}, 180_000);

/** Every child disables .env loading, lifecycle scripts and inherited service credentials. */
async function checked(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], { cwd, stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH, TMPDIR: SCRATCH, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' } });
  let expired = false;
  const timeout = setTimeout(() => { expired = true; child.kill(); }, 110_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (expired || code !== 0) throw new Error(`Theme backing package qualification failed (${expired ? 'timeout' : code}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally { clearTimeout(timeout); }
}

const CONSUMER = `
import * as React from 'react';
import { defineZeroConfig, prepareAppBuild, type AppThemeFoundation } from '@zero/framework/server';
import { AppShell, type AppShellProps } from '@zero/framework/components/app-shell';
import { Card, CardAction, CardMedia, ContentCard, type ContentCardProps,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue, type SelectContentProps,
  Popover, PopoverTrigger, PopoverContent, PopoverViewport, type PopoverViewportProps,
  ScrollArea, type ScrollAreaProps,
  Calendar, DatePicker, DateRangePicker, TimePicker,
  type CalendarProps, type DatePickerProps, type DateRangePickerProps, type TimePickerProps } from '@zero/framework/react';
import { createThemeAttributes, createThemeTokens, getThemeTokenCatalog } from '@zero/framework/design-system';
import { configureObservability, emitPlatformCodeTo } from '@zero/framework/observability';
import { getSourceOnlyUpgradeCatalog, SOURCE_ONLY_UPGRADE_CATALOG_VERSION,
  type SourceOnlyUpgradeOption, type SourceOnlyUpgradeSummary } from '@zero/framework/doctor';
const observability = configureObservability(false);
export const foundation: AppThemeFoundation = 'next';
export const defaultShellProps: AppShellProps = { preset:'minimal', children:'Application' };
export const legacyShellProps: AppShellProps = { ...defaultShellProps, themeFoundation:'legacy' };
export const nextShellProps: AppShellProps = { ...defaultShellProps, themeFoundation:foundation };
export const defaultShell = React.createElement(AppShell, defaultShellProps);
export const legacyShell = React.createElement(AppShell, legacyShellProps);
export const nextShell = React.createElement(AppShell, nextShellProps);
export const attributes = createThemeAttributes({ mode: 'system', density: 'compact' });
export const tokens = createThemeTokens({ mode: 'dark' });
export const catalog = getThemeTokenCatalog();
export const upgradeOption: SourceOnlyUpgradeOption = true;
export const upgradeCatalog = getSourceOnlyUpgradeCatalog();
export const upgradeCatalogVersion: number = SOURCE_ONLY_UPGRADE_CATALOG_VERSION;
export type UpgradeEvidence = SourceOnlyUpgradeSummary;
const contentCardProps: ContentCardProps = {title:'Project',description:'Summary',status:'Updated',details:'Extra details'};
const selectContentProps: SelectContentProps = {fadeEdges:true,scrollbars:'hover',viewportRef:React.createRef<HTMLDivElement>()};
const popoverViewportProps: PopoverViewportProps = {orientation:'both',fadeEdges:true,ref:React.createRef<HTMLDivElement>()};
const scrollAreaProps: ScrollAreaProps = {orientation:'both',viewportRef:React.createRef<HTMLDivElement>()};
const calendarProps: CalendarProps = {mode:'single'};
const datePickerProps: DatePickerProps = {appearance:'button',readOnly:true};
const dateRangePickerProps: DateRangePickerProps = {placeholder:'Select a range'};
const timePickerProps: TimePickerProps = {name:'meeting-time',value:'09:30',format:'24h',minuteStep:15};
export const dateTimeControls = React.createElement(React.Fragment,null,
  React.createElement(Calendar,calendarProps), React.createElement(DatePicker,datePickerProps),
  React.createElement(DateRangePicker,dateRangePickerProps), React.createElement(TimePicker,timePickerProps));
export const controls = React.createElement(React.Fragment,null,
  React.createElement(Card,{density:'compact'},React.createElement(CardMedia,null,'Media'),React.createElement(CardAction,null,'Action')),
  React.createElement(ContentCard,contentCardProps),
  React.createElement(Select,{name:'choice'},React.createElement(SelectTrigger,null,React.createElement(SelectValue)),
    React.createElement(SelectContent,selectContentProps,React.createElement(SelectItem,{value:'one',description:'Detail',trailing:'Metadata'},'One'))),
  React.createElement(Popover,null,React.createElement(PopoverTrigger,null,'Open'),
    React.createElement(PopoverContent,null,React.createElement(PopoverViewport,popoverViewportProps,'Body'))),
  React.createElement(ScrollArea,scrollAreaProps,'Content'));
export async function prepare(root: string) {
  return prepareAppBuild(defineZeroConfig({ projectRoot: root, db: { mode: 'ephemeral' }, tables: {},
    auth: false, kv: false, appDir: 'missing-route-directory',
    serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false,
    serverRoutesDir: false, serverResourcesDir: false }), { emitCode: (code, options) => emitPlatformCodeTo(observability, code, options) });
}
`;

const VERIFY = `
import { dirname, join } from 'node:path';
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { defineZeroPlugin, prepareAppBuild, resolveConfig } from '@zero/framework/server';
import { configureObservability, emitPlatformCodeTo } from '@zero/framework/observability';
import { renderThemeFoundationCss, getThemeTokenCatalog } from '@zero/framework/design-system';
import { Text, Heading } from '@zero/framework/components/typography';
import { prepare, defaultShell, legacyShell, dateTimeControls } from './consumer';
const root = process.cwd();
const prepared = await prepare(root);
const css = await Bun.file(join(prepared.config.outDir, prepared.frontend.cssPath.slice('/_build/'.length))).text();
const installed = join(root,'node_modules/@zero/framework');
const supplement = await Bun.file(join(installed,'src/frontend/styles/theme-next.css')).text();
const applicationStyles = Bun.resolveSync('@zero/framework/styles.css', root);
const legacyStyles = Bun.resolveSync('@zero/framework/styles-legacy.css', root);
const applicationEntry = await Bun.file(applicationStyles).text();
const stylesApplicationEntry = applicationStyles.endsWith('/src/frontend/styles/application.css');
const stylesLegacyEntry = legacyStyles.endsWith('/src/frontend/styles/globals.css') && await Bun.file(legacyStyles).exists();
const stylesApplicationImports = applicationEntry.includes('@import "./globals.css";') && applicationEntry.includes('@import "./theme-next.css";')
  && await Bun.file(join(dirname(applicationStyles),'globals.css')).exists() && await Bun.file(join(dirname(applicationStyles),'theme-next.css')).exists();
let runtimeSetups = 0;
const observability = configureObservability(false);
const extension = defineZeroPlugin({ name:'theme-no-runtime', setup(){ runtimeSetups++; throw new Error('RUNTIME_MUST_NOT_START'); } });
await prepareAppBuild({ projectRoot: root, db:{mode:'ephemeral'}, tables:{}, auth:false, kv:false,
  appDir:'missing-route-directory', serverExtensions:[extension], serverPluginsDir:false,
  serverMiddlewareDir:false, serverEndpointsDir:false, serverRoutesDir:false, serverResourcesDir:false }, { emitCode:(code,options)=>emitPlatformCodeTo(observability,code,options) });
const databaseFiles = [...new Bun.Glob('**/*.{db,sqlite,sqlite3}').scanSync({cwd:root,onlyFiles:true})].filter(name=>!name.startsWith('node_modules/')).length;
await Bun.write(join(root,'browser-consumer.ts'), "export { AppShell } from '@zero/framework/components/app-shell'; export { Text, Heading } from '@zero/framework/components/typography'; export { createThemeAttributes } from '@zero/framework/design-system'; export { ContentCard, CardMedia, Select, SelectContent, PopoverViewport, ScrollArea, Calendar, DatePicker, DateRangePicker, TimePicker } from '@zero/framework/react';");
const browser = await Bun.build({entrypoints:[join(root,'browser-consumer.ts')],target:'browser',format:'esm'});
if(!browser.success) throw new Error(browser.logs.map(log=>log.message).join('\\n'));
const browserAppShell = (await Promise.all(browser.outputs.map(output=>output.text()))).some(source=>/\\bAppShell\\b/.test(source));
const browserControls = (await Promise.all(browser.outputs.filter(output=>output.path.endsWith('.css')).map(output=>output.text()))).some(source=>
  source.includes('zero-select-highlight') && source.includes('zero-content-card') && source.includes('zero-scroll-decoration'));
const dateTimeHtml = renderToString(dateTimeControls);
const dateTimeSsr = ['data-slot="calendar"','data-slot="date-picker-trigger"','data-slot="date-range-picker-trigger"','name="meeting-time"','value="09:30"'].every(value=>dateTimeHtml.includes(value));
const identities = [
  ['src/components/ui/calendar.tsx','src/components/controls/date-time/calendar.tsx','Calendar'],
  ['src/components/ui/date-picker.tsx','src/components/controls/date-time/date-picker.tsx','DatePicker'],
  ['src/components/ui/date-range-picker.tsx','src/components/controls/date-time/date-range-picker.tsx','DateRangePicker'],
  ['src/components/ui/time-picker.tsx','src/components/controls/date-time/time-picker.tsx','TimePicker'],
  ['src/components/popover/index.ts','src/components/surfaces/popover/index.ts','Popover'],
  ['src/components/overlays/overlay-scope.tsx','src/components/_internal/overlay-scope/overlay-scope.tsx','OverlayScopeProvider'],
];
const organizedIdentity = (await Promise.all(identities.map(async ([oldPath,newPath,name])=>{
  const [oldModule,newModule]=await Promise.all([import(join(installed,oldPath)),import(join(installed,newPath))]);
  return oldModule[name]!==undefined && oldModule[name]===newModule[name];
}))).every(Boolean);
console.log(JSON.stringify({ foundation:prepared.frontend.themeFoundation, cssScoped:css.includes('[data-zero-theme="next"]'),
  managedDefault:prepared.config.themeFoundation, explicitLegacy:resolveConfig({db:{mode:'ephemeral'},tables:{},themeFoundation:'legacy'}).themeFoundation,
  parity:supplement===renderThemeFoundationCss(), roles:getThemeTokenCatalog().length, runtimeSetups, databaseFiles,
  defaultShellHtml:renderToString(defaultShell), legacyShellHtml:renderToString(legacyShell), stylesApplicationEntry, stylesApplicationImports, stylesLegacyEntry, browserAppShell, browserControls, dateTimeSsr, organizedIdentity,
  browserBytes:browser.outputs.reduce((sum,item)=>sum+item.size,0), environmentNotLoaded:process.env.THEME_CONFIG_TRIPWIRE===undefined,
  html:renderToString(React.createElement('section',null,React.createElement(Heading,{as:'h1',variant:'page'},'Theme backing'),React.createElement(Text,{variant:'support'},'Scoped presentation'))) }));
`;
