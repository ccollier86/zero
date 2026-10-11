/** Fresh installed-archive qualification for the additive action tray; never publishes, starts services or loads app configuration. */
import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const DIAGNOSTICS = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/floating-button-group';
const SOURCE_ROOT = new URL('../../../../', import.meta.url).pathname;
const QUALIFIED_SOURCE = [
  ...[...new Bun.Glob('src/components/controls/floating-button-group/*.{ts,tsx,css}').scanSync({ cwd: SOURCE_ROOT, onlyFiles: true }),
    ...new Bun.Glob('src/design-system/*.ts').scanSync({ cwd: SOURCE_ROOT, onlyFiles: true })]
    .filter(path => !/\.(?:test|spec)\.|\.(?:browser|package|test)-fixture\./u.test(path)).sort(),
  'src/frontend/index.ts', 'src/frontend/exports/controls/primitives.ts',
  'src/frontend/styles/application.css', 'src/frontend/styles/globals.css', 'src/frontend/styles/theme-next.css',
  'src/add/copy.ts', 'src/add/registry.ts', 'src/add/component-compatibility.ts',
  'src/doctor/source-only-upgrade-exports.ts', 'src/doctor/source-only-upgrade-types.ts',
  'src/components/button-group/index.ts', 'src/components/button-group/button-group.tsx',
  'src/components/button-group/button-group-toggle.tsx', 'src/components/button-group/button-group-styles.ts',
  'src/components/tooltip/index.ts', 'src/components/_internal/overlay-scope/overlay-scope.tsx',
  'src/lib/observe-presentation-theme.ts', 'src/components/ui/button.tsx',
];
const PUBLIC_TYPES = ['FloatingButtonGroupProps', 'FloatingButtonGroupAction', 'FloatingButtonGroupSeparator',
  'FloatingButtonGroupItem', 'FloatingButtonGroupVariant', 'FloatingButtonGroupSize', 'FloatingButtonGroupOrientation'];

test('installed action tray preserves public identities, strict types, standalone CSS, scoped roles and original owners', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'floating-button-group-package-'));
  const consumer = join(root, 'consumer'), archive = join(root, 'framework.tgz');
  try {
    await mkdir(consumer, { recursive: true });
    await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], SOURCE_ROOT);
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({ name: 'zero-floating-button-group-consumer', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4',
        '@types/bun': 'latest', '@types/react': '^19.2.14', '@types/react-dom': '^19.2.3', typescript: '^5.7.0' } }));
    await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext',
      moduleResolution: 'Bundler', strict: true, skipLibCheck: true, esModuleInterop: true, jsx: 'react-jsx',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: ['bun'] }, include: ['consumer.tsx'] }));
    await Bun.write(join(consumer, 'consumer.tsx'), CONSUMER);
    await Bun.write(join(consumer, 'verify.ts'), VERIFY);
    await Bun.write(join(consumer, 'browser-consumer.ts'), BROWSER);
    await Bun.write(join(consumer, 'zero.config.ts'), "throw new Error('FLOATING_GROUP_CONFIG_MUST_NOT_EXECUTE');\n");
    await Bun.write(join(consumer, '.env'), 'FLOATING_GROUP_ENV_TRIPWIRE=MUST_NOT_LOAD\n');
    await checked(['install', '--ignore-scripts'], consumer);
    await checked(['run', 'node_modules/typescript/bin/tsc', '--noEmit'], consumer);
    const result = JSON.parse((await checked(['verify.ts'], consumer)).trim());
    expect(result.identity).toBe(true);
    expect(result.strictTypes).toBe(true);
    expect(result.publicTypes).toEqual(PUBLIC_TYPES);
    expect(result.sourceOnlyValues).toEqual(['available', 'available', 'available']);
    expect(result.sourceOnlyTypes).toEqual(PUBLIC_TYPES.map(() => 'available'));
    expect(result.defaultMarkup).toContain('role="toolbar"');
    expect(result.defaultMarkup).toContain('aria-label="Record actions"');
    expect(result.defaultMarkup).toContain('data-variant="muted"');
    expect(result.defaultMarkup).toContain('data-size="md"');
    expect(result.defaultMarkup.match(/type="button"/gu)).toHaveLength(4);
    expect(result.defaultMarkup.match(/tabindex="0"/gu)).toHaveLength(1);
    expect(result.defaultMarkup).toContain('aria-disabled="true"');
    expect(result.defaultMarkup).toContain('aria-pressed="false"');
    expect(result.defaultMarkup).not.toMatch(/NaN|Infinity|transform:translate/gu);
    expect(result.verticalMarkup).toContain('data-variant="floating"');
    expect(result.verticalMarkup).toContain('data-size="sm"');
    expect(result.verticalMarkup).toContain('aria-orientation="vertical"');
    expect(result.verticalMarkup).toContain('dir="rtl"');
    expect(result.verticalMarkup).toContain('>No icon<');
    expect(result.emptyMarkup.match(/tabindex="0"/gu)).toHaveLength(1);
    expect(result.allDisabledMarkup.match(/tabindex="0"/gu)).toHaveLength(1);
    expect(result.commandsInvoked).toBe(0);
    expect(result.joinedGroupIdentity).toBe(true);
    expect(result.joinedMarkup).toContain('data-slot="button-group"');
    expect(result.roles).toBe(462);
    expect(result.newRoles).toBe(57);
    expect(result.newAliases).toBe(57);
    expect(result.themeParity).toBe(true);
    expect(result.originalThemeRetained).toBe(true);
    expect(result.defaultStylesRetainOriginal).toBe(true);
    expect(result.protectedPolicies).toBe(true);
    expect(result.reducedPolicy).toBe(true);
    expect(result.browserCss).toBe(true);
    expect(result.browserBytes).toBeGreaterThan(0);
    expect(result.browserFromInstalledArchive).toBe(true);
    expect(result.databaseFiles).toBe(0);
    expect(result.environmentNotLoaded).toBe(true);

    const installed = join(consumer, 'node_modules/@zero/framework');
    const sourceHashes: Record<string, string> = {};
    for (const path of QUALIFIED_SOURCE) {
      const archiveHash = await sha256(join(installed, path));
      expect(archiveHash, `Installed archive must match the final source snapshot: ${path}`).toBe(await sha256(join(SOURCE_ROOT, path)));
      sourceHashes[path] = archiveHash;
    }
    const packageMetadata = await Bun.file(join(installed, 'package.json')).json();
    expect(packageMetadata.exports['./components/floating-button-group']).toEqual({
      types: './src/components/controls/floating-button-group/index.ts', import: './src/components/controls/floating-button-group/index.ts' });
    expect(packageMetadata.exports['.']).toEqual(packageMetadata.exports['./react']);
    await mkdir(DIAGNOSTICS, { recursive: true });
    await Bun.write(join(DIAGNOSTICS, 'package-consumer-evidence.json'), JSON.stringify({
      version: packageMetadata.version, sha256: await sha256(archive), snapshot: 'dirty',
      scope: 'fresh installed archive; additive FloatingButtonGroup and scoped theme/public/source-copy owners only; no publication or services',
      publicValueIdentity: true, publicTypeIdentity: true, publicTypes: PUBLIC_TYPES,
      strictProductionAndConsumerTypes: true, sourceOnlyNamedExports: true,
      ssrStationaryCommands: true, joinedButtonGroupPreserved: true, originalThemeRetained: true,
      scopedRoles: result.roles, newRoles: result.newRoles, newAliases: result.newAliases,
      protectedPolicies: result.protectedPolicies, reducedPolicy: result.reducedPolicy,
      foundationParity: true, browserCss: true, browserBytes: result.browserBytes,
      configTripwireNotExecuted: true, environmentNotLoaded: result.environmentNotLoaded,
      databaseFiles: result.databaseFiles, qualifiedSourceSha256: sourceHashes, verifiedAt: new Date().toISOString(),
    }, null, 2));
  } finally {
    // Only this exact newly allocated disposable archive/consumer is retired.
    await rm(root, { recursive: true, force: true });
  }
}, 240_000);

/** All child commands suppress .env loading/scripts and inherit no application/service credentials. */
async function checked(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], { cwd, stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH, TMPDIR: SCRATCH, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' } });
  let expired = false;
  const timeout = setTimeout(() => { expired = true; child.kill(); }, 110_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (expired || code !== 0) throw new Error(`FloatingButtonGroup archive qualification failed (${expired ? 'timeout' : code}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally { clearTimeout(timeout); }
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(new Uint8Array(await Bun.file(path).arrayBuffer())).digest('hex');
}

const CONSUMER = `
import * as React from 'react';
import * as Focused from '@zero/framework/components/floating-button-group';
import * as Root from '@zero/framework';
import * as ReactFacade from '@zero/framework/react';
import { ButtonGroup as JoinedFocused } from '@zero/framework/components/button-group';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type PublicTypeIdentity = [
  Assert<Equal<Focused.FloatingButtonGroupProps, Root.FloatingButtonGroupProps>>,
  Assert<Equal<Focused.FloatingButtonGroupProps, ReactFacade.FloatingButtonGroupProps>>,
  Assert<Equal<Focused.FloatingButtonGroupAction, Root.FloatingButtonGroupAction>>,
  Assert<Equal<Focused.FloatingButtonGroupAction, ReactFacade.FloatingButtonGroupAction>>,
  Assert<Equal<Focused.FloatingButtonGroupSeparator, Root.FloatingButtonGroupSeparator>>,
  Assert<Equal<Focused.FloatingButtonGroupSeparator, ReactFacade.FloatingButtonGroupSeparator>>,
  Assert<Equal<Focused.FloatingButtonGroupItem, Root.FloatingButtonGroupItem>>,
  Assert<Equal<Focused.FloatingButtonGroupItem, ReactFacade.FloatingButtonGroupItem>>,
  Assert<Equal<Focused.FloatingButtonGroupVariant, Root.FloatingButtonGroupVariant>>,
  Assert<Equal<Focused.FloatingButtonGroupVariant, ReactFacade.FloatingButtonGroupVariant>>,
  Assert<Equal<Focused.FloatingButtonGroupSize, Root.FloatingButtonGroupSize>>,
  Assert<Equal<Focused.FloatingButtonGroupSize, ReactFacade.FloatingButtonGroupSize>>,
  Assert<Equal<Focused.FloatingButtonGroupOrientation, Root.FloatingButtonGroupOrientation>>,
  Assert<Equal<Focused.FloatingButtonGroupOrientation, ReactFacade.FloatingButtonGroupOrientation>>,
];
export type QualifiedPublicTypeIdentity = PublicTypeIdentity;
export const strictTypes = true;
export const publicTypes = ['FloatingButtonGroupProps', 'FloatingButtonGroupAction', 'FloatingButtonGroupSeparator',
  'FloatingButtonGroupItem', 'FloatingButtonGroupVariant', 'FloatingButtonGroupSize', 'FloatingButtonGroupOrientation'];
export const identity = Focused.FloatingButtonGroup === Root.FloatingButtonGroup && Root.FloatingButtonGroup === ReactFacade.FloatingButtonGroup;
export const joinedGroupIdentity = JoinedFocused === Root.ButtonGroup && Root.ButtonGroup === ReactFacade.ButtonGroup;
let invoked = 0;
const action: Focused.FloatingButtonGroupAction = { id: 'share', label: 'Share', icon: <svg aria-hidden="true" />,
  shortcut: '⌘ S', reserveLabels: ['Share', 'Copied successfully'], ref: React.createRef<HTMLButtonElement>(), onSelect: () => { invoked++; } };
const separator: Focused.FloatingButtonGroupSeparator = { type: 'separator', id: 'cluster' };
const items: readonly Focused.FloatingButtonGroupItem[] = [action, separator,
  { id: 'disabled', label: 'Unavailable', disabled: true }, { id: 'mode', label: 'Present', pressed: false },
  { id: 'plain', label: 'No icon', icon: false }];
const variant: Focused.FloatingButtonGroupVariant = 'floating';
const size: Focused.FloatingButtonGroupSize = 'sm';
const orientation: Focused.FloatingButtonGroupOrientation = 'vertical';
const props: Focused.FloatingButtonGroupProps = { label: 'Record actions', items, onAction: () => { invoked++; },
  ref: React.createRef<HTMLDivElement>(), style: { '--zero-floating-button-group-md-gap': '6px' } as React.CSSProperties,
  onKeyDown: event => { const owner: HTMLDivElement = event.currentTarget; void owner; } };
export const defaultTray = <form><Focused.FloatingButtonGroup {...props} /></form>;
export const verticalTray = <ReactFacade.FloatingButtonGroup {...props} variant={variant} size={size} orientation={orientation} iconOnly tooltipSide="left" dir="rtl" />;
export const emptyTray = <Root.FloatingButtonGroup label="Empty actions" items={[]} />;
export const allDisabledTray = <Root.FloatingButtonGroup label="Unavailable actions" items={[{ id:'disabled',label:'Unavailable',disabled:true }]} />;
export const joinedTray = <Root.ButtonGroup aria-label="Existing joined actions"><Root.Button type="button">One</Root.Button><Root.Button type="button">Two</Root.Button></Root.ButtonGroup>;
export const commandsInvoked = () => invoked;
`;

const BROWSER = `
export { FloatingButtonGroup } from '@zero/framework/components/floating-button-group';
export { FloatingButtonGroup as RootFloatingButtonGroup, ButtonGroup } from '@zero/framework';
export { FloatingButtonGroup as ReactFloatingButtonGroup } from '@zero/framework/react';
export { createThemeTokens, resolveThemeMotion } from '@zero/framework/design-system';
`;

const VERIFY = `
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { createThemeTokens, createThemeDeclarations, getThemeTokenCatalog, renderThemeFoundationCss, resolveThemeMotion } from '@zero/framework/design-system';
import { identity, joinedGroupIdentity, strictTypes, publicTypes, defaultTray, verticalTray, emptyTray, allDisabledTray, joinedTray, commandsInvoked } from './consumer';
const root = process.cwd(), installed = join(root,'node_modules/@zero/framework');
const metadata = await Bun.file(join(installed,'package.json')).json();
const { SourceOnlyUpgradeExports } = await import(join(installed,'src/doctor/source-only-upgrade-exports.ts'));
const inspector = new SourceOnlyUpgradeExports(installed, metadata.exports);
const sourceOnlyValues = [];
for (const specifier of ['@zero/framework/components/floating-button-group','@zero/framework','@zero/framework/react'])
  sourceOnlyValues.push((await inspector.inspect(specifier,'FloatingButtonGroup','value')).status);
const sourceOnlyTypes = [];
for (const name of publicTypes) sourceOnlyTypes.push((await inspector.inspect('@zero/framework/components/floating-button-group',name,'any')).status);
const catalog = getThemeTokenCatalog(), declarations = createThemeDeclarations(), normal = resolveThemeMotion().recipes, reduced = resolveThemeMotion({reducedMotion:true});
const legacyPath = Bun.resolveSync('@zero/framework/styles-legacy.css',root);
const originalThemeRetained = legacyPath.endsWith('/src/frontend/styles/globals.css') && await Bun.file(legacyPath).exists();
const application = await Bun.file(Bun.resolveSync('@zero/framework/styles.css',root)).text();
const defaultStylesRetainOriginal = application.includes('@import "./globals.css";') && application.includes('@import "./theme-next.css";');
const themeParity = await Bun.file(join(installed,'src/frontend/styles/theme-next.css')).text() === renderThemeFoundationCss();
const protectedPolicies = normal.magneticSidebar.stiffness===350 && normal.magneticSidebar.damping===35 && normal.magneticSidebar.mass===1
  && normal.magneticNavigation.stiffness===360 && normal.magneticNavigation.damping===32 && normal.magneticNavigation.mass===.7
  && normal.pickerHighlight.visualDurationMs===280 && normal.pickerHighlight.bounce===.08
  && normal.modal.originEnterMs===975 && normal.modal.fallbackEntrance==='rise' && normal.modal.exit==='mirror'
  && normal.tooltip.entrance==='grow' && normal.tooltip.enterDurationMs===400 && normal.tooltip.arrow===true
  && normal.holdToConfirm.durationMs===1500;
const reducedPolicy = reduced.recipes.floatingButtonGroupMove.animate===false && reduced.recipes.floatingButtonGroupPress.animate===false
  && reduced.recipes.floatingButtonGroupFeedback.firstEntryScale===1 && reduced.recipes.floatingButtonGroupLabel.blurPx===0
  && reduced.tokens['--zero-theme-floating-button-group-label-enter-duration']==='0ms' && reduced.recipes.holdToConfirm.durationMs===1500;
const browser = await Bun.build({entrypoints:[join(root,'browser-consumer.ts')],target:'browser',format:'esm'});
if(!browser.success) throw new Error(browser.logs.map(log=>log.message).join('\\n'));
const browserCss = (await Promise.all(browser.outputs.filter(output=>output.path.endsWith('.css')).map(output=>output.text())))
  .some(css=>css.includes('.zero-floating-button-group') && css.includes('.zero-floating-button-group-highlight')
    && css.includes('.zero-floating-button-group-label') && css.includes('--zero-floating-button-group-md-height'));
const browserFromInstalledArchive = (await realpath(Bun.resolveSync('@zero/framework/components/floating-button-group',root)))
  .startsWith(await realpath(installed)+'/');
const databaseFiles = [...new Bun.Glob('**/*.{db,sqlite,sqlite3}').scanSync({cwd:root,onlyFiles:true})].filter(path=>!path.startsWith('node_modules/')).length;
console.log(JSON.stringify({identity,joinedGroupIdentity,strictTypes,publicTypes,sourceOnlyValues,sourceOnlyTypes,
  defaultMarkup:renderToStaticMarkup(defaultTray),verticalMarkup:renderToStaticMarkup(verticalTray),emptyMarkup:renderToStaticMarkup(emptyTray),
  allDisabledMarkup:renderToStaticMarkup(allDisabledTray),joinedMarkup:renderToStaticMarkup(joinedTray),commandsInvoked:commandsInvoked(),
  roles:catalog.length,newRoles:Object.keys(createThemeTokens()).filter(name=>name.startsWith('--zero-theme-floating-button-group-')).length,
  newAliases:Object.keys(declarations).filter(name=>name.startsWith('--zero-floating-button-group-')).length,
  themeParity,originalThemeRetained,defaultStylesRetainOriginal,protectedPolicies,reducedPolicy,browserCss,browserFromInstalledArchive,
  browserBytes:browser.outputs.reduce((sum,output)=>sum+output.size,0),databaseFiles,environmentNotLoaded:process.env.FLOATING_GROUP_ENV_TRIPWIRE===undefined}));
`;
