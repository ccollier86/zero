/** Packed, independently installed public worker entries. Never selects the saved release or boots a real app. */
import { expect, test } from 'bun:test';
import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ownedWorkerFixture } from './test-support/owned-fixture';

test('an independently installed candidate archive executes public source and minified worker entries', async () => {
  const fixture = await ownedWorkerFixture('package'), packed = join(fixture.root, 'packed'), extracted = join(fixture.root, 'extracted');
  let dependencies: { path: string; dev: number; ino: number; marker: string } | undefined, safeToClean = true;
  const run = async (cmd: string[], cwd: string) => {
    const child = Bun.spawn(cmd, { cwd, env: { ...process.env, TMPDIR: fixture.root }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; safeToClean = false; child.kill('SIGKILL'); }, 120_000);
    // Bounded diagnostics; no complete successful install/test environment is retained.
    const tail = async (stream: ReadableStream<Uint8Array>) => {
      let result = ''; const decoder = new TextDecoder();
      for await (const chunk of stream) result = (result + decoder.decode(chunk, { stream: true })).slice(-24_000);
      return result + decoder.decode();
    };
    try {
      const [stdout, stderr, code] = await Promise.all([tail(child.stdout), tail(child.stderr), child.exited]);
      if (timedOut || code !== 0) throw new Error(`Packed worker command failed (${code}): ${stdout}\n${stderr}`);
      return stdout;
    } finally { clearTimeout(timer); }
  };
  try {
    await mkdir(packed); await mkdir(extracted);
    await run([process.execPath, '--no-env-file', 'pm', 'pack', '--ignore-scripts', '--quiet', '--destination', packed], process.cwd());
    const archives = (await readdir(packed)).filter(name => name.endsWith('.tgz'));
    expect(archives).toHaveLength(1);
    await run(['tar', '-xzf', join(packed, archives[0]!), '-C', extracted], fixture.root);
    const installed = join(extracted, 'package');
    await copyFile(join(process.cwd(), 'bun.lock'), join(installed, 'bun.lock'));
    const path = join(installed, 'node_modules'); await mkdir(path);
    const identity = await lstat(path), marker = crypto.randomUUID();
    dependencies = { path, dev: identity.dev, ino: identity.ino, marker };
    await writeFile(join(path, '.zero-worker-package-owner'), marker, { flag: 'wx', mode: 0o600 });
    await run([process.execPath, '--no-env-file', 'install', '--frozen-lockfile', '--ignore-scripts', '--silent'], installed);
    await writeFile(join(installed, 'worker-package-catalog.ts'), `
      import { defineWorkerTask } from '@zero/framework/workers/tasks';
      export const total = defineWorkerTask({ name:'package.total',version:'1',
        parseInput(v){if(!Array.isArray(v)||v.some(n=>typeof n!=='number'))throw Error('numbers');return v as number[];},
        parseOutput(v){if(typeof v!=='number'||!Number.isFinite(v))throw Error('finite');return v;},
        run: values=>values.reduce((a,b)=>a+b,0) });
      export const tasks=[total];
    `);
    await writeFile(join(installed, 'worker-package-child.ts'), `
      import {runWorkerIfRequested} from '@zero/framework/workers/actor';
      import {tasks} from './worker-package-catalog';
      if(!await runWorkerIfRequested({tasks}))process.exitCode=64;
    `);
    await writeFile(join(installed, 'worker-package-probe.ts'), `
      import {ProcessWorkPool} from '@zero/framework/workers';
      import {total,tasks} from './worker-package-catalog';
      const source=new URL('./worker-package-child.ts',import.meta.url).pathname;
      const bundled=new URL('./worker-package-child.js',import.meta.url).pathname;
      const built=await Bun.build({entrypoints:[source],target:'bun',minify:true,metafile:true,naming:'worker-package-child.js',outdir:import.meta.dir});
      if(!built.success)throw Error('child build failed');
      const meta=typeof built.metafile==='string'?JSON.parse(built.metafile):built.metafile;
      if(Object.keys(meta.inputs).some(p=>/frontend\\/server\\/app-factory|\\/ai\\/ai-service|node_modules\\/(react|react-dom)\\//.test(p)))throw Error('unexpected app import');
      for(const entrypoint of [source,bundled]){
        const owner=new ProcessWorkPool({tasks,launch:{kind:'source',entrypoint},processes:2});
        try{const results:number[]=await Promise.all([owner.run(total,[12,25,8]),owner.run(total,[1,2,3])]);
          if(JSON.stringify(results)!=='[45,6]')throw Error('incorrect public result');
        }finally{await owner.close();}
        if(owner.status().processes!==0)throw Error('owned processes retained');
      }
      console.log('PACKED_WORKERS_OK');
    `);
    expect(await run([process.execPath, '--no-env-file', 'worker-package-probe.ts'], installed)).toContain('PACKED_WORKERS_OK');
  } finally {
    if (!safeToClean) throw new Error('Timed-out package parent cannot prove child settlement; preserving owned fixture ' + fixture.root);
    if (dependencies) {
      const current = await lstat(dependencies.path);
      if (current.isSymbolicLink() || current.dev !== dependencies.dev || current.ino !== dependencies.ino
        || await readFile(join(dependencies.path, '.zero-worker-package-owner'), 'utf8') !== dependencies.marker) {
        throw new Error('Package dependency ownership changed; preserving ' + fixture.root);
      }
      // Package-manager symlinks/hardlinks are confined to this freshly owned tree.
      await rm(dependencies.path, { recursive: true });
    }
    await fixture.cleanup();
  }
}, 300_000);
