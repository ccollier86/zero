/** Explicit local Colima Linux/amd64 qualification. No remote context, image build, saved-release selection or app data. */
import { copyFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownedWorkerFixture } from '../src/workers/test-support/owned-fixture';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const context = 'colima-zero-workers';
const socket = 'unix:///Volumes/code-bank/docker/colima/zero-workers/docker.sock';
const image = 'oven/bun:1.4.4';
const emulatedSmoke = Bun.argv.slice(2).length === 1 && Bun.argv[2] === '--emulated-smoke';
if (Bun.argv.length > 2 && !emulatedSmoke) throw new Error('Only --emulated-smoke is supported.');
// Rosetta's raw Bun-only IPC baseline can exceed 5 s before any Zero imports.
// This explicit diagnostic deployment budget does not change runtime defaults
// or relabel the earlier default-budget matrix as passing.
const startupBudget = emulatedSmoke ? 15_000 : 5000;
const docker = (args: string[]) => ['docker', '--context', context, ...args];
if ((await command(docker(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']))).trim() !== socket) {
  throw new Error('Qualification requires the exact external, local Zero Colima context.');
}
const fixture = await ownedWorkerFixture('linux'), runId = crypto.randomUUID(), name = 'zero-workers-' + runId;
const labels = ['--label', 'dev.storage.disposable=true', '--label', 'dev.storage.project=zero-platform', '--label', 'dev.storage.run-id=' + runId];
const packageRoot = fixture.root;
let containerStarted = false, settled = false;
try {
  await command([process.execPath, '--no-env-file', 'pm', 'pack', '--ignore-scripts', '--quiet', '--destination', fixture.root], root);
  const archive = (await readdir(fixture.root)).find(name => name.endsWith('.tgz'));
  if (!archive) throw new Error('No candidate archive.');
  const archiveHash = new Bun.CryptoHasher('sha256').update(await Bun.file(join(fixture.root, archive)).arrayBuffer()).digest('hex');
  console.log(JSON.stringify({ stage: 'candidate-provenance', archiveSha256: archiveHash, image, platform: 'linux/amd64', supervisor: 'docker-init',
    mode: emulatedSmoke ? 'explicit-budget-emulated-smoke' : 'default-budget-matrix', startupTimeoutMs: startupBudget }));
  await copyFile(join(root, 'bun.lock'), join(fixture.root, 'bun.lock'));
  await writeFile(join(packageRoot, 'worker-linux-probe.ts'), `
    import {ProcessWorkPool} from '@zero/framework/workers';
    import {tasks,sumTask} from './src/workers/test-support/worker-entry';
    const mode=process.argv[2]||'compiled';
    const launch=mode==='source'?{kind:'source' as const,entrypoint:'/work/package/src/workers/test-support/worker-entry.ts'}
      :mode==='bundle'?{kind:'source' as const,entrypoint:'/qualify/worker-bundle.js'}:{kind:'bundle' as const,entrypoint:'/qualify/worker-linux'};
    const owner=new ProcessWorkPool({tasks,launch,processes:2,env:{},startupTimeoutMs:${startupBudget}});
    const started=Date.now();console.log(JSON.stringify({stage:'worker-probe-start',mode,startupTimeoutMs:${startupBudget}}));
    try{
      const result:number=await owner.run(sumTask,[12,25,8]);if(result!==45)throw Error('compiled result');
      const environment=await owner.run('fixture.env',null) as {inheritedSecret:boolean};
      if(environment.inheritedSecret)throw Error('parent secret inherited');
      await Promise.all([owner.run('fixture.cpu',100),owner.run('fixture.cpu',100)]);
    }catch(error){console.log(JSON.stringify({stage:'worker-probe-failed',mode,elapsedMs:Date.now()-started,code:error?.code,outcome:error?.outcome}));throw error;}
    finally{await owner.close();}
    if(owner.status().processes!==0)throw Error('worker retained');
    console.log('LINUX_WORKERS_OK '+mode);
  `);
  await writeFile(join(packageRoot, 'worker-containment-catalog.ts'), `
    import {writeFileSync} from 'node:fs';
    import {defineWorkerTask} from '@zero/framework/workers/tasks';
    export const tasks=[defineWorkerTask({name:'containment.spin',version:'1',
      parseInput(v){if(typeof v!=='string')throw Error('marker');return v;},parseOutput:()=>null,
      run(marker){writeFileSync(marker,'owned-synthetic-cpu-entered');const end=performance.now()+10000;while(performance.now()<end){}return null;}
    })];
  `);
  await writeFile(join(packageRoot, 'worker-containment-child.ts'), `
    import {runWorkerIfRequested} from '@zero/framework/workers/actor';
    import {tasks} from './worker-containment-catalog';
    if(!await runWorkerIfRequested({tasks}))process.exitCode=64;
  `);
  await writeFile(join(packageRoot, 'worker-containment-parent.ts'), `
    import {existsSync,mkdirSync} from 'node:fs';
    import {ProcessWorkPool} from '@zero/framework/workers';
    import {tasks} from './worker-containment-catalog';
    // A second container does not retain /work/tmp from the build container.
    // Bundle isolation requires its configured TMPDIR to exist before launch.
    mkdirSync('/qualify/tmp',{recursive:true,mode:0o700});
    const owner=new ProcessWorkPool({tasks,launch:{kind:'bundle',entrypoint:'/qualify/containment-child'},processes:1,startupTimeoutMs:${startupBudget}});
    let failure:string|null=null;
    const pending=owner.run('containment.spin','/qualify/containment-entered');void pending.catch(error=>{failure=/^WORKER_[A-Z_]+$/.test(error?.code)?error.code:'WORKER_NOT_READY';});
    const deadline=Date.now()+${startupBudget + 5000};
    while(!existsSync('/qualify/containment-entered')){
      if(failure){await owner.close();throw Error('Synthetic containment worker failed before CPU entry: '+failure);}
      if(Date.now()>deadline){await owner.close();throw Error('CPU entry not observed');}
      await Bun.sleep(5);
    }
    // The main app dies, not a graceful pool close. Container init must retire
    // the namespace, including the detached CPU child, before its ten-second fuse.
    process.kill(process.pid,'SIGKILL');
  `);
  await writeFile(join(fixture.root, 'run.ts'), `
    import {mkdir,copyFile} from 'node:fs/promises';
    const cwd='/work/package';
    async function run(args:string[]){
      console.log(JSON.stringify({stage:'linux-step',command:args[0],target:args[1]}));
      const p=Bun.spawn([process.execPath,'--no-env-file',...args],{cwd,env:{...process.env,TMPDIR:'/work/tmp',BUN_INSTALL_CACHE_DIR:'/work/cache'},stdout:'inherit',stderr:'inherit'});
      if(await p.exited!==0)throw Error('Linux qualification stage failed');
    }
    await mkdir('/work/tmp',{recursive:true});
    const unpack=Bun.spawn(['tar','-xzf',${JSON.stringify('/qualify/' + archive)},'-C','/work'],{stdout:'inherit',stderr:'inherit'});
    if(await unpack.exited!==0)throw Error('candidate extraction failed');
    await copyFile('/qualify/bun.lock',cwd+'/bun.lock');
    for(const file of ['worker-linux-probe.ts','worker-containment-catalog.ts','worker-containment-child.ts','worker-containment-parent.ts'])await copyFile('/qualify/'+file,cwd+'/'+file);
    await run(['install','--frozen-lockfile','--ignore-scripts','--silent']);
    ${emulatedSmoke ? "await run(['worker-linux-probe.ts','source']);\n    await run(['build','src/workers/test-support/worker-entry.ts','--target','bun','--minify','--outfile','/qualify/worker-bundle.js']);\n    await run(['worker-linux-probe.ts','bundle']);" : "await run(['test','--timeout','120000','src/workers/process-pool.test.ts','src/workers/bundle.test.ts','src/workers/managed.test.ts','src/workers/torrent-managed.test.ts']);"}
    await run(['build','src/workers/test-support/worker-entry.ts','--compile','--minify','--outfile','/qualify/worker-linux']);
    await run(['worker-linux-probe.ts']);
    await run(['build','worker-containment-child.ts','--compile','--minify','--outfile','/qualify/containment-child']);
    await run(['build','worker-containment-parent.ts','--target','bun','--minify','--outfile','/qualify/containment-parent.js']);
  `);
  // Reusable package downloads are a cache, never synthetic runtime state.
  // Keep them in this external-backed VM instead of repopulating/deleting a
  // complete download cache for every qualification container.
  const cache = 'zero-workers-bun-cache';
  await command(docker(['volume', 'create', '--label', 'dev.storage.project=zero-platform', '--label', 'dev.storage.purpose=worker-package-cache', cache]));
  const cacheLabels = JSON.parse((await command(docker(['volume', 'inspect', cache, '--format', '{{json .Labels}}']))).trim());
  if (cacheLabels['dev.storage.project'] !== 'zero-platform' || cacheLabels['dev.storage.purpose'] !== 'worker-package-cache') throw new Error('Worker cache ownership mismatch.');
  containerStarted = true;
  await command(docker(['run', '--name', name, '--rm', '--init', '--platform', 'linux/amd64',
    ...labels,
    '--memory', '3g', '--cpus', '4', '--pids-limit', '128', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--mount', `type=bind,src=${fixture.root},dst=/qualify`,
    '--mount', `type=volume,src=${cache},dst=/work/cache`,
    '--env', 'ZERO_WORKER_SYNTHETIC_SECRET=parent-only-synthetic',
    '--entrypoint', '/usr/local/bin/bun', image, '--no-env-file', '/qualify/run.ts']), root, 600_000);
  await command(docker(['run', '--name', name + '-containment', '--rm', '--init', '--platform', 'linux/amd64', ...labels,
    '--network', 'none', '--memory', '1g', '--cpus', '1', '--pids-limit', '32', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--mount', `type=bind,src=${fixture.root},dst=/qualify`, '--env', 'TMPDIR=/qualify/tmp',
    '--entrypoint', '/usr/local/bin/bun', image, '--no-env-file', '/qualify/containment-parent.js']), root, 60_000, 137);
  if (!await Bun.file(join(fixture.root, 'containment-entered')).exists()) throw new Error('Container termination did not exercise an entered CPU task.');
  settled = !(await command(docker(['ps', '-aq', '--filter', 'label=dev.storage.run-id=' + runId]))).trim();
  if (!settled) throw new Error('Owned container remained after successful qualification.');
  console.log(JSON.stringify({ result: emulatedSmoke ? 'linux-amd64-explicit-budget-source-bundle-compiled-supervised-death-smoke-passed' : 'linux-amd64-default-budget-matrix-and-supervised-parent-death-passed', archiveSha256: archiveHash,
    startupTimeoutMs: startupBudget, defaultBudgetMatrixPassed: !emulatedSmoke,
    image, imageIdentity: (await command(docker(['image', 'inspect', image, '--format', '{{json .RepoDigests}}']))).trim() }));
} finally {
  if (containerStarted && !settled) {
    for (const owned of [name, name + '-containment']) {
      const ids = (await command(docker(['ps', '-aq', '--filter', 'name=^/' + owned + '$', '--filter', 'label=dev.storage.run-id=' + runId,
        '--filter', 'label=dev.storage.project=zero-platform', '--filter', 'label=dev.storage.disposable=true']))).trim();
      if (ids) await command(docker(['rm', '-f', ids]));
    }
    settled = !(await command(docker(['ps', '-aq', '--filter', 'label=dev.storage.run-id=' + runId]))).trim();
  }
  if (containerStarted && !settled) throw new Error('Owned Linux container retirement unconfirmed; preserving ' + fixture.root);
  // Dependencies, package extraction and scratch databases were inside the
  // now-retired container layer, not random-I/O-heavy host bind mounts.
  await fixture.cleanup();
}

async function command(args: string[], cwd = root, timeoutMs = 180_000, expectedExit = 0) {
  const child = Bun.spawn(args, { cwd, env: process.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const read = async (stream: ReadableStream<Uint8Array>) => {
    let text = ''; const decoder = new TextDecoder();
    for await (const bytes of stream) text = (text + decoder.decode(bytes, { stream: true })).slice(-32_000);
    return text + decoder.decode();
  };
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, read(child.stdout), read(child.stderr)]);
    if (timedOut || code !== expectedExit) throw new Error(`Linux qualification command failed (${code}): ${stdout}\n${stderr}`);
    if (args.includes('run')) console.log((stdout + stderr).slice(-12_000));
    return stdout;
  } finally { clearTimeout(timer); }
}
