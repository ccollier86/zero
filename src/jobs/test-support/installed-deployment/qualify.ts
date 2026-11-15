/**
 * Linux installed-archive qualification, not a Bun unit test or release selector.
 * The outer owner must pass dev-storage status/check, install the exact archive
 * in an isolated consumer, and own/retire its explicitly local container.
 *
 * bun --no-env-file qualify.ts --consumer /work/consumer \
 *   --archive /input/framework.tgz --commit <40-hex> --report /evidence/jobs-installed.json
 * Optional --installed-root must equal the real public resolver package root.
 * No dependency installation, shared-cache deletion, SQL or providers here.
 */
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const args = new Map<string, string>();
for (let index = 2; index < Bun.argv.length; index += 2) {
  const key = Bun.argv[index]!, value = Bun.argv[index + 1];
  assert(['--consumer', '--archive', '--commit', '--report', '--installed-root'].includes(key) && value && !args.has(key), 'Invalid qualification arguments.');
  args.set(key, value);
}
for (const key of ['--consumer', '--archive', '--commit', '--report']) assert(args.has(key), 'Missing qualification argument: ' + key);
assert(process.platform === 'linux' && process.arch === 'x64', 'This qualification requires Linux/x64.');
assert(/^[a-f0-9]{40}$/.test(args.get('--commit')!), 'A complete candidate commit is required.');
const consumer = await realpath(args.get('--consumer')!), archive = await realpath(args.get('--archive')!), reportPath = resolve(args.get('--report')!);
assert(isAbsolute(reportPath) && !inside(consumer, reportPath), 'Evidence must be outside the disposable consumer.');
// These public entries intentionally use import conditions, not CommonJS
// require conditions. Resolve them through the consumer's actual Bun importer.
const installed = await realpath(dirname(Bun.resolveSync('@zero/framework/package.json', consumer)));
assert(installed === await realpath(join(consumer, 'node_modules/@zero/framework')), 'The consumer must resolve its independently installed package.');
assert(inside(consumer, installed), 'The installed package must remain inside the isolated consumer.');
// Bun's isolated linker may use an internal node_modules/.bun symlink. Its
// physical target must still be inside this consumer and match all archive bytes.
if (args.has('--installed-root')) assert(installed === await realpath(args.get('--installed-root')!), 'Installed package root mismatch.');
const resolvers: Record<string, string> = {};
for (const entry of ['@zero/framework/server', '@zero/framework/jobs', '@zero/framework/jobs/server', '@zero/framework/workflows', '@zero/framework/logging/actor']) {
  const path = await realpath(Bun.resolveSync(entry, consumer)); assert(inside(installed, path), 'Public export escaped the installed package: ' + entry); resolvers[entry] = relative(installed, path);
}

const runId = crypto.randomUUID(), root = await mkdtemp(join(consumer, '.jobs-installed-')), identity = await lstat(root);
const markerName = '.storage-synthetic-fixture.json', marker = JSON.stringify({ schema: 1, kind: 'synthetic-test-fixture', project: 'zero-platform',
  allocator: 'src/jobs/test-support/installed-deployment/qualify.ts', run_id: runId, label: 'jobs-installed' });
let child: ReturnType<typeof Bun.spawn> | null = null, retirementConfirmed = true, origin = '', token = '', memberToken = '', ownerUserId = '';
let observer: ReturnType<typeof setInterval> | null = null, observing: Promise<void> = Promise.resolve();
const observed = new Map<number, string>(), captures: Promise<string>[] = [], expectedKinds: string[] = [];
const jobChildren = new Set<string>(), jobBoots = new Set<number>(); let childIsolationFailure = '';
const histories: { id: string; key: string; accepted: unknown; page: unknown }[] = [];
const evidence: Record<string, unknown> = { status: 'failed', commit: args.get('--commit'), platform: process.platform, arch: process.arch, bun: Bun.version,
  installedPublicExports: resolvers, source: false, officialBuild: false, minifiedBundle: false, crossModeRetainedState: false,
  limitations: ['No transport-outcome-unknown fault injection: a deliberately discarded acknowledgment is reconciled by its original receipt before same-key replay.',
    'Single managed application, local synthetic activity only; no real providers, accounts, external effects, multi-host election or compiled executable qualification.'] };
let stage = 'ownership';
try {
  await writeFile(join(root, markerName), marker, { flag: 'wx', mode: 0o600 });
  await mkdir(join(root, 'app')); await mkdir(join(root, 'state')); await mkdir(join(root, 'tmp'));
  await copyFile(join(import.meta.dir, 'fixture.ts'), join(root, 'fixture.ts'));
  await writeFile(join(root, 'zero.config.ts'), "import {installedJobsConfig} from './fixture'; export default installedJobsConfig();\n");
  // The actual entry imports the selected config, so the official adapter must run.
  await writeFile(join(root, 'app/server.ts'), "import config from '../zero.config'; import {startInstalledJobsFixture} from '../fixture'; await startInstalledJobsFixture(config);\n");
  await writeFile(join(root, 'logging-actor.ts'), "import {runLoggingActorIfRequested} from '@zero/framework/logging/actor'; if(!await runLoggingActorIfRequested())process.exitCode=64;\n");
  stage = 'exact-installed-archive';
  evidence.archiveSha256 = await hashFile(archive);
  // Compare each named file independently: concatenated file contents alone do
  // not prove file boundaries. No second extracted checkout is needed.
  assert((await lstat(archive)).size < 64_000_000, 'Candidate archive exceeded the compressed qualification bound.');
  const archiveFiles = await new Bun.Archive(await Bun.file(archive).arrayBuffer()).files();
  assert(archiveFiles.size > 0 && archiveFiles.size < 20000, 'Unexpected archive entry count.');
  let archiveBytes = 0;
  const expectedFiles = new Set<string>();
  for (const [name, expected] of archiveFiles) {
    assert(/^package\//.test(name) && !/[\\\x00-\x1f\x7f]/.test(name)
      && !name.split('/').some(part => !part || part === '.' || part === '..'), 'Unsafe archive entry.');
    const relativeName = name.slice('package/'.length);
    assert(!['node_modules', '.bun-tag'].includes(relativeName.split('/')[0]!), 'Archive claimed package-manager metadata.');
    expectedFiles.add(relativeName); archiveBytes += expected.size;
    assert(archiveBytes < 256_000_000, 'Candidate archive exceeded the qualification bound.');
    const file = join(installed, name.slice('package/'.length)), entry = await lstat(file);
    assert(inside(installed, await realpath(file)) && entry.isFile() && !entry.isSymbolicLink()
      && entry.size === expected.size, 'Installed archive file is missing, linked or the wrong size.');
    assert(await hashFile(file) === new Bun.CryptoHasher('sha256').update(await expected.arrayBuffer()).digest('hex'), 'Installed package file differs: ' + relativeName);
  }
  await inspectInstalledFiles(installed, expectedFiles);
  evidence.exactInstalledArchive = true;
  const lock = join(consumer, 'bun.lock'); evidence.consumerLockSha256 = await hashFile(lock);

  stage = 'source'; await launch('app/server.ts');
  const signed = await request('POST', '/auth/register', { username: 'installed-jobs-owner', email: 'installed-jobs@example.test', password: 'Synthetic-Jobs-Password-94!' }, 200, false);
  token = signed.accessToken; assert(typeof token === 'string', 'Native registration did not return a session.');
  ownerUserId = signed.user.userId; assert(typeof ownerUserId === 'string', 'Native registration did not return an actor.');
  const member = await request('POST', '/auth/register', { username: 'installed-jobs-member', email: 'installed-jobs-member@example.test', password: 'Synthetic-Jobs-Password-95!' }, 200, false);
  memberToken = member.accessToken;
  await request('GET', '/jobs/definitions', undefined, 401, false);
  await exercise('source'); evidence.source = true;

  // Source-created SYSTEM, application and private jobs ledgers must be retained
  // across the exact official build. A fresh bundled database would miss this.
  stage = 'official-build';
  await command([process.execPath, '--no-env-file', join(installed, 'src/cli/run.ts'), 'build', '--config', join(root, 'zero.config.ts')], root, 240000);
  evidence.officialBuild = true;
  await command([process.execPath, '--no-env-file', 'build', join(root, 'dist/server.js'), '--target=bun', '--minify', '--outfile', join(root, 'dist/server.min.js')], root, 120000);
  evidence.minifiedServerSha256 = await hashFile(join(root, 'dist/server.min.js'));
  const retained = await future('source.restart');
  assert(!(await calls()).some(row => row.kind === 'source.restart'), 'Future source work ran before restart.');
  await stop();
  await assertStoppedBeforeDue(retained);

  stage = 'retained-source-to-minified-official-bundle'; await launch('dist/server.min.js');
  await request('GET', '/auth/me'); await verifyHistory();
  histories.push({ id: retained.id, key: 'source.restart', accepted: retained.accepted, page: await completed(retained.id, 'source.restart') });
  assert(equal(await request('POST', '/jobs/schedules', retained.command, 202), retained.accepted), 'Cross-mode create receipt changed.');
  evidence.crossModeRetainedState = true;
  await exercise('bundle'); evidence.minifiedBundle = true;
  const bundledFuture = await future('bundle.restart'); await stop();
  await assertStoppedBeforeDue(bundledFuture);
  stage = 'minified-bundle-restart'; await launch('dist/server.min.js');
  await request('GET', '/auth/me'); await verifyHistory();
  histories.push({ id: bundledFuture.id, key: 'bundle.restart', accepted: bundledFuture.accepted, page: await completed(bundledFuture.id, 'bundle.restart') });
  assert(equal(await request('POST', '/jobs/schedules', bundledFuture.command, 202), bundledFuture.accepted), 'Bundled restart create receipt changed.');
  await verifyHistory();
  const finalCalls = await calls();
  assert(finalCalls.length === expectedKinds.length && expectedKinds.every(kind => finalCalls.filter(row => row.kind === kind).length === 1)
    && finalCalls.every(row => row.version === 1 && row.attempt === 0), 'A pinned synthetic activity was missing, duplicated or replayed.');
  let events: any[] = [];
  await eventually(async () => { events = await jobEvents(); return events.length >= 32; }, 'Final semantic delivery');
  const semanticCounts = { 'jobs.schedule.created': 10, 'jobs.schedule.paused': 2, 'jobs.schedule.readmitted': 2, 'jobs.schedule.cancelled': 2,
    'jobs.occurrence.handed-off': 8, 'jobs.occurrence.terminal-observed': 8 };
  assert(events.length === 32 && new Set(events.map(event => event.id)).size === 32
    && Object.entries(semanticCounts).every(([action, count]) => events.filter(event => event.action === action).length === count), 'Native semantic actions were missing or duplicated by replay/restart.');
  assert(events.every(event => event.evidence === 'server-confirmed' && event.scope.kind === 'application'
    && (event.action.startsWith('jobs.schedule.') ? event.actor.kind === 'user' && event.actor.id === ownerUserId
      : event.actor.kind === 'system' && event.actor.sessionId === null && event.origin === 'system')), 'Native job evidence lost its actor/system attribution.');
  evidence.nativeSemanticActions = [...new Set(events.map(event => event.action))].sort();
  evidence.nativeSemanticCounts = semanticCounts;
  evidence.activities = finalCalls.length; evidence.pinnedWorkflowVersion = 1; evidence.discardedAcknowledgmentReconciled = true;
  await stop();
  evidence.mainBoots = (await readFile(join(root, 'boots.ndjson'), 'utf8')).trim().split('\n').length;
  assert(evidence.mainBoots === 3, 'Unexpected application entry evaluation/boot count.');
  assert(jobBoots.size === 3 && !childIsolationFailure, childIsolationFailure || 'Default fixed jobs actors were not observed in all server boots.');
  evidence.fixedInstalledJobsActorProcesses = jobChildren.size; evidence.parentEnvironmentSentinelExcluded = true;
  for (const name of ['application.sqlite', 'system.sqlite']) assert((await lstat(join(root, 'state', name))).isFile(), 'Expected file-backed database is absent.');
  assert((await readdir(join(root, 'state/jobs'))).length > 0, 'Private jobs files were not created.');
  evidence.status = 'passed';
} catch (error) {
  evidence.failureStage = stage; evidence.failure = error instanceof Error ? error.message.slice(-16000) : 'Unknown qualification failure.'; throw error;
} finally {
  try { if (child) await stop(); }
  finally {
    evidence.retirementConfirmed = retirementConfirmed;
    const output = (await Promise.all(captures)).join('\n').slice(-24000);
    if (evidence.status !== 'passed') evidence.outputTail = output;
    let cleanupFailure: unknown;
    try {
      if (retirementConfirmed) {
        const current = await lstat(root);
        assert(current.dev === identity.dev && current.ino === identity.ino && !current.isSymbolicLink()
          && await readFile(join(root, markerName), 'utf8') === marker, 'Fixture ownership changed; preserving ' + root);
        await inspect(root); await rm(root, { recursive: true }); evidence.cleanedSyntheticRoot = true;
      } else throw new Error('Server/database/descendant retirement could not be confirmed; outer container owner must retire it.');
    } catch (error) {
      cleanupFailure = error; evidence.status = 'failed'; evidence.retainedSyntheticRoot = root;
      evidence.retainedReason = error instanceof Error ? error.message : 'Synthetic cleanup failed.';
    } finally {
      await writeFile(reportPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify(evidence));
    }
    if (cleanupFailure) throw cleanupFailure;
  }
}

function inside(parent: string, path: string) { const part = relative(parent, path); return part !== '' && part !== '..' && !part.startsWith('../') && !isAbsolute(part); }
function equal(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
async function inspectInstalledFiles(directory: string, expected: Set<string>) {
  for (const name of await readdir(directory)) {
    const path = join(directory, name), info = await lstat(path), part = relative(installed, path);
    if (directory === installed && name === 'node_modules') {
      assert(inside(consumer, await realpath(path)) && (info.isDirectory() || info.isSymbolicLink()), 'Invalid nested package dependencies.'); continue;
    }
    if (directory === installed && name === '.bun-tag') {
      assert(info.isFile() && !info.isSymbolicLink() && info.size <= 4096, 'Invalid package-manager installation marker.'); continue;
    }
    assert(!info.isSymbolicLink(), 'Unexpected installed package link.');
    if (info.isDirectory()) {
      assert([...expected].some(file => file.startsWith(part + '/')), 'Unexpected installed package directory: ' + part);
      await inspectInstalledFiles(path, expected);
    } else assert(info.isFile() && expected.has(part), 'Unexpected installed package file: ' + part);
  }
}
async function assertStoppedBeforeDue(pending: Awaited<ReturnType<typeof future>>) {
  assert(Date.now() < Date.parse(pending.command.schedule.timing.at), 'Restart fixture missed its pending-work deadline; do not claim restart recovery.');
  assert(!(await calls()).some(row => row.kind === pending.key), 'Future work executed before its restart boundary.');
}
function childEnv() { return { PATH: process.env.PATH ?? '', TMPDIR: join(root, 'tmp'), NODE_ENV: 'production', ZERO_INSTALLED_JOBS_PARENT_SENTINEL: 'synthetic-parent-only' }; }
async function hashFile(path: string) { const hash = new Bun.CryptoHasher('sha256'); for await (const bytes of Bun.file(path).stream()) hash.update(bytes); return hash.digest('hex'); }
async function tail(stream: ReadableStream<Uint8Array>, limit = 24000) { let text = ''; const decoder = new TextDecoder(); for await (const bytes of stream) text = (text + decoder.decode(bytes, { stream: true })).slice(-limit); return text + decoder.decode(); }
async function command(argv: string[], cwd: string, timeout = 120000, limit = 24000) {
  const process = Bun.spawn(argv, { cwd, env: childEnv(), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  let timedOut = false; const timer = setTimeout(() => { timedOut = true; retirementConfirmed = false; process.kill('SIGKILL'); }, timeout);
  try { const [code, out, err] = await Promise.all([process.exited, tail(process.stdout, limit), tail(process.stderr)]);
    assert(!timedOut && code === 0, 'Installed qualification command failed: ' + argv.slice(-3).join(' ') + '\n' + out + '\n' + err); return out;
  } finally { clearTimeout(timer); }
}
async function eventually(check: () => Promise<boolean>, label: string, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (!await check()) { assert(Date.now() < deadline, label + ' timed out.'); await Bun.sleep(50); }
}
async function processIdentity(pid: number) {
  try { const stat = await readFile('/proc/' + pid + '/stat', 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]!; } catch { return null; }
}
async function observe(pid: number) {
  const stamp = await processIdentity(pid); if (!stamp) return; observed.set(pid, stamp);
  try {
    const argv = (await readFile('/proc/' + pid + '/cmdline', 'utf8')).split('\0');
    if (argv.includes('--zero-jobs-actor')) {
      const entry = argv.find(value => value.endsWith('/jobs/actor-entry.ts'));
      if (!entry || await realpath(entry) !== join(installed, 'src/jobs/actor-entry.ts')) childIsolationFailure = 'A jobs actor did not use the fixed entry from this installed archive.';
      const env = await readFile('/proc/' + pid + '/environ', 'utf8');
      if (env.split('\0').some(value => value.startsWith('ZERO_INSTALLED_JOBS_PARENT_SENTINEL='))) childIsolationFailure = 'A jobs actor inherited the synthetic parent-only environment.';
      jobChildren.add(pid + ':' + stamp); if (child) jobBoots.add(child.pid);
    }
  } catch { /* A short-lived child may retire while /proc is being sampled. */ }
  let children = ''; try { children = await readFile('/proc/' + pid + '/task/' + pid + '/children', 'utf8'); } catch { return; }
  for (const value of children.trim().split(/\s+/).filter(Boolean)) await observe(Number(value));
}
async function launch(entry: string) {
  await unlink(join(root, 'ready.json')).catch(() => {}); await unlink(join(root, 'closed.json')).catch(() => {});
  child = Bun.spawn([process.execPath, '--no-env-file', join(root, entry)], { cwd: root, env: childEnv(), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  captures.push(tail(child.stdout as ReadableStream<Uint8Array>), tail(child.stderr as ReadableStream<Uint8Array>));
  observer = setInterval(() => { const pid = child?.pid; if (pid) observing = observing.then(() => observe(pid)); }, 100);
  await observe(child.pid);
  await eventually(async () => { assert(child!.exitCode === null, 'Managed server exited before readiness.'); return Bun.file(join(root, 'ready.json')).exists(); }, 'Managed startup');
  const ready = JSON.parse(await readFile(join(root, 'ready.json'), 'utf8'));
  assert(ready.runId === runId && ready.pid === child.pid, 'Unexpected ready marker.'); origin = 'http://127.0.0.1:' + ready.port;
}
async function stop() {
  const active = child; if (!active) return;
  if (observer) clearInterval(observer); observer = null; await observing; await observe(active.pid);
  if (active.exitCode === null) active.kill('SIGTERM');
  const timer = setTimeout(() => { retirementConfirmed = false; active.kill('SIGKILL'); }, 45000);
  try { await active.exited; } finally { clearTimeout(timer); child = null; }
  let closed; try { closed = JSON.parse(await readFile(join(root, 'closed.json'), 'utf8')); } catch { /* Retain rather than assume failed startup retired. */ }
  if (!closed || closed.runId !== runId || closed.pid !== active.pid || closed.retired !== true) retirementConfirmed = false;
  try { await eventually(async () => { for (const [pid, stamp] of observed) if (await processIdentity(pid) === stamp) return false; return true; }, 'Owned descendant retirement', 30000); }
  catch (error) { retirementConfirmed = false; throw error; }
  assert(retirementConfirmed, 'Owned server retirement unconfirmed; preserving ' + root);
}
async function request(method: string, path: string, body?: unknown, status = 200, authenticated: boolean | string = true) {
  const response = await fetch(origin + path, { method, headers: { ...(authenticated ? { Authorization: 'Bearer ' + (typeof authenticated === 'string' ? authenticated : token) } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const value = await response.json() as any;
  const code = typeof value?.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(value.code) ? value.code : 'UNEXPECTED_RESPONSE';
  assert(response.status === status, method + ' ' + path.replace(/\/jobs\/schedules\/[^/]+/, '/jobs/schedules/:id') + ' returned ' + response.status + ' (' + code + ')'); return value;
}
async function calls(): Promise<{ instanceId: string; kind: string; version: number; attempt: number }[]> {
  try { return (await readFile(join(root, 'calls.ndjson'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
async function completed(id: string, kind: string) {
  let page: any;
  try {
    await eventually(async () => { page = await request('GET', '/jobs/schedules/' + id + '/occurrences'); return page.total === 1 && page.items[0].state === 'terminal'; }, 'Native timer completion: ' + kind);
  } catch (error) {
    // Closed native views and counters only: never persist inputs, seals,
    // provider messages, workflow results or credential-bearing requests.
    const detail = await request('GET', '/jobs/schedules/' + id);
    evidence.stalledJob = { kind, id, control: detail.control, generation: detail.generation,
      nextDueAt: detail.nextDueAt, blockedCode: detail.blockedCode, occurrences: page?.items,
      observedLocalActivityCalls: (await calls()).filter(row => row.kind === kind).length,
      health: await request('GET', '/qualification/jobs-health') };
    if (page?.items?.[0]?.workflowId) {
      const workflow = await request('GET', '/workflows/' + page.items[0].workflowId);
      evidence.stalledWorkflow = { status: workflow.status, definitionVersion: workflow.definition_version };
    }
    throw error;
  }
  assert(page.items[0].terminalStatus === 'completed' && typeof page.items[0].workflowId === 'string', 'Torrent did not complete the synthetic occurrence.');
  const workflow = await request('GET', '/workflows/' + page.items[0].workflowId);
  assert(workflow.definition_version === 1 && typeof workflow.graph_fingerprint === 'string' && workflow.graph_fingerprint.length > 0, 'Torrent did not retain the exact admitted graph pin.');
  const mark = await request('GET', '/qualification/marks/' + page.items[0].workflowId);
  assert(mark.value?.kind === kind, 'Scoped workflow application-file commit is absent.'); return page;
}
async function future(kind: string) {
  expectedKinds.push(kind);
  const command = { schedule: { definition: 'installed.jobs', input: { kind, private: 'NEVER_PUBLISH_INSTALLED_JOB_INPUT' },
    timing: { kind: 'once', at: new Date(Date.now() + 15000).toISOString(), maxLatenessMs: 120000 } }, options: { idempotencyKey: kind } };
  const accepted = await request('POST', '/jobs/schedules', command, 202); return { id: accepted.id, key: kind, command, accepted };
}
async function exercise(mode: 'source' | 'bundle') {
  const definitions = await request('GET', '/jobs/definitions'); assert(definitions.items.some((item: any) => item.name === 'installed.jobs' && item.ownership.actor && item.ownership.service), 'Public job discovery is incomplete.');
  const kind = mode + '.control', key = mode + '.create'; expectedKinds.push(kind);
  const command = { schedule: { definition: 'installed.jobs', input: { kind, private: 'NEVER_PUBLISH_INSTALLED_JOB_INPUT' }, timing: { kind: 'once', at: new Date(Date.now() + 3600000).toISOString() } }, options: { idempotencyKey: key } };
  const accepted = await request('POST', '/jobs/schedules', command, 202), id = accepted.id;
  assert(equal(await request('POST', '/jobs/schedules', command, 202), accepted), 'Create replay was not the original permanent receipt.');
  assert(equal((await request('GET', '/jobs/receipts/' + key)).receipt, accepted), 'Permanent create receipt is absent.');
  await request('GET', '/jobs/schedules/' + id, undefined, 404, memberToken);
  const conflict = await request('POST', '/jobs/schedules', { ...command, schedule: { ...command.schedule, input: { ...command.schedule.input, kind: mode + '.different' } } }, 409);
  assert(conflict.code === 'JOBS_INTENT_CONFLICT', 'Changed same-key intent was not rejected.');
  const pause = { idempotencyKey: mode + '.pause', expectedRevision: 1 }, paused = await request('POST', '/jobs/schedules/' + id + '/pause', pause);
  assert(paused.control === 'paused' && paused.revision === 2 && equal(await request('POST', '/jobs/schedules/' + id + '/pause', pause), paused), 'Pause was not revisioned and duplicate-safe.');
  const stale = await request('POST', '/jobs/schedules/' + id + '/resume', { idempotencyKey: mode + '.stale', expectedRevision: 1 }, 409);
  assert(stale.code === 'JOBS_REVISION_CONFLICT', 'A stale readmission was accepted.');
  const resumed = await request('POST', '/jobs/schedules/' + id + '/resume', { idempotencyKey: mode + '.resume', expectedRevision: 2 });
  assert(resumed.control === 'active' && resumed.revision === 3 && resumed.generation === 2, 'Readmission did not create the next generation.');
  const nowCommand = { idempotencyKey: mode + '.now', expectedRevision: 3 }, now = await request('POST', '/jobs/schedules/' + id + '/runNow', nowCommand);
  assert(now.id !== id && equal(await request('POST', '/jobs/schedules/' + id + '/runNow', nowCommand), now), 'Run-now did not have its own duplicate-safe identity.');
  const page = await completed(now.id, kind);
  histories.push({ id: now.id, key: nowCommand.idempotencyKey, accepted: now, page });
  const cancelled = await request('POST', '/jobs/schedules/' + id + '/cancel', { idempotencyKey: mode + '.cancel', expectedRevision: 3 });
  assert(cancelled.control === 'cancelled' && cancelled.revision === 4, 'Scheduling cancellation was not retained.');
  assert((await request('GET', '/jobs/schedules/' + id + '/occurrences')).total === 0, 'Original future nominal occurrence was executed by run-now.');
  const lostKind = mode + '.discarded', lostCommand = { definition: 'installed.jobs', input: { kind: lostKind, private: 'NEVER_PUBLISH_INSTALLED_JOB_INPUT' }, idempotencyKey: lostKind };
  expectedKinds.push(lostKind);
  // No generic mutation retry: discard the first response and reconcile the
  // committed receipt under exactly the original identity before replay.
  const discarded = await fetch(origin + '/jobs/enqueue', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(lostCommand), signal: AbortSignal.timeout(30000) });
  await discarded.body?.cancel();
  const reconciled = (await request('GET', '/jobs/receipts/' + lostKind)).receipt; assert(reconciled, 'Discarded acknowledgment did not reconcile to a committed receipt.');
  assert(equal(await request('POST', '/jobs/enqueue', lostCommand, 202), reconciled), 'Same-identity reconciliation created a new admission.');
  histories.push({ id: reconciled.id, key: lostKind, accepted: reconciled, page: await completed(reconciled.id, lostKind) });
  const sdkKind = mode + '.sdk'; expectedKinds.push(sdkKind);
  const sdk = await request('POST', '/qualification/enqueue', { kind: sdkKind, idempotencyKey: sdkKind }, 202);
  histories.push({ id: sdk.id, key: sdkKind, accepted: sdk, page: await completed(sdk.id, sdkKind) });
  const schedules = await request('GET', '/jobs/schedules');
  assert(!JSON.stringify(schedules).includes('NEVER_PUBLISH') && !JSON.stringify(schedules).includes('authority'), 'Public schedule metadata exposed private admission input.');
  await eventually(async () => { const events = await jobEvents(); return ['jobs.schedule.created', 'jobs.schedule.paused', 'jobs.schedule.readmitted', 'jobs.schedule.cancelled'].every(action => events.some(event => event.action === action && event.target?.id === id))
    && events.some(event => event.action === 'jobs.occurrence.terminal-observed' && event.metadata?.scheduleId === now.id); }, 'Native semantic logging');
}
async function verifyHistory() {
  for (const item of histories) {
    assert(equal((await request('GET', '/jobs/receipts/' + item.key)).receipt, item.accepted), 'A retained accepted receipt changed across restart.');
    assert(equal(await request('GET', '/jobs/schedules/' + item.id + '/occurrences'), item.page), 'Completed occurrence history changed or duplicated after restart.');
  }
}
async function jobEvents(): Promise<any[]> {
  const page = await request('POST', '/api/_zero/logging/events', { stream: 'audit', query: { family: 'workflow', limit: 100 } });
  const events = page.events.map((row: any) => row.event).filter((event: any) => event.action.startsWith('jobs.'));
  assert(!JSON.stringify(events).includes('NEVER_PUBLISH'), 'Native semantic evidence included private job input.'); return events;
}
async function inspect(directory: string): Promise<void> {
  for (const name of await readdir(directory)) {
    assert(!['.git', '.storage-keep', '.keep', '.pin', 'PINNED', 'node_modules'].includes(name), 'Protected fixture content; preserving ' + root);
    const path = join(directory, name), entry = await lstat(path);
    assert(!entry.isSymbolicLink() && entry.dev === identity.dev && (!entry.isFile() || entry.nlink === 1), 'Unowned fixture link; preserving ' + root);
    if (entry.isDirectory()) await inspect(path);
  }
}
