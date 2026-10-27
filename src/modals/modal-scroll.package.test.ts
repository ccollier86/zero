/** Fresh installed modal-scroll archive qualification; no publication, application bootstrap, live provider or database. */
import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { originalThemeBeforeBlogStyles } from '../test-support/preserved-blog-theme';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const DIAGNOSTICS = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/scroll-adoption';
const SOURCE_ROOT = new URL('../../', import.meta.url).pathname;
const ORIGINALS = {
  'src/modals/modal-shell.tsx': '08c87f4fadfdd31eb0b1c8f8554acf2aad1071855ec1c1f736d1497fb87251f9',
  'src/modals/modal-shell.css': 'c11d71c03295ace5a48549fbf98a15114099f261e92358cd5ec8af934ee1ad1f',
  'src/components/_internal/scroll-viewport/scroll-viewport.css': '8fb6b6ed8845afd8547a70dc08bc6bed4e6444de77f8d6c08cacadd9e3e992e5',
  'src/frontend/styles/globals.css': '1c1669a61ea3a1cc22f91d3621b95822a814d7af15a050ec90ff33703b511ce5',
} as const;
// Oct 13 intentionally fixes shared table scroll policy and picker trigger
// presentation. Keep those files in archive/source identity qualification, not
// the frozen original modal-shell/skin/legacy-theme rollback set.
// Globals are pinned to main's already-shipped messaging/email/component
// imports. The drawer supplement must leave that approved entry byte-identical.
const QUALIFIED_SOURCE = [...new Set([
  ...Object.keys(ORIGINALS),
  'src/components/_internal/scroll-viewport/use-scroll-viewport.ts',
  'src/components/_internal/scroll-viewport/scroll-viewport-decoration.tsx',
  'src/components/_internal/scroll-viewport/scroll-viewport-metrics.ts',
  'src/components/ui/scroll-area.tsx', 'src/frontend/styles/theme-next.css',
  'src/modals/index.ts', 'src/modals/modal-manager.tsx', 'src/modals/modal-system.types.ts', 'src/modals/modal-events.ts',
  'src/modals/modal-scroll-shell.tsx', 'src/modals/modal-scroll-treatment.css', 'src/modals/modal-controlled.tsx',
  'src/modals/modal-motion.ts', 'src/modals/modal-scene-motion.ts', 'src/modals/modal-exit-snapshot.tsx',
  'src/components/_internal/scroll-viewport/scroll-viewport-decoration-next.tsx',
  'src/components/_internal/scroll-viewport/scroll-viewport-interactions.ts',
  'src/components/_internal/scroll-viewport/scroll-viewport-next.css',
  'src/components/_internal/overlay-scope/overlay-scope.tsx', 'src/lib/observe-presentation-theme.ts',
  'src/frontend/index.ts', 'src/frontend/exports/runtime/modals.ts', 'src/frontend/exports/runtime/modal-types.ts',
  'src/frontend/styles/application.css', 'src/frontend/styles/modal-tokens.css',
  'src/frontend/styles/calendar-motion-tokens.css', 'src/frontend/styles/data-table-motion-tokens.css', 'src/frontend/styles/tooltip-tokens.css',
  'src/add/copy.ts', 'src/add/registry.ts', 'src/add/component-compatibility.ts', 'src/add/run.ts', 'src/cli/run.ts',
  'src/doctor/source-only-upgrade-exports.ts', 'src/doctor/source-only-upgrade-types.ts',
])].sort();
const PUBLIC_TYPES = ['ModalDescriptor', 'ModalDescriptorBase', 'ControlledModalProps', 'ModalManagerProps'];

test('fresh installed modal scroll archive qualifies public types, original SSR parity, both skins and copy closure', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const allocation = await mkdtemp(join(SCRATCH, 'modal-scroll-package-'));
  const consumer = join(allocation, 'consumer'), archive = join(allocation, 'framework.tgz');
  try {
    await mkdir(consumer, { recursive: true });
    await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], SOURCE_ROOT);
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({ name: 'zero-modal-scroll-consumer', private: true, type: 'module',
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
    const config = "import {writeFileSync} from 'node:fs'; writeFileSync(new URL('./CONFIG_BOOT_MUST_NOT_RUN',import.meta.url),'executed'); throw new Error('MODAL_SCROLL_CONFIG_MUST_NOT_EXECUTE');\n";
    await Bun.write(join(consumer, 'zero.config.ts'), config);
    await Bun.write(join(consumer, '.env'), 'ZERO_SCROLL_ARCHIVE_ENV_TRIPWIRE=MUST_NOT_LOAD\n');
    await Bun.write(join(consumer, '.env.local'), 'ZERO_SCROLL_ARCHIVE_LOCAL_ENV_TRIPWIRE=MUST_NOT_LOAD\n');
    await checked(['install', '--ignore-scripts'], consumer);

    const firstCopy = await checked(['node_modules/@zero/framework/src/cli/run.ts', 'add', 'modals', '--target', consumer], consumer);
    expect(firstCopy).toContain('Zero add complete');
    for (const path of ['modals/modal-scroll-shell.tsx', 'modals/modal-scroll-treatment.css', 'modals/modal-shell.tsx', 'modals/modal-shell.css',
      'components/_internal/scroll-viewport/scroll-viewport-decoration-next.tsx', 'components/_internal/scroll-viewport/scroll-viewport-next.css',
      'components/_internal/scroll-viewport/scroll-viewport-interactions.ts', 'components/_internal/scroll-viewport/use-scroll-viewport.ts',
      'components/_internal/scroll-viewport/scroll-viewport-metrics.ts', 'components/_internal/scroll-viewport/scroll-viewport.css']) {
      expect(await Bun.file(join(consumer, path)).exists(), path).toBe(true);
    }
    const custom = '\n/* CONSUMER ORIGINAL SHELL CUSTOMIZATION MUST SURVIVE */\n';
    for (const path of ['modals/modal-shell.tsx', 'modals/modal-shell.css']) {
      const file = join(consumer, path); await Bun.write(file, await Bun.file(file).text() + custom);
    }
    const repeatCopy = await checked(['node_modules/@zero/framework/src/cli/run.ts', 'add', 'modals', '--target', consumer], consumer);
    expect(repeatCopy).toMatch(/Written:\s+0 file\(s\)/u);
    for (const path of ['modals/modal-shell.tsx', 'modals/modal-shell.css']) expect(await Bun.file(join(consumer, path)).text()).toEndWith(custom);
    await Bun.write(join(consumer, 'copied-consumer.tsx'), COPIED_CONSUMER);
    await checked(['build', 'copied-consumer.tsx', '--target', 'browser', '--outdir', 'copied-build'], consumer);
    const copiedCss = await Bun.file(join(consumer, 'copied-build/copied-consumer.css')).text();
    for (const selector of ['.zero-modal__body', '.zero-scroll-decoration', 'data-zero-scroll-treatment', 'data-zero-scroll-decoration']) {
      expect(copiedCss, selector).toContain(selector);
    }
    await checked(['run', 'node_modules/typescript/bin/tsc', '--noEmit'], consumer);
    const result = JSON.parse((await checked(['verify.tsx'], consumer)).trim());
    expect(result.identity).toBe(true);
    expect(result.strictTypes).toBe(true);
    expect(result.publicTypes).toEqual(PUBLIC_TYPES);
    expect(result.sourceOnlyValues).toEqual(['available', 'available', 'available']);
    expect(result.sourceOnlyTypes).toEqual(PUBLIC_TYPES.map(() => 'available'));
    expect(result.privateAdaptersExported).toBe(false);
    expect(result.ssrParity).toBe(true);
    expect(result.ssrComparisons).toBe(6);
    expect(result.ssrBody).toContain('data-slot="modal-body"');
    expect(result.ssrBody).toContain('data-slot="dialog-header"');
    expect(result.ssrBody).toContain('data-slot="modal-footer"');
    expect(result.ssrBody).toContain('aria-label="Close"');
    expect(result.ssrBody).not.toContain('zero-scroll-decoration');
    expect(result.ssrBody).not.toContain('data-radix-scroll-area-viewport');
    expect(result.ssrBody).not.toContain('data-zero-scroll-treatment');
    expect(result.ssrNav.match(/role="tabpanel"/gu)).toHaveLength(2);
    expect(result.ssrNav.match(/role="tablist"/gu)).toHaveLength(1);
    expect(result.ssrNav).toContain('First retained panel');
    expect(result.ssrNav).not.toContain('Deferred retained panel');
    expect(result.closedControlledMarkup).toContain('Stationary application content');
    expect(result.commandsInvoked).toBe(0);
    expect(result.originalThemeRetained).toBe(true);
    expect(result.defaultStylesRetainOriginal).toBe(true);
    expect(result.browserCss).toBe(true);
    expect(result.browserBytes).toBeGreaterThan(0);
    expect(result.browserFromInstalledArchive).toBe(true);
    expect(result.copiedTestFiles).toEqual([]);
    expect(result.databaseFiles).toBe(0);
    expect(result.environmentNotLoaded).toBe(true);
    expect(result.applicationConfigNotExecuted).toBe(true);
    expect(result.installScriptsNotExecuted).toBe(true);
    expect(await Bun.file(join(consumer, 'zero.config.ts')).text()).toBe(config);

    const installed = join(consumer, 'node_modules/@zero/framework');
    const sourceHashes: Record<string, string> = {};
    for (const path of QUALIFIED_SOURCE) {
      const installedHash = await sha256(join(installed, path));
      expect(installedHash, `Fresh installed archive/source identity: ${path}`).toBe(await sha256(join(SOURCE_ROOT, path)));
      sourceHashes[path] = installedHash;
    }
    for (const [path, hash] of Object.entries(ORIGINALS)) {
      const original = path === 'src/frontend/styles/globals.css'
        ? createHash('sha256').update(originalThemeBeforeBlogStyles(await Bun.file(join(installed, path)).text())).digest('hex') : sourceHashes[path];
      expect(original, `Original theme bytes remain preserved after the exact approved style imports: ${path}`).toBe(hash);
    }
    const metadata = await Bun.file(join(installed, 'package.json')).json();
    expect(metadata.exports['./modals']).toEqual({ types: './src/modals/index.ts', import: './src/modals/index.ts' });
    expect(metadata.exports['.']).toEqual(metadata.exports['./react']);
    await mkdir(DIAGNOSTICS, { recursive: true });
    await Bun.write(join(DIAGNOSTICS, 'package-consumer-evidence.json'), JSON.stringify({
      version: metadata.version, sha256: await sha256(archive), snapshot: 'dirty', published: false,
      scope: 'fresh installed archive; bounded additive modal scroll wrapper/interactions and retained original owners only; no application/provider/database services',
      publicFacadeIdentity: true, publicTypeIdentity: true, publicTypes: PUBLIC_TYPES,
      strictProductionAndConsumerTypes: true, sourceOnlyNamedExports: true, privateAdaptersRemainPrivate: true,
      ssrOriginalParity: true, ssrComparisons: result.ssrComparisons, commandsInvoked: result.commandsInvoked,
      originalFilesByteIdentical: Object.keys(ORIGINALS).length - 1, approvedAdditiveStyleImports: 3, originalThemeRetained: true,
      browserFromInstalledArchive: true, browserCss: true, browserBytes: result.browserBytes,
      copiedCliBuild: true, copiedCustomOriginalsRetained: true, copiedTestFiles: result.copiedTestFiles,
      configTripwireNotExecuted: true, installScriptsNotExecuted: true, environmentNotLoaded: true, databaseFiles: 0,
      qualifiedSourceSha256: sourceHashes, preservedOriginalSha256: ORIGINALS, verifiedAt: new Date().toISOString(),
    }, null, 2));
  } finally {
    // Retire only this exact new synthetic archive/consumer allocation, never user/framework originals.
    await rm(allocation, { recursive: true, force: true });
  }
}, 240_000);

/** Minimal child environment, explicit .env suppression and bounded commands; application credentials are never inherited. */
async function checked(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], { cwd, stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH, TMPDIR: SCRATCH, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' } });
  let expired = false;
  const timeout = setTimeout(() => { expired = true; child.kill(); }, 110_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (expired || code !== 0) throw new Error(`Modal scroll archive qualification failed (${expired ? 'timeout' : code}):\n${stdout}\n${stderr}`);
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
import * as Modals from '@zero/framework/modals';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type PublicTypeIdentity = [
  Assert<Equal<Modals.ModalDescriptor, Root.ModalDescriptor>>,
  Assert<Equal<Modals.ModalDescriptor, ReactFacade.ModalDescriptor>>,
  Assert<Equal<Modals.ModalDescriptorBase, Root.ModalDescriptorBase>>,
  Assert<Equal<Modals.ModalDescriptorBase, ReactFacade.ModalDescriptorBase>>,
  Assert<Equal<Modals.ControlledModalProps, Root.ControlledModalProps>>,
  Assert<Equal<Modals.ControlledModalProps, ReactFacade.ControlledModalProps>>,
  Assert<Equal<Modals.ModalManagerProps, Root.ModalManagerProps>>,
  Assert<Equal<Modals.ModalManagerProps, ReactFacade.ModalManagerProps>>,
  Assert<Equal<Modals.ModalDescriptorBase['scrollTreatment'], 'arc' | 'native' | undefined>>,
];
export const strictTypes = true;
export const publicTypes = ['ModalDescriptor', 'ModalDescriptorBase', 'ControlledModalProps', 'ModalManagerProps'];
export const identity = Modals.ModalManager === Root.ModalManager && Root.ModalManager === ReactFacade.ModalManager
  && Modals.ControlledModal === Root.ControlledModal && Root.ControlledModal === ReactFacade.ControlledModal
  && Modals.modals === Root.modals && Root.modals === ReactFacade.modals;
export const privateAdaptersExported = ['ModalScrollShell', 'ScrollViewportDecorationNext']
  .some(name => name in Modals || name in Root || name in ReactFacade);
let invoked = 0;
export const arc: Modals.ModalDescriptor = { title: 'Bounded installed content', description: 'Fixed description',
  scrollTreatment: 'arc', scrollbar: 'hidden', body: <form id="owned-form"><input aria-label="Name" defaultValue="Synthetic"/></form>,
  footer: { start: 'Fixed note' }, actions: [{ id: 'save', label: 'Save', variant: 'primary', submit: true,
    formId: 'owned-form', onClick: () => { invoked++; return 'accepted'; } }] };
export const native: Root.ModalDescriptor = { ...arc, scrollTreatment: 'native', scrollbar: 'thin' };
export const sections: ReactFacade.ModalDescriptor = { title: 'Installed retained sections', layout: 'nav', navScrollbar: 'thin',
  sections: [{ id: 'one', label: 'First', group: 'Account', body: <p>First retained panel</p> },
    { id: 'two', label: 'Second', group: 'Workspace', body: <p>Deferred retained panel</p> }] };
export const invalid: Modals.ModalDescriptorBase = { title: 'Rejected at type boundary',
  // @ts-expect-error The new option admits only the two supported treatments.
  scrollTreatment: 'unapproved' };
const controlled: Modals.ControlledModalProps = { open: false, descriptor: arc, onOpenChange: () => { invoked++; } };
export const closedControlled = <Modals.ModalManager recedeSurface={false}><p>Stationary application content</p>
  <Modals.ControlledModal {...controlled}/><Root.ControlledModal open={false} descriptor={native} onOpenChange={() => { invoked++; }}/>
</Modals.ModalManager>;
export const commandsInvoked = () => invoked;
`;

const COPIED_CONSUMER = `
import * as React from 'react';
import { ModalManager, ControlledModal } from './modals';
import type { ModalDescriptor } from './modals';
import './modals/modal-shell.css';
export const arc: ModalDescriptor = { title: 'Copied Arc content', scrollTreatment: 'arc', body: 'Synthetic' };
export const native: ModalDescriptor = { title: 'Copied original content', scrollTreatment: 'native', body: 'Synthetic' };
export const examples = <><ControlledModal open={false} descriptor={arc} onOpenChange={() => undefined}/>
  <ControlledModal open={false} descriptor={native} onOpenChange={() => undefined}/></>;
export { ModalManager };
`;

const BROWSER = `
import '@zero/framework/styles.css';
export { ModalManager, ControlledModal, modals } from '@zero/framework/modals';
export { ModalManager as RootModalManager } from '@zero/framework';
export { ModalManager as ReactModalManager } from '@zero/framework/react';
`;

const VERIFY = `
import * as React from 'react';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dialog } from 'radix-ui';
import { resolveModalMotion } from '@zero/framework/modals';
import { ModalShell } from './node_modules/@zero/framework/src/modals/modal-shell';
import { ModalScrollShell } from './node_modules/@zero/framework/src/modals/modal-scroll-shell';
import { identity, strictTypes, publicTypes, privateAdaptersExported, arc, native, sections, closedControlled, commandsInvoked } from './consumer';
const root = process.cwd(), installed = join(root, 'node_modules/@zero/framework');
const metadata = await Bun.file(join(installed, 'package.json')).json();
const { SourceOnlyUpgradeExports } = await import(join(installed, 'src/doctor/source-only-upgrade-exports.ts'));
const inspector = new SourceOnlyUpgradeExports(installed, metadata.exports);
const sourceOnlyValues = [];
for (const specifier of ['@zero/framework/modals', '@zero/framework', '@zero/framework/react'])
  sourceOnlyValues.push((await inspector.inspect(specifier, 'ModalManager', 'value')).status);
const sourceOnlyTypes = [];
for (const name of publicTypes) sourceOnlyTypes.push((await inspector.inspect('@zero/framework/modals', name, 'any')).status);
const context = { id: 'installed-ssr', signal: new AbortController().signal, accept: () => false, requestClose: async () => false,
  setError() {}, setBusy() {}, setDirty() {}, setActionDisabled() {}, show() { throw new Error('SSR cannot admit a dialog'); } };
const state = { busy: false, dirty: false, error: null, actionId: null, disabledActions: {} };
const motion = resolveModalMotion(null, {}, true);
const render = (descriptor, original = false) => {
  const Shell = original ? ModalShell : ModalScrollShell;
  return renderToStaticMarkup(<Dialog.Root open><Shell descriptor={descriptor} context={context} state={state} motion={motion} innerRef={null}/></Dialog.Root>);
};
const normalize = value => value.replace(/_R_[^" ]*_/gu, 'SSR-ID');
let ssrComparisons = 0, ssrParity = true;
for (const shape of [arc, { ...sections, layout: 'tabs' }, sections]) for (const scrollTreatment of ['arc', 'native']) {
  const descriptor = { ...shape, scrollTreatment };
  ssrParity = ssrParity && normalize(render(descriptor)) === normalize(render(descriptor, true)); ssrComparisons++;
}
const closedControlledMarkup = renderToStaticMarkup(closedControlled);
const browser = await Bun.build({ entrypoints: [join(root, 'browser-consumer.ts')], target: 'browser', format: 'esm' });
if (!browser.success) throw new Error(browser.logs.map(log => log.message).join('\\n'));
const css = (await Promise.all(browser.outputs.filter(output => output.path.endsWith('.css')).map(output => output.text()))).join('\\n');
const browserCss = ['.zero-modal__body', '.zero-scroll-viewport', '.zero-scroll-decoration', 'data-zero-scroll-treatment', 'data-zero-scroll-decoration']
  .every(selector => css.includes(selector));
const browserFromInstalledArchive = (await realpath(Bun.resolveSync('@zero/framework/modals', root))).startsWith(await realpath(installed) + '/');
const legacy = Bun.resolveSync('@zero/framework/styles-legacy.css', root);
const originalThemeRetained = legacy.endsWith('/src/frontend/styles/globals.css') && await Bun.file(legacy).exists()
  && await Bun.file(join(installed, 'src/frontend/styles/modal-tokens.css')).exists()
  && await Bun.file(join(installed, 'src/frontend/styles/calendar-motion-tokens.css')).exists()
  && await Bun.file(join(installed, 'src/frontend/styles/data-table-motion-tokens.css')).exists()
  && await Bun.file(join(installed, 'src/frontend/styles/tooltip-tokens.css')).exists();
const application = await Bun.file(Bun.resolveSync('@zero/framework/styles.css', root)).text();
const defaultStylesRetainOriginal = application.includes('@import "./globals.css";') && application.includes('@import "./theme-next.css";');
const copiedPaths = [...new Bun.Glob('**/*.{ts,tsx,css}').scanSync({ cwd: root, onlyFiles: true })]
  .filter(path => /^(components|modals|hooks|lib)\\//u.test(path));
const copiedTestFiles = copiedPaths.filter(path => /\\.(?:test|spec)\\.|\\.(?:browser|test|package)-fixture\\./u.test(path));
const databaseFiles = [...new Bun.Glob('**/*.{db,sqlite,sqlite3}').scanSync({ cwd: root, onlyFiles: true })]
  .filter(path => !path.startsWith('node_modules/')).length;
console.log(JSON.stringify({ identity, strictTypes, publicTypes, sourceOnlyValues, sourceOnlyTypes, privateAdaptersExported,
  ssrParity, ssrComparisons, ssrBody: render(arc), ssrNav: render(sections), closedControlledMarkup, commandsInvoked: commandsInvoked(),
  originalThemeRetained, defaultStylesRetainOriginal, browserCss, browserFromInstalledArchive,
  browserBytes: browser.outputs.reduce((sum, output) => sum + output.size, 0), copiedTestFiles, databaseFiles,
  environmentNotLoaded: process.env.ZERO_SCROLL_ARCHIVE_ENV_TRIPWIRE === undefined && process.env.ZERO_SCROLL_ARCHIVE_LOCAL_ENV_TRIPWIRE === undefined,
  applicationConfigNotExecuted: !(await Bun.file(join(root, 'CONFIG_BOOT_MUST_NOT_RUN')).exists()),
  installScriptsNotExecuted: !(await Bun.file(join(root, 'POSTINSTALL_MUST_NOT_RUN')).exists()) }));
`;
