/** Installed-archive proof: apps use public APIs without installing their own mail engines. */
import { spawn, spawnSync } from 'node:child_process';
import { ownedWorkerFixture } from '../workers/test-support/owned-fixture';
import { afterAll, expect, test } from 'bun:test';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { smtpFixture } from './test-support/smtp-fixture';
import { imapFixture } from './test-support/imap-fixture';

test('packed SMTP/IMAP facade resolves, typechecks and sends/receives from a fresh consumer', async () => {
  const fixture = await packageFixture('mail-package'), root = fixture.root;
  const consumer = join(root, 'consumer'), archive = process.env.ZERO_MAIL_ARCHIVE ?? join(root, 'framework.tgz');
  let smtp: Awaited<ReturnType<typeof smtpFixture>> | undefined, imap: Awaited<ReturnType<typeof imapFixture>> | undefined;
  const started = performance.now();
  const phase = async (name: string) => {
    if (process.env.ZERO_MAIL_PHASE_REPORT === root || process.env.ZERO_MAIL_PHASE_REPORT?.startsWith(root + '/')) throw Error('Mail phase report must remain outside its disposable fixture.');
    if (process.env.ZERO_MAIL_PHASE_REPORT) await Bun.write(process.env.ZERO_MAIL_PHASE_REPORT,
      `${JSON.stringify({ phase: name, elapsedMs: Math.round(performance.now() - started) })}\n`);
  };
  try {
    if (fixture.retirement) throw Error('Mail fixture teardown already started.');
    smtp = await smtpFixture(); fixture.closers.push(() => smtp!.close());
    if (fixture.retirement) throw Error('Mail fixture teardown started during SMTP admission.');
    imap = await imapFixture(); fixture.closers.push(() => imap!.close());
    if (fixture.retirement) throw Error('Mail fixture teardown started during IMAP admission.');
    await phase('pack');
    await mkdir(consumer);
    await claimPackageDependencies(fixture, consumer);
    if (!process.env.ZERO_MAIL_ARCHIVE) await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], process.cwd());
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({ name: 'zero-mail-proof', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, typescript: '^5.7.0', '@types/bun': 'latest', '@types/react': '^19.2.14', '@types/react-dom': '^19.2.3' },
    }));
    await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext',
      moduleResolution: 'Bundler', strict: true, skipLibCheck: true, esModuleInterop: true, jsx: 'react-jsx', types: ['bun'] }, include: ['consumer.ts'] }));
    await Bun.write(join(consumer, 'consumer.ts'), CONSUMER);
    await phase('install');
    await checked(['install', '--ignore-scripts'], consumer);
    const installed = await Bun.file(join(consumer, 'node_modules/@zero/framework/package.json')).json();
    expect(installed.dependencies.nodemailer).toBe('10.2.1'); expect(installed.dependencies.imapflow).toBe('2.9.1');
    for (const file of ['smtp.md', 'mailbox.md', 'inbox.md']) expect(await Bun.file(join(consumer, 'node_modules/@zero/framework/docs-next/backend/email', file)).exists()).toBe(true);
    expect(await Bun.file(join(consumer, 'node_modules/@zero/framework/docs-next/frontend/email/index.md')).exists()).toBe(true);
    expect(installed.dependencies['@types/css-tree']).toBe('3.2.0');
    for (const file of ['src/email/inbox/inbox-service.ts', 'src/email/inbox/inbox-stream.ts', 'src/email/inbox/inbox-state-store.ts', 'src/email/email-attachments.ts', 'src/email/types.ts', 'src/email/runtime.ts', 'src/email/index.ts', 'src/email/resend-email-provider.ts', 'src/email/smtp-email-provider.ts', 'src/frontend/client/email-inbox-source.ts']) {
      expect(await Bun.file(join(consumer, 'node_modules/@zero/framework', file)).text()).toBe(await Bun.file(join(process.cwd(), file)).text());
    }
    await phase('typecheck');
    await checked(['run', 'node_modules/typescript/bin/tsc', '--noEmit'], consumer);
    await phase('runtime');
    const output = await checked(['consumer.ts'], consumer, { TEST_SMTP_PORT: String(smtp.config.port), TEST_IMAP_PORT: String(imap.config.port) });
    expect(output).toContain('[zero-mail-package] complete'); expect(smtp.messages).toHaveLength(1);
    await Bun.write(join(consumer, 'browser.tsx'), `import { EmailInbox } from '@zero/framework/email-inbox'; export const page = <EmailInbox />;`);
    await phase('browser');
    await checked(['build', 'browser.tsx', '--target=browser', '--outdir', join(root, 'browser')], consumer);
  } finally { try { await phase('cleanup'); } finally { fixture.settleBody(); await retirePackageFixture(fixture); } await phase('complete'); }
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
    const timer = setTimeout(() => { timedOut = true; stop(); }, 120_000);
    const hardTimer = setTimeout(() => rejectRetirement(Error('Owned package child did not settle after phase deadline.')), 120_000 + 5000);
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
      command: [process.execPath, '--no-env-file', ...args], bun: Bun.version, phaseTimeoutMs: 120_000 }));
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
          bun: Bun.version, phaseTimeoutMs: 120_000, elapsedMs: Math.round(performance.now() - started),
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
import { createEmailRuntime, emailFromEnv, isEmailAttachmentDeliveryReady, ResendEmailProvider, SmtpEmailProvider, ImapMailbox, type EmailAttachment, type MailMessageRef, type MailboxChange } from '@zero/framework/email';
import { SmtpEmailProvider as ServerSmtp, ImapMailbox as ServerImap } from '@zero/framework/server';
import { EmailInbox, EmailHtmlBody, EmailInboxController, emptyEmailCompose, type EmailInboxSource } from '@zero/framework/email-inbox';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

const shell = renderToString(createElement(EmailInbox));
if (!shell.includes('Email workspace')) throw new Error('Inbox SSR failed');
const body = renderToString(createElement(EmailHtmlBody, { html: '<script>throw 1</script><p>Synthetic</p>', contentKey: 'ssr-test' }));
if (body.includes('<script>')) throw new Error('SSR emitted sender markup');
const empty = emptyEmailCompose('default');
if (empty.from !== 'default' || typeof EmailInboxController !== 'function') throw new Error('Inbox public facade failed');

if (ServerSmtp !== SmtpEmailProvider || ServerImap !== ImapMailbox) throw new Error('Public server exports diverged');
const config = emailFromEnv({ EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'sender@example.test',
  SMTP_HOST: '127.0.0.1', SMTP_PORT: process.env.TEST_SMTP_PORT, SMTP_SECURE: 'false', SMTP_REQUIRE_TLS: 'false',
  SMTP_USER: 'user@example.test', SMTP_PASSWORD: 'test-password',
  IMAP_HOST: '127.0.0.1', IMAP_PORT: process.env.TEST_IMAP_PORT, IMAP_SECURE: 'false', IMAP_REQUIRE_TLS: 'false',
  IMAP_USER: 'user@example.test', IMAP_PASSWORD: 'test-password', IMAP_SENT_FOLDER: 'Sent',
});
const runtime = createEmailRuntime(config, {});
try {
  if (!isEmailAttachmentDeliveryReady(runtime)) throw new Error('SMTP attachment readiness failed');
  const attachment: EmailAttachment = { filename: 'synthetic.pdf', content: new Uint8Array([0, 1, 127, 128, 255]), contentType: 'application/pdf' };
  const receipt = await runtime.service.send({ to: 'recipient@example.test', subject: 'Packaged', text: 'Synthetic package proof', attachments: [attachment] });
  if (receipt.provider !== 'smtp' || receipt.sentCopy !== 'saved') throw new Error('Send/copy failed');
  const mailbox = runtime.mailbox;
  if (!mailbox) throw new Error('Receiving was not configured');
  const page = await mailbox.list({ limit: 50 });
  const ref: MailMessageRef = page.messages[0]!;
  const read = await mailbox.read(ref);
  if (!read.text.includes('Body')) throw new Error('Read failed');
  const live = mailbox.watch()[Symbol.asyncIterator]();
  const first = await live.next(); const change: MailboxChange = first.value as MailboxChange;
  if (change.type !== 'resync') throw new Error('Live subscription failed');
  await live.return?.();
} finally { await runtime.close?.(); }
const originalFetch = globalThis.fetch;
let attached = false;
globalThis.fetch = (async (_input, options) => {
  const body = JSON.parse(options!.body as string);
  attached = body.attachments[0].content === 'AAF/gP8=' && body.attachments[0].content_type === 'application/pdf';
  return Response.json({ id: 'synthetic-resend-receipt' });
}) as typeof fetch;
try {
  const resend = createEmailRuntime({ from: 'sender@example.test', provider: new ResendEmailProvider({ apiKey: 'synthetic' }) }, {});
  if (!isEmailAttachmentDeliveryReady(resend)) throw new Error('Resend attachment readiness failed');
  await resend.service.send({ to: 'recipient@example.test', subject: 'Synthetic', text: 'Body', attachments: [{ filename: 'synthetic.pdf', content: new Uint8Array([0, 1, 127, 128, 255]), contentType: 'application/pdf' }] });
  if (!attached) throw new Error('Resend attachment bytes changed');
} finally { globalThis.fetch = originalFetch; }
console.log('[zero-mail-package] complete');
`;
