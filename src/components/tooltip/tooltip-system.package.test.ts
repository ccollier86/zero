/** Fresh installed/archive and source-copy tooltip qualification; no app config, live data or publication. */
import { spawn, spawnSync } from 'node:child_process';
import { ownedWorkerFixture } from '../../workers/test-support/owned-fixture';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, expect, test } from 'bun:test';

const ARTIFACTS = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/tooltip-system';
test('packed tooltip provider/group contracts browser-build, SSR and copy through the actual public CLI', async () => {
  const fixture = await packageFixture('tooltip-package'), root = fixture.root;
  const consumer = join(root, 'consumer'), archive = join(root, 'framework.tgz');
  try {
    await mkdir(consumer);
    await claimPackageDependencies(fixture, consumer);
    await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], process.cwd());
    const sha256 = createHash('sha256').update(new Uint8Array(await Bun.file(archive).arrayBuffer())).digest('hex');
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({ name: 'zero-tooltip-public-consumer', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4',
        '@types/bun': 'latest', '@types/react': '^19.2.14', '@types/react-dom': '^19.2.3', typescript: '^5.7.0' } }));
    await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext',
      moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, esModuleInterop: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: ['bun'], paths: { '@/*': ['./*'] } }, include: ['consumer.tsx', 'copied-consumer.tsx'] }));
    await Bun.write(join(consumer, 'consumer.tsx'), CONSUMER);
    await Bun.write(join(consumer, 'verify.ts'), VERIFY);
    await Bun.write(join(consumer, 'zero.config.ts'), "throw new Error('SYNTHETIC_CONFIG_MUST_NOT_EXECUTE');\n");
    await checked(['install', '--ignore-scripts'], consumer);
    const result = JSON.parse((await checked(['verify.ts'], consumer)).trim()) as { exports: number; bytes: number; html: string; version: string; grow: number };
    expect(result.exports).toBe(6); expect(result.bytes).toBeGreaterThan(0); expect(result.grow).toBe(400);
    expect(result.html).toContain('Package tooltip'); expect(result.html).toContain('Package grouped tooltip');
    expect(result.html).not.toContain('window is not defined');
    expect(await Bun.file(join(consumer, 'node_modules/@zero/framework/src/frontend/styles/tooltip-tokens.css')).exists()).toBe(true);
    expect(await Bun.file(join(consumer, 'node_modules/@zero/framework/docs-next/frontend/components/overlays/tooltip.md')).exists()).toBe(true);
    await checked(['run', 'node_modules/@zero/framework/src/cli/run.ts', 'add', 'components/tooltip', '--target', consumer], consumer);
    await Bun.write(join(consumer, 'copied-consumer.tsx'), COPIED_CONSUMER);
    const copied = await checked(['build', 'copied-consumer.tsx', '--target', 'browser', '--outdir', 'copied-dist'], consumer);
    expect(copied).not.toContain('error:');
    await checked(['run', 'node_modules/typescript/bin/tsc', '--noEmit'], consumer);
    await mkdir(ARTIFACTS, { recursive: true });
    await Bun.write(join(ARTIFACTS, 'package-consumer-evidence.json'), JSON.stringify({ version: result.version,
      ...packageSourceIdentity(), bun: Bun.version, bunExecutable: process.execPath, fixtureRunId: fixture.runId, sha256,
      scope: 'fresh installed archive and source copy; not published', publicExports: result.exports,
      browserBytes: result.bytes, copiedBrowserBuild: true, consumerTypecheck: true, configTripwireNotExecuted: true,
      verifiedAt: new Date().toISOString() }, null, 2));
  } finally {
    fixture.settleBody();
    // Only this exact newly allocated synthetic consumer/archive tree is disposable.
    await retirePackageFixture(fixture);
  }
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
    const timer = setTimeout(() => { timedOut = true; stop(); }, 110_000);
    const hardTimer = setTimeout(() => rejectRetirement(Error('Owned package child did not settle after phase deadline.')), 110_000 + 5000);
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
      command: [process.execPath, '--no-env-file', ...args], bun: Bun.version, phaseTimeoutMs: 110_000 }));
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
          bun: Bun.version, phaseTimeoutMs: 110_000, elapsedMs: Math.round(performance.now() - started),
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
import * as Parts from '@zero/framework/components/tooltip';
import type { TooltipProps, TooltipContentProps, TooltipProviderProps, TooltipGroupProps, TooltipMotionOptions } from '@zero/framework/components/tooltip';
const names = ['TooltipProvider', 'TooltipGroup', 'Tooltip', 'TooltipTrigger', 'TooltipContent', 'resolveTooltipMotion'] as const;
for (const name of names) if (typeof Parts[name] !== 'function') throw new Error('Missing tooltip export: ' + name);
for (const name of ['TOOLTIP_MOTION_DEFAULTS', 'TOOLTIP_MOTION_TIMINGS', 'TOOLTIP_MOTION_EASING', 'TOOLTIP_MOTION_GEOMETRY'] as const)
  if (!Parts[name]) throw new Error('Missing tooltip token export: ' + name);
export const exportCount = names.length;
export const settings: TooltipMotionOptions = { motion: 'grow', durationMultiplier: 1, arrow: true, variant: 'neutral' };
export const provider: TooltipProviderProps = { ...settings, children: null, delayDuration: 450, skipDelayDuration: 450, closeDelay: 70 };
export const group: TooltipGroupProps = { ...settings, children: null };
export const tooltip: TooltipProps = { ...settings, followCursor: 'x', overflowOnly: true };
export const content: TooltipContentProps = { title: <span>Rich title</span>, description: 'Synthetic description', shortcut: ['⌘', 'K'], side: 'right', arrow: false };
export function Consumer() {
  return <Parts.TooltipProvider {...provider}><Parts.Tooltip><Parts.TooltipTrigger asChild><button>Package tooltip</button></Parts.TooltipTrigger>
    <Parts.TooltipContent>Package hint</Parts.TooltipContent></Parts.Tooltip>
    <Parts.TooltipGroup><Parts.Tooltip><Parts.TooltipTrigger asChild><button>Package grouped tooltip</button></Parts.TooltipTrigger>
      <Parts.TooltipContent title="Package rich title" shortcut="G" /></Parts.Tooltip></Parts.TooltipGroup></Parts.TooltipProvider>;
}
`;
const VERIFY = `
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { resolveTooltipMotion } from '@zero/framework/components/tooltip';
import { Consumer, exportCount } from './consumer';
import manifest from '@zero/framework/package.json';
const build = await Bun.build({ entrypoints: ['./consumer.tsx'], target: 'browser', format: 'esm' });
if (!build.success) throw new Error(build.logs.map(log => log.message).join('\\n'));
console.log(JSON.stringify({ exports: exportCount, bytes: build.outputs.reduce((sum, output) => sum + output.size, 0),
  html: renderToString(React.createElement(Consumer)), version: manifest.version, grow: resolveTooltipMotion(null).timings.growEnter }));
`;
const COPIED_CONSUMER = `
import * as React from 'react';
import { TooltipProvider, TooltipGroup, Tooltip, TooltipTrigger, TooltipContent, resolveTooltipMotion } from './components/tooltip';
export { resolveTooltipMotion };
export function CopiedHints() { return <TooltipGroup><Tooltip motion="spring" arrow={false}><TooltipTrigger asChild><button>Copied hint</button></TooltipTrigger>
  <TooltipContent title="Copied title" shortcut={["⌘", "K"]} /></Tooltip></TooltipGroup>; }
export const CopiedProvider = TooltipProvider;
`;
