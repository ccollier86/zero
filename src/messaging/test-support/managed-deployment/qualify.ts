/** Execute after normal installed `zero build` inside an isolated Linux/amd64 container with retained source/dependencies. */
import { expect } from 'bun:test';
import { unlink } from 'node:fs/promises';
import { request, acknowledge, until } from './transport';
let child: ReturnType<typeof Bun.spawn> | null = null;
const output: Promise<string>[] = [], held = new Map<number, () => void>(); let providerCalls = 0;
// Normal Torrent ownership is a 30-second durable lease. A hard-killed main
// cannot release it. Honor its full expiry rather than stealing ownership or
// weakening runtime admission to make the restart test pass.
const crashLeaseGraceMs = 31_000;
const provider = Bun.serve({ hostname: '127.0.0.1', port: 4120, async fetch() {
  const call = ++providerCalls; await new Promise<void>(resolve => held.set(call, resolve));
  return Response.json({ id: 'synthetic-installed-answer-' + call, object: 'chat.completion', created: 1, model: 'chat',
    choices: [{ index: 0, message: { role: 'assistant', content: 'Synthetic installed answer ' + call }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } });
} });
type Probe = { pid: number; kind: string; role?: string; providerSecret: boolean; dotenvSecret: boolean };
const probes = async (): Promise<Probe[]> => (await Bun.file('./actor-probes.ndjson').text()).trim().split('\n').filter(Boolean).map(row => JSON.parse(row));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function launch() {
  await unlink('./ready.json').catch(() => {});
  child = Bun.spawn([process.execPath, '--no-env-file', './dist/server.js'], { stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH ?? '', TMPDIR: '/tmp', NODE_ENV: 'production', ZERO_SYNTHETIC_PROVIDER_SECRET: 'must-not-inherit' } });
  output.push(new Response(child.stdout as ReadableStream).text(), new Response(child.stderr as ReadableStream).text());
  await until(async () => { if (child!.exitCode !== null) throw new Error('Bundled main exited before readiness.'); return Bun.file('./ready.json').exists(); }, 'Bundled main boot', 60000);
  const ready = await Bun.file('./ready.json').json(); expect(ready.pid).toBe(child.pid); return 'http://127.0.0.1:' + ready.port;
}
async function stop(signal: 'SIGTERM' | 'SIGKILL') {
  child!.kill(signal); const timer = setTimeout(() => child?.kill('SIGKILL'), 15000);
  try { await child!.exited; } finally { clearTimeout(timer); child = null; }
  const owned = await probes(); await until(() => owned.every(probe => !alive(probe.pid)), 'Owned child retirement', 30000);
}
try {
  expect(process.platform).toBe('linux'); expect(process.arch).toBe('x64');
  await Bun.write('./.env', 'ZERO_SYNTHETIC_DOTENV_SECRET=must-not-load\n');
  const seed = await Bun.file('./seed.json').json(), admin = seed.admin.accessToken, peer = seed.peer.accessToken;
  let origin = await launch(); await acknowledge(origin, admin); await acknowledge(origin, peer);
  expect((await request(origin, '/api/messaging/conversations/' + seed.conversation.id + '/messages', peer)).items[0].id).toBe(seed.message.id);
  // Terminate only this fixture's proven live private writer. A known crash may
  // reject an operation; explicit same-key recovery must not duplicate an intent.
  const writer = (await probes()).filter(probe => probe.kind === 'messaging' && probe.role === 'writer' && alive(probe.pid)).at(-1); expect(writer).toBeTruthy();
  process.kill(writer!.pid, 'SIGKILL'); await until(() => !alive(writer!.pid), 'Private writer death');
  let recoveryAttempts = 0;
  await until(async () => {
    try { await acknowledge(origin, admin); recoveryAttempts++; await request(origin, '/api/messaging/conversations/' + seed.conversation.id + '/messages', admin, { text: 'Synthetic post-writer-restart message' }, 'installed-writer-recovery'); return true; }
    catch (failure) { if (!failure || typeof failure !== 'object' || !('status' in failure) || ![409, 428, 500, 503].includes(Number(failure.status))) throw failure; return false; }
  }, 'Canonical writer recovery', 30000);
  const chats = await Promise.all([1, 2].map(n => request(origin, '/api/messaging/support', peer, {}, 'installed-ai-open-' + n)));
  await Promise.all(chats.map((chat, n) => request(origin, '/api/messaging/conversations/' + chat.id + '/messages', peer, { text: 'Synthetic parallel installed question ' + n }, 'installed-ai-send-' + n)));
  await until(() => providerCalls === 2, 'Concurrent provider starts');
  const start = performance.now(); await request(origin, '/api/messaging/conversations/' + seed.conversation.id + '/messages', peer, { text: 'Synthetic foreground write while AI waits' }, 'installed-foreground-write');
  const foregroundWriteMs = performance.now() - start; expect(foregroundWriteMs).toBeLessThan(5000);
  held.get(1)!(); held.get(2)!();
  await until(async () => (await Promise.all(chats.map(chat => request(origin, '/api/messaging/conversations/' + chat.id + '/messages', peer)))).every(page => page.items.some((message: any) => message.authorKind === 'assistant')), 'Parallel reply publication');
  const interrupted = await request(origin, '/api/messaging/support', peer, {}, 'installed-interrupted-open');
  await request(origin, '/api/messaging/conversations/' + interrupted.id + '/messages', peer, { text: 'Synthetic interrupted invocation' }, 'installed-interrupted-send');
  await until(() => providerCalls === 3, 'Invocation before main death');
  await stop('SIGKILL'); held.get(3)!();
  console.log('Waiting for the normal workflow ownership lease after main SIGKILL.');
  await Bun.sleep(crashLeaseGraceMs);
  origin = await launch(); await acknowledge(origin, admin); await acknowledge(origin, peer);
  await until(async () => (await request(origin, '/api/messaging/conversations/' + interrupted.id, peer)).owner === 'triage', 'Unknown invocation recovery');
  expect(providerCalls).toBe(3); // Recovery must never repeat a dispatched external call automatically.
  const waiting = await request(origin, '/api/messaging/conversations/' + interrupted.id, peer);
  await request(origin, '/api/messaging/support/' + interrupted.id + '/claim', admin, { expectedEpoch: waiting.ownerEpoch }, 'installed-review-claim');
  const reviews = await request(origin, '/api/messaging/conversations/' + interrupted.id + '/review', admin); expect(reviews.items).toHaveLength(1);
  const detail = await request(origin, '/api/messaging/conversations/' + interrupted.id + '/review/' + reviews.items[0].id, admin); expect(detail.history.length).toBeGreaterThan(0);
  expect(detail.history.some((row: any) => row.outcome === 'unknown')).toBe(true);
  const replay = await request(origin, '/api/messaging/conversations/' + seed.conversation.id + '/messages', admin, seed.body, 'installed-source-send'); expect(replay.id).toBe(seed.message.id);
  const history = await request(origin, '/api/messaging/conversations/' + seed.conversation.id + '/messages', peer); expect(history.items.filter((row: any) => row.id === seed.message.id)).toHaveLength(1);
  const download = await fetch(origin + '/api/messaging/conversations/' + seed.conversation.id + '/attachments/' + seed.file.id + '/content', { headers: { Authorization: 'Bearer ' + peer } }); expect(download.status).toBe(200);
  expect(new Bun.CryptoHasher('sha256').update(new Uint8Array(await download.arrayBuffer())).digest('hex')).toBe(seed.file.checksum);
  const health = await request(origin, '/api/_zero/logging/health', admin); expect(health.coverage.complianceReady).toBe(true);
  await stop('SIGTERM');
  const boots = (await Bun.file('./main-boots.ndjson').text()).trim().split('\n'), actors = await probes();
  expect(boots).toHaveLength(2); expect(actors.every(probe => !probe.providerSecret && !probe.dotenvSecret)).toBe(true);
  const report = { platform: process.platform, arch: process.arch, bun: Bun.version, mainBoots: boots.length, workerLaunches: actors.length,
    officialBuild: true, sourcePreparedState: true, sourceActor: true, emptyChildEnvironment: true, noActorAppBoot: true, writerSigkillRecovery: true,
    recoveryAttempts, crashLeaseGraceMs, concurrentProviderCalls: 2, foregroundWriteMs, uncertainInvocationNotRepeated: true, retainedReview: true, privateFileAfterRestart: true,
    exactReplayCount: 1, complianceReady: true };
  await Bun.write('./qualification-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally {
  for (const release of held.values()) release();
  const active = child as ReturnType<typeof Bun.spawn> | null;
  if (active && active.exitCode === null) { active.kill('SIGKILL'); await active.exited; }
  await provider.stop(true); await Bun.write('./server-output.log', (await Promise.all(output)).join('\n'));
}
