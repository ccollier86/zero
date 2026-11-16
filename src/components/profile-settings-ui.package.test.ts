/**
 * Qualifies installed profile/settings SDK, configuration and UI facades.
 * No live app, provider, profile database or Fabric actor is started.
 */
// Bun has no direct directory-creation/temp-directory/removal API.
import { spawn, spawnSync } from 'node:child_process';
import { ownedWorkerFixture } from '../workers/test-support/owned-fixture';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { afterAll, expect, test } from 'bun:test';
import { join } from 'node:path';

test('installed adaptive profile facades browser/server-build, typecheck and render without domain services', async () => {
  const fixture = await packageFixture('profile-settings-package'), root = fixture.root;
  const consumer = `${root}/consumer`, archive = `${root}/framework.tgz`;
  try {
    await mkdir(consumer);
    await claimPackageDependencies(fixture, consumer);
    await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], process.cwd());
    await Bun.write(`${consumer}/package.json`, JSON.stringify({
      name: 'zero-profile-settings-public-consumer', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4',
        typescript: '5.9.3', '@types/bun': '1.3.10', '@types/react': '19.2.14', '@types/react-dom': '19.2.3' },
    }));
    await Bun.write(`${consumer}/consumer.tsx`, CONSUMER);
    await Bun.write(`${consumer}/verify.ts`, VERIFY);
    await Bun.write(`${consumer}/server-consumer.ts`, SERVER_CONSUMER);
    await Bun.write(`${consumer}/public-types.ts`, PUBLIC_TYPES);
    await checked(['install', '--ignore-scripts'], consumer);
    const result = JSON.parse((await checked(['verify.ts'], consumer)).trim()) as {
      browserBytes: number; serverBytes: number; html: string; exports: boolean; recovery: boolean;
      sdk: boolean; schema: boolean; config: boolean; realm: boolean; guides: boolean; notices: boolean; styles: boolean; queryHelpers: boolean; authorizationHelpers: boolean;
    };
    expect(result.browserBytes).toBeGreaterThan(0);
    expect(result.serverBytes).toBeGreaterThan(0);
    expect(result.exports).toBe(true);
    expect(result.recovery).toBe(true);
    expect(result.sdk).toBe(true);
    expect(result.schema).toBe(true);
    expect(result.config).toBe(true);
    expect(result.realm).toBe(true);
    expect(result.guides).toBe(true);
    expect(result.notices).toBe(true);
    expect(result.styles).toBe(true);
    expect(result.queryHelpers).toBe(true);
    expect(result.authorizationHelpers).toBe(true);
    expect(result.html).toContain('Public reviewers');
    expect(result.html).toContain('data-shape="square"');
    expect(result.html).not.toContain('Busy');
    expect(result.html).not.toContain('avatar-presence-indicator');
    expect(result.html).not.toContain('Add user');
    expect(result.html).toContain('Delivery rules');
    expect(result.html).toContain('Mentions: Email');
    expect(result.html).toContain('Team chat');
    expect(result.html).toContain('Connected');
    expect(result.html).toContain('Actions for Team chat');
    expect(result.html).not.toContain('New Connection');
    expect(result.html).toContain('Ownership verified');
    expect(result.html).toContain('Complete your profile');
    expect(result.html).toContain('You have unsaved changes.');
    expect(result.html).toContain('data-slot="form-save-bar"');
    expect(result.html).toContain('data-slot="kbd-group"');
    expect(result.html).toContain('aria-label="Save shortcut"');
    const archiveSha256 = new Bun.CryptoHasher('sha256').update(await Bun.file(archive).arrayBuffer()).digest('hex');
    const manifest = await Bun.file(`${consumer}/node_modules/@zero/framework/package.json`).json() as { version: string };
    console.info(JSON.stringify({ qualification: 'adaptive-profile-installed-working-archive', version: manifest.version,
      archiveSha256, browserBytes: result.browserBytes, serverBytes: result.serverBytes,
      ...packageSourceIdentity(), bun: Bun.version, bunExecutable: process.execPath, fixtureRunId: fixture.runId }));
  } finally { fixture.settleBody(); /* afterAll awaits retirement separately; failure still fails this file and holds its admission slot. */ }
// Packing, installation, two full facade builds and an installed type program
// have separate bounded child budgets; allow their total on slower CI/storage.
}, 180_000);


type PackageFixture = Awaited<ReturnType<typeof ownedWorkerFixture>> & {
  runId: string; identity: { dev: number; ino: number }; marker: string;
  bodySettled: Promise<void>; settleBody(): void;
  dependencies?: { path: string; dev: number; ino: number; marker: string };
  phases: Set<Promise<unknown>>; stops: Set<() => void>; closers: (() => Promise<void>)[];
  uncertain: boolean; retirement?: Promise<void>;
};
const packageFixtures = new Set<PackageFixture>();
let currentPackageFixture: PackageFixture | undefined;
const fixtureScratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
const packagePins = new Set(['.git', '.storage-keep', '.keep', '.pin', 'PINNED']);
async function packageFixture(label: string): Promise<PackageFixture> {
  const requested = process.env.TMPDIR;
  const parent = requested?.startsWith(fixtureScratch + '/') ? requested : fixtureScratch;
  await mkdir(parent, { recursive: true });
  if (await realpath(parent) !== parent) throw Error('Package fixture TMPDIR must be physical and external.');
  // This allocator captures tmpdir() synchronously before its first await. Restore
  // immediately, without yielding or changing another test's ambient environment.
  const previous = process.env.TMPDIR;
  let pending: ReturnType<typeof ownedWorkerFixture>;
  try { process.env.TMPDIR = parent; pending = ownedWorkerFixture(label); }
  finally { if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous; }
  const owned = await pending, identity = await lstat(owned.root);
  const marker = await readFile(join(owned.root, '.storage-synthetic-fixture.json'), 'utf8'), owner = JSON.parse(marker);
  let settleBody!: () => void;
  const bodySettled = new Promise<void>(resolve => { settleBody = resolve; });
  const fixture: PackageFixture = Object.assign(owned, { runId: owner.run_id,
    identity: { dev: identity.dev, ino: identity.ino }, marker, bodySettled, settleBody, phases: new Set<Promise<unknown>>(),
    stops: new Set<() => void>(), closers: [] as (() => Promise<void>)[], uncertain: false });
  packageFixtures.add(fixture); currentPackageFixture = fixture;
  try {
    console.info(JSON.stringify({ qualification: 'owned-package-fixture-admitted', root: fixture.root, runId: fixture.runId,
      bun: Bun.version, bunExecutable: process.execPath, source: packageSourceIdentity(), envFiles: false, packInstallLifecycleScripts: false }));
    return fixture;
  } catch (error) { fixture.settleBody(); throw error; } // The caller never entered its body.
}
async function claimPackageDependencies(fixture: PackageFixture, consumer: string) {
  const path = join(consumer, 'node_modules'); await mkdir(path);
  const identity = await lstat(path), marker = JSON.stringify({ schema: 1, project: 'zero-platform',
    runId: fixture.runId, purpose: 'generated-package-test-dependencies', ownerPid: process.pid });
  fixture.dependencies = { path, dev: identity.dev, ino: identity.ino, marker };
  await writeFile(join(path, '.package-test-dependencies-owner.json'), marker, { flag: 'wx', mode: 0o600 });
}
async function retirePackageFixture(fixture: PackageFixture) {
  return fixture.retirement ??= (async () => {
    try {
      const bounded = async (pending: Promise<unknown>, milliseconds: number, label: string) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([pending, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error(label)), milliseconds); })]); }
        finally { clearTimeout(timer); }
      };
      for (const stop of fixture.stops) stop();
      await bounded(Promise.allSettled([...fixture.phases]), 10_000, 'Owned package phases did not settle during teardown.');
      // afterAll must not delete while a timed-out body/startup/fs await can resume.
      // Each body resolves this fence BEFORE awaiting this same cleanup promise.
      await bounded(fixture.bodySettled, 15_000, 'Owned package body/startup admission remains pending; preserve the fixture.');
      const closed = await Promise.allSettled(fixture.closers.map(async close => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([close(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('Owned package server close exceeded retirement bound.')), 10_000); })]); }
        finally { clearTimeout(timer); }
      }));
      if (fixture.uncertain || closed.some(result => result.status === 'rejected')) throw Error('Owned child/server retirement unconfirmed.');
      const requireRoot = async () => {
        const root = await lstat(fixture.root), markerPath = join(fixture.root, '.storage-synthetic-fixture.json'), marker = await lstat(markerPath);
        if (!root.isDirectory() || root.isSymbolicLink() || root.dev !== fixture.identity.dev || root.ino !== fixture.identity.ino
          || await realpath(fixture.root) !== fixture.root || !marker.isFile() || marker.isSymbolicLink() || marker.nlink !== 1
          || marker.dev !== root.dev || await readFile(markerPath, 'utf8') !== fixture.marker) throw Error('Owned package root identity/marker changed.');
      };
      await requireRoot();
      const handles = spawnSync('lsof', ['-nP', '-t', '+D', fixture.root], { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 });
      if (handles.error || handles.signal || ![0, 1].includes(handles.status!) || handles.stdout.trim() || handles.stderr.trim()) throw Error('Package fixture handles still open or unconfirmed.');
      const dependency = fixture.dependencies;
      if (dependency) {
        const identity = await lstat(dependency.path), markerPath = join(dependency.path, '.package-test-dependencies-owner.json'), marker = await lstat(markerPath);
        if (!identity.isDirectory() || identity.isSymbolicLink() || identity.dev !== dependency.dev || identity.ino !== dependency.ino
          || await realpath(dependency.path) !== dependency.path || !marker.isFile() || marker.isSymbolicLink() || marker.nlink !== 1
          || marker.dev !== dependency.dev || await readFile(markerPath, 'utf8') !== dependency.marker) throw Error('Generated dependency ownership changed.');
      }
      // Protect the enclosing root and every sibling, not only node_modules,
      // before deleting ANY generated content. Never follow dependency/unknown links.
      const inspect = async (directory: string): Promise<void> => {
        for (const name of await readdir(directory)) {
          if (packagePins.has(name)) throw Error('Protected content in owned package fixture: ' + join(directory, name));
          const path = join(directory, name), entry = await lstat(path);
          if (entry.dev !== fixture.identity.dev) throw Error('Foreign package fixture filesystem.');
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) await inspect(path); else if (!entry.isFile()) throw Error('Unknown package fixture resource.');
        }
      };
      await inspect(fixture.root); await requireRoot();
      if (dependency) {
        const last = await lstat(dependency.path);
        if (last.dev !== dependency.dev || last.ino !== dependency.ino || last.isSymbolicLink()) throw Error('Generated dependencies replaced before retirement.');
        await rm(dependency.path, { recursive: true });
      }
      await fixture.cleanup(); packageFixtures.delete(fixture);
      console.info(JSON.stringify({ qualification: 'owned-package-fixture-retired', root: fixture.root, runId: fixture.runId,
        bun: Bun.version, bunExecutable: process.execPath, handlesClosed: true, lifecycleScriptsRequested: false }));
    } catch (error) {
      fixture.uncertain = true;
      console.error(JSON.stringify({ qualification: 'owned-package-fixture-retained', root: fixture.root, runId: fixture.runId, reason: String(error) }));
      throw error;
    }
  })();
}
afterAll(async () => { for (const fixture of [...packageFixtures]) await retirePackageFixture(fixture); }, 120_000);

function packageSourceIdentity() {
  const run = (args: string[]) => {
    const result = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
    if (result.error || result.signal || result.status !== 0) throw Error('Cannot identify qualified package-test source.');
    return result.stdout.trim();
  };
  const dirty = Boolean(run(['status', '--porcelain']));
  return { commit: run(['rev-parse', 'HEAD']), dirty, snapshot: dirty ? 'dirty' : 'clean' };
}

/** Same Bun executable, argv and phase deadline; lifecycle repair is not a compiler substitution. */
async function checked(args: string[], cwd: string, extra: Record<string, string> = {}): Promise<string> {
  const fixture = currentPackageFixture;
  if (!fixture || fixture.retirement) throw Error('No active owned package fixture.');
  const operation = (async () => {
    const started = performance.now(), child = spawn(process.execPath, ['--no-env-file', ...args], {
      cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, TMPDIR: fixture.root, SQLITE_TMPDIR: fixture.root,
        BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache', ...extra },
    });
    let timedOut = false, cancelled = false, overflow = false, stdout = '', stderr = '', stdoutBytes = 0, stderrBytes = 0;
    let boundaryError: string | undefined, outputError: string | undefined;
    const stdoutHash = new Bun.CryptoHasher('sha256'), stderrHash = new Bun.CryptoHasher('sha256');
    const stdoutDecoder = new TextDecoder(), stderrDecoder = new TextDecoder();
    const alive = () => { if (!child.pid) return false; try { process.kill(-child.pid, 0); return true; } catch (error: any) { if (error.code === 'ESRCH') return false; throw error; } };
    const signal = (value: NodeJS.Signals) => { if (child.pid) try { process.kill(-child.pid, value); } catch (error: any) { if (error.code !== 'ESRCH') throw error; } };
    let hardReject: ((reason: Error) => void) | undefined;
    const hardFailure = new Promise<never>((_resolve, reject) => { hardReject = reject; });
    const rejectRetirement = (error: unknown) => {
      fixture.uncertain = true; boundaryError ??= String(error);
      hardReject!(Error('Owned package retirement failed: ' + boundaryError));
    };
    const requireLeaderIdentity = () => {
      if ((child.exitCode !== null || child.signalCode !== null) && alive()) {
        const leader = spawnSync('ps', ['-p', String(child.pid), '-o', 'pid='], { encoding: 'utf8', timeout: 5000 });
        if (leader.error || leader.signal || ![0, 1].includes(leader.status!) || leader.stdout.trim()) throw Error('Exited package child PID identity is unconfirmed.');
      }
    };
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      cancelled = !timedOut && !overflow;
      try {
        // afterAll can arrive after leader exit, before checked() reaches finally.
        requireLeaderIdentity(); if (alive()) signal('SIGTERM');
        escalation ??= setTimeout(() => {
          try { requireLeaderIdentity(); if (alive()) signal('SIGKILL'); }
          catch (error) { rejectRetirement(error); }
        }, 1000);
      } catch (error) { rejectRetirement(error); }
    };
    fixture.stops.add(stop);
    const exited = new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    const drained = new Promise<void>(resolve => child.once('close', () => resolve()));
    const timer = setTimeout(() => { timedOut = true; stop(); }, 90_000);
    const hardTimer = setTimeout(() => rejectRetirement(Error('Owned package child did not settle after phase deadline.')), 90_000 + 5000);
    const failOutput = (error: unknown) => { outputError ??= String(error); rejectRetirement(error); stop(); };
    child.stdout!.on('data', (chunk: Buffer) => {
      try { stdoutBytes += chunk.length; stdoutHash.update(chunk);
        if (stdoutBytes <= 4 * 1024 * 1024) stdout += stdoutDecoder.decode(chunk, { stream: true }); else { overflow = true; stop(); }
      } catch (error) { failOutput(error); }
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      try { stderrBytes += chunk.length; stderrHash.update(chunk);
        stderr = (stderr + stderrDecoder.decode(chunk, { stream: true })).slice(-65536); if (stderrBytes > 8 * 1024 * 1024) { overflow = true; stop(); }
      } catch (error) { failOutput(error); }
    });
    child.stdout!.on('end', () => { try { stdout += stdoutDecoder.decode(); } catch (error) { failOutput(error); } });
    child.stderr!.on('end', () => { try { stderr = (stderr + stderrDecoder.decode()).slice(-65536); } catch (error) { failOutput(error); } });
    child.stdout!.on('error', failOutput); child.stderr!.on('error', failOutput);
    console.info(JSON.stringify({ qualification: 'owned-package-phase-start', runId: fixture.runId,
      command: [process.execPath, '--no-env-file', ...args], bun: Bun.version, phaseTimeoutMs: 90_000 }));
    let code: number | null | undefined;
    try {
      code = await Promise.race([exited, hardFailure]);
    } finally {
      let retirementConfirmed = false;
      try {
        requireLeaderIdentity();
        const leaked = alive(); if (leaked) stop();
        const deadline = performance.now() + 3500;
        while (alive() && performance.now() < deadline) await Bun.sleep(25);
        if (alive()) throw Error('Owned package process group remains.');
        let drainTimer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([drained, new Promise<never>((_resolve, reject) => { drainTimer = setTimeout(() => reject(Error('Owned package output retirement unconfirmed.')), 1500); })]); }
        finally { clearTimeout(drainTimer); }
        retirementConfirmed = true;
        if (leaked && !timedOut && !overflow) throw Error('Package phase retained descendants after leader exit.');
      } catch (error) { fixture.uncertain ||= !retirementConfirmed; child.stdout?.destroy(); child.stderr?.destroy(); throw error; }
      finally {
        clearTimeout(timer); clearTimeout(hardTimer); clearTimeout(escalation); fixture.stops.delete(stop);
        console.info(JSON.stringify({ qualification: 'owned-package-phase', runId: fixture.runId, command: [process.execPath, '--no-env-file', ...args],
          bun: Bun.version, phaseTimeoutMs: 90_000, elapsedMs: Math.round(performance.now() - started),
          exitCode: code, signal: child.signalCode, timedOut, cancelled, overflow, boundaryError, outputError, retirementConfirmed: !fixture.uncertain,
          stdoutBytes, stderrBytes, stdoutSha256: stdoutHash.digest('hex'), stderrSha256: stderrHash.digest('hex'),
          ...(timedOut || cancelled || overflow || code !== 0 ? { stdoutTail: stdout.slice(-4096), stderrTail: stderr.slice(-4096) } : {}) }));
      }
    }
    if (timedOut || cancelled || overflow || boundaryError || outputError || code !== 0) throw Error('Installed package phase failed: ' + args.join(' '));
    return stdout;
  })();
  fixture.phases.add(operation);
  try { return await operation; } finally { fixture.phases.delete(operation); }
}

const CONSUMER = `
import * as React from 'react';
import * as Root from '@zero/framework';
import * as ReactParts from '@zero/framework/react';
import { AvatarGroup, AvatarPresenceIndicator } from '@zero/framework/components/avatar-group';
import { SettingsMatrix } from '@zero/framework/components/settings-matrix';
import { IntegrationSettingsList } from '@zero/framework/components/integration-settings-list';
import { UserProfileSettings, UserProfileIdentitySummary, UserProfileFields, UserRegionalSettings,
  UserProfileSecurity, UserContactSettings, UserContactProofBadge, ContactEmailVerification,
  UserPresenceSettings } from '@zero/framework/components/profile-settings';
import { AvatarEditor, AvatarCropDialog } from '@zero/framework/components/avatar-editor';
import { FormSaveBar, UnsavedChangesDialog, useFormSave } from '@zero/framework/components/form-save';
import { ProfileCompletionForm } from '@zero/framework/components/auth';
import { PhoneInput } from '@zero/framework/components/phone-input';
import { Kbd, KbdGroup } from '@zero/framework/components/kbd';
import { stableValueKey, appendDataFilter, appendDataFilters, normalizePage, normalizePageSize,
  buildDataPageQuery, buildResourceListQuery } from '@zero/framework/react/query-params';
import { AuthorizationScopeBoundaryFence, readAuthorizationScopeBoundaryKey, readAuthorizationScopeIdentityKey,
  isAuthorizationScopeCallbackCurrent, isAuthorizationDataReady, isAuthorizationScopeReady,
  isAuthorizationScopeStable, useAuthorizationScopeBoundary } from '@zero/framework/react/authorization-scope';
const idleTransition = { phase: 'idle', operation: null, revision: 0, recoverable: false, error: null } as const;
const scopeFence = new AuthorizationScopeBoundaryFence();
const firstScope = scopeFence.update('first'), repeatedScope = scopeFence.update('first');
const nextScope = scopeFence.update('next');
export const authorizationHelpers = firstScope === repeatedScope && !scopeFence.isCurrent(firstScope)
  && scopeFence.isCurrent(nextScope) && isAuthorizationScopeStable(idleTransition)
  && isAuthorizationScopeReady(idleTransition, false) && !isAuthorizationScopeReady(idleTransition, true)
  && isAuthorizationDataReady(1, 'unauthenticated', false) && !isAuthorizationDataReady(1, 'error', true)
  && isAuthorizationScopeCallbackCurrent('current', true, 'current')
  && !isAuthorizationScopeCallbackCurrent('current', false, 'current')
  && typeof readAuthorizationScopeBoundaryKey(null) === 'string'
  && typeof readAuthorizationScopeIdentityKey(null) === 'string'
  && useAuthorizationScopeBoundary === Root.useAuthorizationScopeBoundary
  && isAuthorizationScopeCallbackCurrent === ReactParts.isAuthorizationScopeCallbackCurrent;
const queryParameters = new URLSearchParams();
appendDataFilter(queryParameters, 'state', { op: 'eq', value: 'active' });
appendDataFilters(queryParameters, { category: ['one', 'two'] });
export const queryHelpers = stableValueKey({ b: 2, a: 1 }) === '{"a":1,"b":2}'
  && queryParameters.getAll('filter').join('|') === 'state:active|category:in:one,two'
  && normalizePage(2.5) === 2 && normalizePageSize(undefined) === 50
  && buildDataPageQuery('items', {}, null, 1, 20) === '/api/data?table=items&limit=20&offset=0'
  && buildResourceListQuery('items') === '/api/resources/items';
const exportedComponents: Array<readonly [string, unknown]> = [
  ['AvatarGroup', AvatarGroup], ['AvatarPresenceIndicator', AvatarPresenceIndicator],
  ['SettingsMatrix', SettingsMatrix], ['IntegrationSettingsList', IntegrationSettingsList],
  ['UserProfileSettings', UserProfileSettings], ['UserProfileIdentitySummary', UserProfileIdentitySummary],
  ['UserProfileFields', UserProfileFields], ['UserRegionalSettings', UserRegionalSettings],
  ['UserProfileSecurity', UserProfileSecurity], ['UserContactSettings', UserContactSettings],
  ['UserContactProofBadge', UserContactProofBadge], ['ContactEmailVerification', ContactEmailVerification],
  ['UserPresenceSettings', UserPresenceSettings], ['AvatarEditor', AvatarEditor], ['AvatarCropDialog', AvatarCropDialog],
  ['FormSaveBar', FormSaveBar], ['UnsavedChangesDialog', UnsavedChangesDialog], ['useFormSave', useFormSave],
  ['ProfileCompletionForm', ProfileCompletionForm], ['PhoneInput', PhoneInput],
  ['Kbd', Kbd], ['KbdGroup', KbdGroup],
  ['useUserProfile', Root.useUserProfile], ['useUserContacts', Root.useUserContacts],
  ['useUserAvatar', Root.useUserAvatar], ['useGuardianPresence', Root.useGuardianPresence],
  ['useAvatarPresence', Root.useAvatarPresence],
];
export const exportsMatch = exportedComponents.every(([name, component]) => component !== undefined
  && (Root as Record<string, unknown>)[name] === component && (ReactParts as Record<string, unknown>)[name] === component);
export const recovery = typeof Root.AuthClient.prototype.recoverSession === 'function'
  && typeof Object.getOwnPropertyDescriptor(Root.AuthClient.prototype, 'hasRecoverableSession')?.get === 'function';
export function Consumer() {
  const controller = useFormSave({ form: { isDirty: true, isSubmitting: false,
    async submit() { return { kind: 'accepted', values: {} }; }, reset() {} }, beforeUnload: false, guardNavigation: false });
  return <main>
    <AvatarGroup aria-label="Public reviewers" role="group" shape="square" members={[
      { id: 'reviewer', name: 'Public reviewer', presence: { label: 'Busy', tone: 'destructive' } },
    ]} />
    <SettingsMatrix title="Delivery rules" columns={[{ id: 'email', label: 'Email' }]}
      rows={[{ id: 'mentions', label: 'Mentions' }]} value={{ mentions: { email: true } }} />
    <IntegrationSettingsList title="Connections" items={[{
      id: 'chat', title: 'Team chat', status: { label: 'Connected', tone: 'success' },
      actions: [{ id: 'review', label: 'Review setup', onSelect() {} }],
    }]} />
    <UserProfileSettings mode="read-only" contacts={false} avatar={false} presence={false} />
    <AvatarEditor readOnly />
    <UserContactProofBadge state="possession-verified" />
    <KbdGroup aria-label="Save shortcut"><Kbd>⌘</Kbd><Kbd>S</Kbd></KbdGroup>
    <ProfileCompletionForm />
    <FormSaveBar controller={controller} placement="inline" />
    <UnsavedChangesDialog controller={controller} />
    <AvatarCropDialog open={false} image={new Blob([], { type: 'image/png' })}
      capabilities={{ enabled: true, editable: true, state: 'ready', shape: 'circle', size: 'default',
        fallback: 'initials', maxUploadBytes: 1024, maxPixels: 4096, outputSize: 64 }}
      onOpenChange={() => {}} onSave={async () => {}} />
  </main>;
}
`;

const VERIFY = `
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import * as ts from 'typescript';
import { AuthClient } from '@zero/framework';
import { Consumer, exportsMatch, recovery, queryHelpers, authorizationHelpers } from './consumer';
import { config, schema, realm } from './server-consumer';
const build = await Bun.build({ entrypoints: ['./consumer.tsx'], target: 'browser', format: 'esm' });
if (!build.success) throw new Error(build.logs.map(log => log.message).join('\\n'));
const serverBuild = await Bun.build({ entrypoints: ['./server-consumer.ts'], target: 'bun', format: 'esm' });
if (!serverBuild.success) throw new Error(serverBuild.logs.map(log => log.message).join(String.fromCharCode(10)));
const program = ts.createProgram(['./public-types.ts', './consumer.tsx', './server-consumer.ts'], {
  noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
  allowImportingTsExtensions: true, resolveJsonModule: true, types: ['bun'], esModuleInterop: true });
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCurrentDirectory: () => process.cwd(), getCanonicalFileName: x => x, getNewLine: () => String.fromCharCode(10) }));
const auth = new AuthClient('https://isolated-public-consumer.invalid');
const sdk = [
  [auth.profile, ['get', 'update']],
  [auth.contacts, ['get', 'setPhone', 'requestEmailVerification', 'requestEmailChange', 'requestPhoneVerification', 'completePhone', 'cancelChallenge', 'completeEmail']],
  [auth.profileCompletion, ['inspect', 'complete']],
  [auth.avatars, ['get', 'stage', 'upload', 'finalize', 'replace', 'cancel', 'remove', 'deliver', 'directory', 'subscribe']],
].every(([api, methods]) => methods.every(name => typeof api[name] === 'function'));
auth.dispose();
const base = './node_modules/@zero/framework/';
const guides = (await Promise.all([
  'frontend/components/avatar-group.md', 'frontend/components/settings-matrix.md',
  'frontend/components/integration-settings-list.md', 'frontend/components/phone-input.md',
  'frontend/components/kbd.md',
  'frontend/guardian/profile-settings.md', 'frontend/forms/save-and-leave.md',
  'backend/guardian/user-profiles.md', 'backend/guardian/contacts.md', 'backend/guardian/avatars.md',
  'backend/guardian/presence.md', 'backend/guardian/profile-completion.md',
].map(path => Bun.file(base + 'docs-next/' + path).exists()))).every(Boolean);
const notice = await Bun.file(base + 'THIRD_PARTY_NOTICES.md').text();
const notices = ['c-avatar-29.json', 'react-easy-crop', 'sharp', 'react-phone-number-input', 'libphonenumber-js']
  .every(name => notice.includes(name));
const globals = await Bun.file(new URL(import.meta.resolve('@zero/framework/styles.css'))).text();
// The default entry composes the retained base plus the next foundation. Check
// the imported base, not an obsolete assumption that every recipe is inlined.
const foundationStyles = globals.includes('@import "./globals.css"')
  ? await Bun.file(new URL('./globals.css', import.meta.resolve('@zero/framework/styles.css'))).text() : globals;
const styles = (await Promise.all(['form-save', 'profile-settings', 'avatar-editor', 'kbd'].map(async name =>
  foundationStyles.includes('../../components/' + name + '/' + name + '.styles.css')
    && await Bun.file(base + 'src/components/' + name + '/' + name + '.styles.css').exists()))).every(Boolean);
console.log(JSON.stringify({ exports: exportsMatch, recovery, sdk, schema, config, realm, guides, notices, styles, queryHelpers, authorizationHelpers,
  html: renderToString(React.createElement(Consumer)),
  serverBytes: serverBuild.outputs.reduce((sum, item) => sum + item.size, 0),
  browserBytes: build.outputs.reduce((sum, item) => sum + item.size, 0) }));
`;

const SERVER_CONSUMER = `
import { defineAuthConfig, resolveAuthBehaviorConfig } from '@zero/framework/auth';
import { guardianPresenceRealmContribution, composeDatabaseRealm, defineDatabaseRealm } from '@zero/framework/server';
import { defineTable, field, isPhoneNumber } from '@zero/framework/schema';
const declaration = defineAuthConfig({ userProfile: { fields: { firstName: { required: true }, preferredName: true },
  regional: { enabled: true, defaults: { locale: 'en-US', timeZone: 'UTC', timeFormat: '12h', weekStartsOn: 1 } },
  contacts: { enabled: true, email: { verify: true }, phone: { enabled: true, editable: true, verify: true } },
  avatars: { enabled: true, shape: 'rounded', outputSize: 64 }, completion: { enabled: true } },
  presence: { enabled: true, onCallEnabled: true } });
const resolved = resolveAuthBehaviorConfig(declaration);
export const config = resolved.userProfile.fields.firstName.required && resolved.userProfile.contacts.phone.verify
  && resolved.userProfile.avatars.enabled && resolved.userProfile.completion.enabled && resolved.presence.enabled;
const table = defineTable('package_profile_contacts', { phone: field.phone({ defaultCountry: 'US', validation: 'possible' }) }, { pk: 'id', sync: 'full' });
export const schema = isPhoneNumber('+12025550123') && !isPhoneNumber('+') && table.serverTable.phone === 'text';
const base = defineDatabaseRealm({ name: 'installed-profile-schema', version: '1', tables: { contacts: table.serverTable } });
const composed = composeDatabaseRealm({ name: 'installed-presence', version: '1',
  contributions: [guardianPresenceRealmContribution()] });
export const realm = base.tables.contacts.phone === 'text' && typeof composed.queries['guardian.presence.current'] === 'function'
  && composed.migrations.some(item => item.version === 'guardian_presence_001');
`;

/** Installed type qualification uses documented package paths, never private source imports. */
const PUBLIC_TYPES = `
import type { Client, AuthSessionRecoveryResult, AuthProfileCompletionRequiredResult, UserProfileSnapshot,
  UserContactSnapshot, UserAvatarSnapshot, UserAvatarStage, UserProfileCompletion,
  GuardianPresenceClient, UseUserProfileOptions, UseUserContactsOptions, UseUserAvatarOptions } from '@zero/framework';
import type { UserProfileSettingsProps } from '@zero/framework/components/profile-settings';
import type { AvatarCropDialogProps } from '@zero/framework/components/avatar-editor';
import type { UseFormSaveOptions, FormSaveBarProps } from '@zero/framework/components/form-save';
import type { ProfileCompletionFormProps } from '@zero/framework/components/auth';
import type { AuthUserProfileConfig, AuthUserContactConfig, AuthUserAvatarConfig,
  AuthUserProfileCompletionConfig, AuthPresenceConfig, PhoneVerificationAdapter } from '@zero/framework/server';
import type { NativeIdentityScope } from '@zero/framework/native';
import type { KbdProps, KbdGroupProps } from '@zero/framework/components/kbd';
import type { DataFilterExpression, DataPageInfo } from '@zero/framework/react/query-params';
import type { AuthorizationScopeBoundary } from '@zero/framework/react/authorization-scope';
import { Link, type AppShellLinkProps } from '@zero/framework/react';
import type { AppShellProps } from '@zero/framework/components/app-shell';
import { field } from '@zero/framework/schema';
export const shellLink: NonNullable<AppShellProps['linkComponent']> = Link;
export const shellAnchor: AppShellLinkProps = { href: '/account', children: 'Account', target: '_blank', rel: 'noopener', ref: () => {} };
export const nativeScopes: NativeIdentityScope[] = ['openid', 'profile', 'email', 'phone', 'profile:write', 'contacts:write'];
// @ts-expect-error Application RBAC grants are not native identity/own-account scopes.
const forbiddenScope: NativeIdentityScope = 'application.manage';
export const profileConfig: AuthUserProfileConfig = { fields: { firstName: { required: true } }, regional: true };
export const contactConfig: AuthUserContactConfig = { enabled: true, phone: { enabled: true, verify: true } };
export const avatarConfig: AuthUserAvatarConfig = { enabled: true, shape: 'square', size: 'sm' };
export const completionConfig: AuthUserProfileCompletionConfig = { enabled: true, existingUsers: 'none' };
export const presenceConfig: AuthPresenceConfig = { enabled: true, customStatuses: [{ key: 'focus', label: 'Focus', tone: 'primary' }] };
export const optionalPhone = field.phone({ defaultCountry: 'FR', validation: 'valid', defaultValue: null });
export type PublishedContracts = [UserProfileSnapshot, UserContactSnapshot, UserAvatarSnapshot, UserAvatarStage,
  UserProfileCompletion, AuthProfileCompletionRequiredResult, AuthSessionRecoveryResult, GuardianPresenceClient,
  UseUserProfileOptions, UseUserContactsOptions, UseUserAvatarOptions, UserProfileSettingsProps,
  AvatarCropDialogProps, UseFormSaveOptions, FormSaveBarProps, ProfileCompletionFormProps, PhoneVerificationAdapter,
  KbdProps, KbdGroupProps, DataFilterExpression, DataPageInfo, AuthorizationScopeBoundary];
export function ownedApis(client: Client) {
  const ownProfile: Client['userProfile'] = client.userProfile;
  const ownContacts: Client['userContacts'] = client.userContacts;
  const ownAvatar: Client['userAvatar'] = client.userAvatar;
  const completion: Client['userProfileCompletion'] = client.userProfileCompletion;
  const presence: Client['presence'] = client.presence;
  return { ownProfile, ownContacts, ownAvatar, completion, presence };
}
export function observeOwnAvatar(client: Client, listener: (snapshot: UserAvatarSnapshot) => void): () => void {
  return client.userAvatar.subscribe(listener);
}
`;
