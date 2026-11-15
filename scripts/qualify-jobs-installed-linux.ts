/** Exact archive consumer in the approved local Colima engine. No saved-release selection or application deployment. */
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { ownedWorkerFixture } from '../src/workers/test-support/owned-fixture';

const values = new Map<string, string>();
for (let i = 2; i < Bun.argv.length; i += 2) {
  const key = Bun.argv[i], value = Bun.argv[i + 1];
  if (!['--archive', '--commit', '--report'].includes(key!) || !value || values.has(key!)) throw new Error('Expected --archive, --commit and --report.');
  values.set(key!, value);
}
const archive = values.get('--archive'), commit = values.get('--commit'), report = values.get('--report');
if (!archive || !report || !isAbsolute(archive) || !isAbsolute(report) || !/^[a-f0-9]{40}$/.test(commit ?? '')
  || !resolve(report).startsWith('/Volumes/code-bank/artifacts/zero-platform/diagnostics/')) throw new Error('Explicit candidate identity and external diagnostic destination required.');
const context = 'colima-zero-workers', socket = 'unix:///Volumes/code-bank/docker/colima/zero-workers/docker.sock';
const image = 'oven/bun@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d';
const docker = (args: string[]) => ['docker', '--context', context, ...args];
if ((await command(docker(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']))).trim() !== socket) throw new Error('Only the exact local external Zero Colima engine is admitted.');
const owned = await ownedWorkerFixture('jobs-installed-linux'), runId = crypto.randomUUID(), name = 'zero-jobs-installed-' + runId;
const input = join(owned.root, 'input'), evidence = join(owned.root, 'evidence');
let started = false, retired = false;
try {
  await mkdir(input); await mkdir(evidence); await copyFile(archive, join(input, 'framework.tgz'));
  const bytes = await Bun.file(join(input, 'framework.tgz')).arrayBuffer();
  const archiveSha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  const files = await new Bun.Archive(bytes).files();
  const manifestFile = files.get('package/package.json'); if (!manifestFile) throw new Error('Missing candidate package manifest.');
  const manifest = JSON.parse(await manifestFile.text());
  if (manifest.name !== '@zero/framework') throw new Error('Not a framework candidate.');
  for (const file of ['fixture.ts', 'qualify.ts']) {
    const entry = files.get('package/src/jobs/test-support/installed-deployment/' + file);
    if (!entry) throw new Error('Committed archive is missing the installed deployment probe.');
    await writeFile(join(input, file), new Uint8Array(await entry.arrayBuffer()), { flag: 'wx' });
  }
  await writeFile(join(input, 'consumer.json'), JSON.stringify({ name: 'zero-jobs-installed-consumer', private: true, type: 'module',
    dependencies: { '@zero/framework': 'file:/input/framework.tgz', react: manifest.devDependencies.react, 'react-dom': manifest.devDependencies['react-dom'] }, overrides: manifest.overrides }));
  await writeFile(join(input, 'run.ts'), `
    import {mkdir,copyFile,readFile} from 'node:fs/promises';
    await mkdir('/work/consumer',{recursive:true}); await mkdir('/work/tmp',{recursive:true});
    await copyFile('/input/consumer.json','/work/consumer/package.json');
    async function run(args:string[]){
      console.log(JSON.stringify({stage:'jobs-installed-linux',command:args.slice(0,3)}));
      const child=Bun.spawn([process.execPath,'--no-env-file',...args],{cwd:'/work/consumer',env:{PATH:process.env.PATH??'',TMPDIR:'/work/tmp',BUN_INSTALL_CACHE_DIR:'/work/cache'},stdin:'ignore',stdout:'inherit',stderr:'inherit'});
      if(await child.exited!==0)throw Error('Installed jobs qualification stage failed.');
    }
    await run(['install','--ignore-scripts','--silent']);
    const before=await readFile('/work/consumer/bun.lock','utf8');
    await run(['install','--frozen-lockfile','--ignore-scripts','--silent']);
    if(before!==await readFile('/work/consumer/bun.lock','utf8'))throw Error('Frozen consumer admission changed its lock.');
    await run(['/input/qualify.ts','--consumer','/work/consumer','--installed-root','/work/consumer/node_modules/@zero/framework','--archive','/input/framework.tgz','--commit',${JSON.stringify(commit)},'--report','/evidence/jobs-installed.json']);
  `, { flag: 'wx' });
  const cache = 'zero-workers-bun-cache';
  await command(docker(['volume', 'create', '--label', 'dev.storage.project=zero-platform', '--label', 'dev.storage.purpose=worker-package-cache', cache]));
  const cacheLabels = JSON.parse((await command(docker(['volume', 'inspect', cache, '--format', '{{json .Labels}}']))).trim());
  if (cacheLabels['dev.storage.project'] !== 'zero-platform' || cacheLabels['dev.storage.purpose'] !== 'worker-package-cache') throw new Error('Shared download-cache ownership mismatch.');
  started = true;
  let failure: unknown;
  try {
    await command(docker(['run', '--rm', '--init', '--name', name, '--platform', 'linux/amd64',
      '--label', 'dev.storage.disposable=true', '--label', 'dev.storage.project=zero-platform', '--label', 'dev.storage.run-id=' + runId,
      '--memory', '3g', '--cpus', '4', '--pids-limit', '256', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--mount', `type=bind,src=${input},dst=/input,readonly`, '--mount', `type=bind,src=${evidence},dst=/evidence`,
      '--mount', `type=volume,src=${cache},dst=/work/cache`, '--entrypoint', '/usr/local/bin/bun', image, '--no-env-file', '/input/run.ts']), 900_000);
  } catch (error) { failure = error; }
  await mkdir(dirname(report), { recursive: true });
  if (!(await realpath(dirname(report))).startsWith('/Volumes/code-bank/artifacts/zero-platform/diagnostics/')) throw new Error('Diagnostic destination escaped its approved root.');
  const result = await Bun.file(join(evidence, 'jobs-installed.json')).exists() ? JSON.parse(await readFile(join(evidence, 'jobs-installed.json'), 'utf8'))
    : { status: 'failed', failureStage: 'container-admission-or-probe', failure: failure instanceof Error ? failure.message.slice(-24_000) : 'No probe report.' };
  if (result.archiveSha256 !== undefined && result.archiveSha256 !== archiveSha256 || result.commit !== undefined && result.commit !== commit) throw new Error('Installed evidence identity mismatch.');
  await writeFile(report, JSON.stringify({ ...result, commit, archiveSha256, image, dockerContext: context, runId }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (failure) throw failure;
  if (result.status !== 'passed' || result.cleanedSyntheticRoot !== true || result.retirementConfirmed !== true) throw new Error('Installed jobs proof did not qualify its lifecycle.');
  retired = !(await command(docker(['ps', '-aq', '--filter', 'label=dev.storage.run-id=' + runId]))).trim();
  if (!retired) throw new Error('Owned qualification container remains.');
  console.log(JSON.stringify({ result: 'installed-jobs-linux-amd64-passed', commit, archiveSha256, report }));
} finally {
  if (started && !retired) {
    const ids = (await command(docker(['ps', '-aq', '--filter', 'name=^/' + name + '$', '--filter', 'label=dev.storage.run-id=' + runId,
      '--filter', 'label=dev.storage.project=zero-platform', '--filter', 'label=dev.storage.disposable=true']))).trim();
    if (ids) await command(docker(['rm', '-f', ids]));
    retired = !(await command(docker(['ps', '-aq', '--filter', 'label=dev.storage.run-id=' + runId]))).trim();
  }
  if (started && !retired) throw new Error('Owned Linux container retirement unconfirmed; preserving ' + owned.root);
  await owned.cleanup();
}

async function command(args: string[], timeout = 180_000): Promise<string> {
  const child = Bun.spawn(args, { env: process.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const tail = async (stream: ReadableStream<Uint8Array>) => { let out = ''; const decoder = new TextDecoder();
    for await (const chunk of stream) out = (out + decoder.decode(chunk, { stream: true })).slice(-32_000); return out + decoder.decode(); };
  let expired = false; const timer = setTimeout(() => { expired = true; child.kill('SIGKILL'); }, timeout);
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, tail(child.stdout), tail(child.stderr)]);
    if (args.includes('run')) console.log((stdout + stderr).slice(-12_000));
    if (expired || code !== 0) throw new Error('Local installed qualifier failed (' + code + '): ' + (stdout + stderr).slice(-24_000));
    return stdout;
  } finally { clearTimeout(timer); }
}
