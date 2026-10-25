/** Run inside a disposable Linux/amd64 container after the official installed `zero build`. */
import { expect } from 'bun:test';
import { unlink } from 'node:fs/promises';

let child: ReturnType<typeof Bun.spawn> | null = null;
const output: Promise<string>[] = [];
const deadline = async (work: () => Promise<boolean>, label: string, timeout = 30000) => {
  const until = Date.now() + timeout;
  while (!await work()) { if (Date.now() >= until) throw new Error(label + ' timed out'); await Bun.sleep(25); }
};
async function launch() {
  await unlink('./ready.json').catch(() => {});
  child = Bun.spawn([process.execPath, '--no-env-file', './dist/server.js'], {
    stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH ?? '', TMPDIR: '/tmp', NODE_ENV: 'production', ZERO_SYNTHETIC_PROVIDER_SECRET: 'must-not-inherit' },
  });
  output.push(new Response(child.stdout as ReadableStream<Uint8Array>).text(), new Response(child.stderr as ReadableStream<Uint8Array>).text());
  await deadline(async () => { if (child!.exitCode !== null) throw new Error('Managed build exited before readiness'); return Bun.file('./ready.json').exists(); }, 'Managed startup', 60000);
  const ready = await Bun.file('./ready.json').json(); expect(ready.pid).toBe(child.pid);
  return 'http://127.0.0.1:' + ready.port;
}
async function stop(signal: 'SIGKILL' | 'SIGTERM') {
  child!.kill(signal); const timer = setTimeout(() => child?.kill('SIGKILL'), 15000);
  try { await child!.exited; } finally { clearTimeout(timer); child = null; }
  const probes = (await Bun.file('./actor-probes.ndjson').text()).trim().split('\n').map(row => JSON.parse(row));
  await deadline(async () => probes.every(probe => { try { process.kill(probe.pid, 0); return false; } catch { return true; } }), 'Worker retirement');
}
async function request(origin: string, path: string, token?: string, body?: unknown) {
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const text = await response.text(); let value;
  try { value = JSON.parse(text); }
  catch { throw new Error('Synthetic deployment ' + path + ' returned ' + response.status + ': ' + text.slice(0, 200)); }
  expect(response.status, JSON.stringify(value)).toBe(200); return value;
}

try {
  expect(process.platform).toBe('linux'); expect(process.arch).toBe('x64');
  await Bun.write('./.env', 'ZERO_SYNTHETIC_DOTENV_SECRET=must-not-load\n');
  let origin = await launch();
  let signed = await request(origin, '/auth/register', undefined, { username: 'deployment-owner', email: 'deployment-owner@example.test', password: 'Fixture-password-123!' });
  const acknowledge = async () => {
    const policy = await request(origin, '/api/_zero/logging/policy', signed.accessToken);
    await request(origin, '/api/_zero/logging/observations', signed.accessToken, { observations: [], policyVersion: policy.delivery.policyVersion });
  };
  await acknowledge();
  await request(origin, '/proof/record', signed.accessToken, {});
  const artifact = await request(origin, '/api/_zero/logging/exports/create', signed.accessToken,
    { id: 'deployment.export', stream: 'audit', query: { action: 'app.deployment.prepared' } });
  expect(artifact.state).toBe('ready');
  await stop('SIGKILL');
  origin = await launch();
  // Exact replay retains the original actor/session envelope. A new login is
  // a different session and correctly conflicts with the old event identity.
  await request(origin, '/auth/me', signed.accessToken);
  await acknowledge();
  await request(origin, '/proof/record', signed.accessToken, {});
  const page = await request(origin, '/api/_zero/logging/events', signed.accessToken, { stream: 'audit', query: { action: 'app.deployment.prepared' } });
  expect(page.events).toHaveLength(1);
  const download = await fetch(origin + '/api/_zero/logging/exports/download', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + signed.accessToken }, body: JSON.stringify({ id: artifact.id }) });
  expect(download.status).toBe(200);
  expect(new Bun.CryptoHasher('sha256').update(new Uint8Array(await download.arrayBuffer())).digest('hex')).toBe(artifact.sha256);
  const health = await request(origin, '/api/_zero/logging/health', signed.accessToken); expect(health.coverage.complianceReady).toBe(true);
  await stop('SIGTERM');
  const boots = (await Bun.file('./main-boots.ndjson').text()).trim().split('\n'); expect(boots).toHaveLength(2);
  const probes = (await Bun.file('./actor-probes.ndjson').text()).trim().split('\n').map(row => JSON.parse(row));
  expect(probes.length).toBeGreaterThanOrEqual(8);
  expect(probes.every(probe => !probe.providerSecret && !probe.dotenvSecret)).toBe(true);
  const report = { platform: process.platform, arch: process.arch, bun: Bun.version, mainBoots: boots.length, workerLaunches: probes.length,
    sourceActor: true, emptyChildEnvironment: true, dotenvExcluded: true, officialBuild: true, privateExportAfterRestart: true, exactReplayCount: page.events.length, complianceReady: true };
  await Bun.write('./qualification-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally {
  const active = child as ReturnType<typeof Bun.spawn> | null;
  if (active && active.exitCode === null) { active.kill('SIGKILL'); await active.exited; }
  await Bun.write('./server-output.log', (await Promise.all(output)).join('\n'));
}
