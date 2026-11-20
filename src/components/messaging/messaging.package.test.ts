/** Fresh installed package proof. No app config, provider, production data or live messaging backend. */
import { spawn, spawnSync } from 'node:child_process';
import { ownedWorkerFixture } from '../../workers/test-support/owned-fixture';
import { afterAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const evidence = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/messaging-polish';

test('messaging installs from an archive, SSR-renders its real hook and browser-builds through public exports', async () => {
  const fixture = await packageFixture('messaging-package'), root = fixture.root;
  const consumer = join(root, 'consumer');
  const archive = process.env.ZERO_MESSAGING_ARCHIVE ?? join(root, 'framework.tgz');
  try {
    await mkdir(consumer);
    await claimPackageDependencies(fixture, consumer);
    if (!process.env.ZERO_MESSAGING_ARCHIVE) { console.info('Messaging package proof: pack source'); await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive, '--quiet'], process.cwd()); }
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({ name: 'zero-messaging-consumer', private: true, type: 'module', dependencies: {
      '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4',
      typescript: '^5.9.3', '@types/bun': '1.3.14', '@types/react': '^19.2.14', '@types/react-dom': '^19.2.3',
    } }));
    await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
      strict: true, skipLibCheck: true, esModuleInterop: true, jsx: 'react-jsx', types: ['bun'], lib: ['ES2022', 'DOM', 'DOM.Iterable'] }, include: ['consumer.tsx'] }));
    await Bun.write(join(consumer, 'consumer.tsx'), CONSUMER);
    await Bun.write(join(consumer, 'verify.ts'), VERIFY);
    await Bun.write(join(consumer, 'zero.config.ts'), "throw new Error('MESSAGING_PACKAGE_MUST_NOT_LOAD_APP_CONFIG');\n");
    console.info('Messaging package proof: install isolated consumer');
    await checked(['install', '--ignore-scripts'], consumer);
    console.info('Messaging package proof: typecheck installed public facade');
    await checked(['run', 'node_modules/typescript/bin/tsc', '--noEmit'], consumer);
    console.info('Messaging package proof: render SSR and build browser consumer');
    const result = JSON.parse((await checked(['verify.ts'], consumer)).trim());
    expect(result.browserBytes).toBeGreaterThan(0); expect(result.browserClean).toBe(true);
    expect(result.css).toBe(true); expect(result.publicAliases).toBe(true); expect(result.hookSsr).toBe(true);
    expect(result.html).toContain('Messaging workspace'); expect(result.html).toContain('Customer conversation');
    expect(result.html).toContain('aria-label="Message"'); expect(result.html).toContain('&lt;fixture text&gt;');
    expect(result.html).toContain('Connecting to messages');
    expect(result.html).not.toContain('href='); expect(result.privatePathsRejected).toBe(6);
    const installed = join(consumer, 'node_modules/@zero/framework');
    for (const file of [
      'src/components/messaging/index.ts', 'src/components/messaging/messaging.css', 'src/components/messaging/use-conversation-typing.ts',
      'src/components/messaging/use-messaging-presence.ts', 'src/components/messaging/messaging-avatar.tsx',
      'src/components/messaging/messaging-private-avatar.tsx', 'src/frontend/client/user-avatar-presentation.ts',
      'src/components/messaging/messaging-workspace.tsx', 'src/components/messaging/messaging-workspace-controller.ts',
      'src/components/messaging/use-messaging-workspace.ts', 'src/components/messaging/workspace-send.ts', 'src/components/messaging/workspace-message-actions.tsx',
      'src/frontend/client/messaging-watch.ts', 'src/messaging/client-contracts.ts', 'src/messaging/live-error.ts',
      'src/messaging/contracts.ts', 'src/messaging/realm-queries.ts', 'src/components/messaging/workspace-transcript.ts',
      'src/components/messaging/use-messaging-transcript.ts',
      'src/components/messaging/support-chat.tsx', 'src/components/messaging/workspace-review.tsx', 'src/components/messaging/use-support-typing.ts',
      'src/components/messaging/workspace-portal-start.tsx', 'src/components/messaging/workspace-support-start.tsx', 'src/components/messaging/use-support-inboxes.ts',
      'src/messaging/support-inbox-config.ts', 'src/messaging/support-inbox-policy.ts',
      'src/messaging/message-assistant-policy.ts',
      'src/messaging/assistant-selection.ts',
      'src/messaging/support-admission.ts', 'src/messaging/support-open-intent.ts',
      'src/messaging/visitor-client.ts', 'src/messaging/visitor-service.ts', 'src/messaging/visitor-session.ts', 'src/messaging/visitor-routes.ts',
      'src/messaging/test-support/managed-deployment/fixture-files.ts', 'src/messaging/test-support/managed-deployment/audit-heartbeat.ts',
      'src/blog/test-fixtures/publishing/audit-heartbeat.ts',
      'src/frontend/client/guardian-presence-presentation.ts', 'src/components/avatar-group/avatar-group.styles.css',
      'src/frontend/client/typing-indicator-hooks.ts', 'src/frontend/client/typing-indicator-model.ts',
      'src/sync/client/ephemeral-client.ts', 'src/sync/client/ephemeral-store.ts', 'src/sync/ephemeral-channel.ts',
      'docs-next/frontend/messaging/index.md', 'docs-next/backend/messaging/index.md', 'docs-next/backend/messaging/portal.md',
    ]) expect(await Bun.file(join(installed, file)).text()).toBe(await Bun.file(join(process.cwd(), file)).text());
    expect([...new Bun.Glob('*.{db,sqlite,sqlite3}').scanSync({ cwd: consumer })]).toEqual([]);
    const { commit, dirty } = packageSourceIdentity();
    await mkdir(evidence, { recursive: true });
    await Bun.write(join(evidence, 'installed-archive-evidence.json'), JSON.stringify({
      commit, dirty, archive, sha256: createHash('sha256').update(new Uint8Array(await Bun.file(archive).arrayBuffer())).digest('hex'),
      version: result.version, verifiedAt: new Date().toISOString(), ...result,
      bun: Bun.version, bunExecutable: process.execPath, fixtureRunId: fixture.runId,
      scope: 'installed public workspace/controller/typing/presence exports, SSR and browser build; no installed backend/Linux or stable-release claim',
      configTripwireNotExecuted: true, liveProviderOperations: false,
    }, null, 2));
  } finally {
    fixture.settleBody();
    // Only this newly allocated disposable consumer is removed. An explicitly supplied release archive is read-only.
    await retirePackageFixture(fixture);
  }
}, 240_000);


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
    const timer = setTimeout(() => { timedOut = true; stop(); }, 180_000);
    const hardTimer = setTimeout(() => rejectRetirement(Error('Owned package child did not settle after phase deadline.')), 180_000 + 5000);
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
      command: [process.execPath, '--no-env-file', ...args], bun: Bun.version, phaseTimeoutMs: 180_000 }));
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
          bun: Bun.version, phaseTimeoutMs: 180_000, elapsedMs: Math.round(performance.now() - started),
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
import * as Frontend from '@zero/framework/react';
import * as Parts from '@zero/framework/messaging';
import * as Alias from '@zero/framework/components/messaging';
import type { UseConversationTypingReturn, MessageBubbleProps, MessageDeliveryIndicatorProps, ConversationAssistantActivityProps,
  MessagingComposerProps, MessagingAttachment, MessagingMessage, MessagingWorkspaceProps, MessagingWorkspaceState } from '@zero/framework/messaging';
import type { MessagingClient, MessagingSupportInbox } from '@zero/framework/messaging/client';
import type { MessagingConfig, MessagingSupportInboxConfig } from '@zero/framework/messaging/server';
const inbox: MessagingSupportInboxConfig = { title: 'Our team', assistant: false };
const portal: MessagingConfig = { portal: true, support: { inboxes: { team: inbox }, defaultInbox: 'team' } };
const names = ['MessagingLayout', 'ConversationList', 'ConversationListHeading', 'ConversationHeader', 'ConversationSeparator',
  'ConversationTypingIndicator', 'ConversationAssistantActivity', 'MessageBubble', 'MessageDeliveryIndicator', 'MessagingComposer',
  'useConversationTyping', 'useMessagingPresence', 'conversationActivityLabel', 'conversationActivityMembers',
  'MessagingWorkspace', 'useMessagingWorkspace', 'MessagingWorkspaceController', 'MessagingLiveError', 'SupportChat', 'useSupportTyping'] as const;
export const publicAliases = names.every(name => Parts[name] === Root[name] && Parts[name] === Frontend[name] && Parts[name] === Alias[name]);
export const message: MessagingMessage = { id: 'fixture-message', author: { id: 'fixture-user', kind: 'user', label: 'Customer' },
  text: '<fixture text>', createdAt: Date.UTC(2026, 9, 24, 12), delivery: 'accepted' };
const props: MessageBubbleProps = { message };
const delivery: MessageDeliveryIndicatorProps = { state: 'accepted' };
const assistant: ConversationAssistantActivityProps = { activity: null };
const workspace: MessagingWorkspaceProps = { avatarShape: 'square', maxMessages: 500, readPolicy: 'visible-end' };
export function nativeFacadeTypes(client: MessagingClient) {
  void client.support.inboxes().then(page => { const destinations: readonly MessagingSupportInbox[] = page.items; });
  void client.support.open({ inboxId: 'team', mode: 'human' }, { requestId: 'package-typecheck-only' });
  void client.support.queue({ inboxId: 'team', owner: 'triage', limit: 25 });
  void client.conversations.people('admitted-conversation');
  void client.messages.get('admitted-conversation', 'accepted-message');
  void client.watchReview('admitted-conversation', page => { const count: number = page.items.length; });
  return client.watchContacts(page => { const name: string | undefined = page.items[0]?.name; }, { query: { limit: 50 } });
}
export let hookSsr = false;
function Input() {
  const typing: UseConversationTypingReturn = Parts.useConversationTyping('room-fixture');
  const presence = Parts.useMessagingPresence();
  hookSsr = !typing.isTyping && !typing.isAnyoneTyping && typing.participants.length === 0 && typing.resetError() === false
    && presence.presenceFor({ ...message.author, avatarShape: 'square' }) === undefined;
  const composer: MessagingComposerProps = { value: '', onChange() {}, onSubmit() {}, onTyping: typing.onTextChange };
  return <Parts.MessagingComposer {...composer} />;
}
export function Consumer() {
  return <Root.AppProvider url="https://fixture.invalid" tables={{}} auth>
    <Parts.MessagingLayout sidebar={<Parts.ConversationList conversations={[]} onSelect={() => {}} />}
      sidebarHeader={<Parts.ConversationListHeading title="Messages" />}
      header={<Parts.ConversationHeader participant={message.author} subtitle="Customer conversation" />}
      composer={<Input />}>
      <Parts.ConversationSeparator>Today</Parts.ConversationSeparator><Parts.MessageBubble {...props} />
      <Parts.MessageDeliveryIndicator {...delivery} /><Parts.ConversationAssistantActivity {...assistant} />
    </Parts.MessagingLayout>
    <Parts.MessagingWorkspace {...workspace} />
    <Parts.SupportChat entry="website" resume={false} />
  </Root.AppProvider>;
}
`;
const VERIFY = `
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import manifest from '@zero/framework/package.json';
import { Consumer, publicAliases, hookSsr } from './consumer';
const html = renderToString(React.createElement(Consumer));
const built = await Bun.build({ entrypoints: ['./consumer.tsx'], target: 'browser', format: 'esm' });
if (!built.success) throw new Error(built.logs.map(log => log.message).join('\\n'));
const scripts = await Promise.all(built.outputs.filter(output => output.path.endsWith('.js')).map(output => output.text()));
const styles = await Promise.all(built.outputs.filter(output => output.path.endsWith('.css')).map(output => output.text()));
const browserClean = !/bun:sqlite|node:fs|nodemailer|imapflow|stripe-node/.test(scripts.join('\\n'));
let privatePathsRejected = 0;
for (const path of ['messaging/use-conversation-typing', 'messaging/messaging.browser-fixture', 'components/messaging/messaging.browser-fixture', 'components/messaging/messaging.package.test',
  'messaging/workspace-send', 'components/messaging/workspace-transcript']) {
  try { Bun.resolveSync('@zero/framework/' + path, process.cwd()); } catch { privatePathsRejected++; }
}
console.log(JSON.stringify({ html, publicAliases, hookSsr, privatePathsRejected, version: manifest.version,
  browserClean, css: styles.join('\\n').includes('zero-messaging-layout'), browserBytes: built.outputs.reduce((n, output) => n + output.size, 0) }));
`;
