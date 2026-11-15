/** Minimal local Linux/amd64 probe before an expensive matrix. Owns and retires only its exact labelled container. */
import { fileURLToPath } from 'node:url';
const context = 'colima-zero-workers', socket = 'unix:///Volumes/code-bank/docker/colima/zero-workers/docker.sock';
const runId = crypto.randomUUID(), name = 'zero-ipc-' + runId;
const command = async (args: string[], timeoutMs = 30_000) => {
  const child = Bun.spawn(['docker', '--context', context, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const read = async (stream: ReadableStream<Uint8Array>) => { let value = ''; const decoder = new TextDecoder(); for await (const chunk of stream) value = (value + decoder.decode(chunk, { stream: true })).slice(-32_000); return value + decoder.decode(); };
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  try { const [code, stdout, stderr] = await Promise.all([child.exited, read(child.stdout), read(child.stderr)]); return { code, stdout, stderr }; }
  finally { clearTimeout(timer); }
};
const endpoint = await command(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']);
if (endpoint.code !== 0 || endpoint.stdout.trim() !== socket) throw new Error('The IPC probe requires the exact external local Colima context.');
const filters = ['--filter', 'name=^/' + name + '$', '--filter', 'label=dev.storage.run-id=' + runId,
  '--filter', 'label=dev.storage.project=zero-platform', '--filter', 'label=dev.storage.disposable=true'];
let started = false;
try {
  started = true;
  const result = await command(['run', '--name', name, '--rm', '--init', '--platform', 'linux/amd64',
    '--label', 'dev.storage.disposable=true', '--label', 'dev.storage.project=zero-platform', '--label', 'dev.storage.run-id=' + runId,
    '--network', 'none', '--memory', '512m', '--cpus', '2', '--pids-limit', '32', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--mount', 'type=bind,src=' + fileURLToPath(new URL('./qualify-worker-ipc-probe.ts', import.meta.url)) + ',dst=/qualify/probe.ts,readonly',
    '--entrypoint', '/usr/local/bin/bun', 'oven/bun:1.4.4', '--no-env-file', '/qualify/probe.ts']);
  console.log(result.stdout); if (result.stderr) console.log(result.stderr);
  if (result.code !== 0) throw new Error('The isolated Linux IPC probe did not pass.');
} finally {
  if (started) {
    const owned = await command(['ps', '-aq', ...filters]);
    if (owned.code !== 0) throw new Error('IPC container retirement is unconfirmed.');
    const ids = owned.stdout.trim().split(/\s+/).filter(Boolean);
    if (ids.some(id => !/^[a-f0-9]{12,64}$/.test(id))) throw new Error('Unexpected IPC container identity; no cleanup was attempted.');
    if (ids.length && (await command(['rm', '-f', ...ids])).code !== 0) throw new Error('Owned IPC container could not be retired.');
    const remaining = await command(['ps', '-aq', ...filters]);
    if (remaining.code !== 0 || remaining.stdout.trim()) throw new Error('Owned IPC container remains after the probe.');
  }
}
