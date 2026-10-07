/** Prove normal/compiled deployments preserve app entry ownership and need no Markdown/plugin sources. */
import { describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildZeroApp } from './build-app';
import { parseZeroBuildArgs } from './build-args';
import { parseBuildFixtureEntryTime } from '../test-support/build-fixture-readiness';
import sharp from 'sharp';

const repository = resolve(import.meta.dir, '../..');
async function scratch(): Promise<string> { const root = '/Volumes/code-bank/tmp/scratch/zero-platform'; await mkdir(root, { recursive: true }); return mkdtemp(join(root, 'zero-build-deployment-')); }

async function verifyMacCompiledSignature(binary: string, compiled: boolean): Promise<void> {
  if (!compiled || process.platform !== 'darwin') return;
  const verification = Bun.spawn(['/usr/bin/codesign', '--verify', '--strict', binary], { stdout: 'ignore', stderr: 'pipe' });
  expect(await verification.exited).toBe(0);
  expect(await new Response(verification.stderr).text()).toBe('');
}

async function fixture(root: string, avatars = false): Promise<string> {
  await Promise.all([mkdir(join(root, 'app'), { recursive: true }), mkdir(join(root, 'server/plugins'), { recursive: true }), mkdir(join(root, 'node_modules/@zero'), { recursive: true })]);
  await symlink(repository, join(root, 'node_modules/@zero/framework'), 'dir');
  for (const dependency of ['react', 'react-dom']) await symlink(join(repository, 'node_modules', dependency), join(root, 'node_modules', dependency), 'dir');
  await Bun.write(join(root, 'package.json'), JSON.stringify({ name: 'zero-build-fixture', type: 'module' }));
  await Bun.write(join(root, 'reader.css'), '.documentation{color:var(--foreground);background:var(--background)}');
  await Bun.write(join(root, 'enhance.ts'), 'globalThis.__docsFixtureEnhancement = true; globalThis.__docsFixtureLoadTools = () => import("./tools");');
  await Bun.write(join(root, 'tools.ts'), 'export const fixtureTool = "DYNAMIC_TOOL_CHUNK";');
  await Bun.write(join(root, 'attachment.txt'), 'ADMITTED_ATTACHMENT_BYTES');
  await Bun.write(join(root, 'zero.config.ts'), [
    'import { defineZeroConfig } from "@zero/framework/server";',
    'export const customNamedExport = "retained";',
    `export default defineZeroConfig({db:{mode:"ephemeral"},tables:{},auth:${avatars ? '{bootstrap:"public",userProfile:{avatars:{enabled:true,outputSize:64}}}' : 'false'},email:false,ai:false,vector:false,kv:false,pdf:false,workflows:false,storageDir:"./synthetic-avatar-storage",migrate:false,observability:false,serverMiddlewareDir:false,serverEndpointsDir:false,serverRoutesDir:false,serverResourcesDir:false});`,
  ].join('\n'));
  await Bun.write(join(root, 'server/plugins/reader.ts'), [
    'import * as React from "react";',
    'import { defineZeroPlugin, renderServerPage } from "@zero/framework/server";',
    'export default defineZeroPlugin({name:"fixture.reader",build:{identity:"fixture-v1",async prepare(context){',
    ' return { data:{ text:"Compiled documentation survives deployment",private:"PRIVATE_COMPILED_METADATA" },browserEntries:[{name:"reader",path:"./enhance.ts"}],styles:[{name:"reader-style",path:"./reader.css"}],privateAssets:[{name:"attachment",path:"./attachment.txt",contentType:"text/plain"}] };',
    '}},setup(context){',
    ' const built=context.frontend.plugins["fixture.reader"];',
    ' let attachmentAllowed=true;',
    ' function Reader(){const id=React.useId();const [state]=React.useState("hooks-rendered");return React.createElement("article",{className:"documentation","data-hook-state":state,"data-react-id":id},built.data.text);}',
    ' return context.app.get("/docs",({request})=>renderServerPage({component:Reader,props:{},request,appDir:context.appDir,frontend:context.frontend,pluginName:"fixture.reader",rootId:"docs-root",emitCode:context.emitCode})).get("/docs-assets",()=>built.assets).get("/docs/attachment",()=>attachmentAllowed?new Response(Bun.file(context.files.attachment)):new Response("Not found",{status:404})).get("/simulate-revoke",()=>{attachmentAllowed=false;return "revoked";}).onStop(async()=>{await Bun.sleep(20);const result=context.zero.sql.raw.query("select 1 as alive").get();await Bun.write("./plugin-stopped.txt",String(result.alive));});',
    '}});',
  ].join('\n'));
  await Bun.write(join(root, 'app/server.ts'), [
    'import { createApp } from "@zero/framework/server";',
    'import config,{customNamedExport} from "../zero.config";',
    'import {publishBuildFixtureMarker} from "./fixture-readiness";',
    'await publishBuildFixtureMarker("./startup-entry.txt",String(Date.now()));',
    'await publishBuildFixtureMarker("./startup-phase.txt","entry-evaluated");',
    'const app=await createApp(config);',
    'await publishBuildFixtureMarker("./startup-phase.txt","app-created");',
    'app.get("/entry-hook",()=>({custom:customNamedExport}));',
    'app.listen(0);',
    'await publishBuildFixtureMarker("./ready-port.txt",String(app.server.port));',
  ].join('\n'));
  // This fixture-owned helper is bundled with the app, never loaded from the
  // repository after relocation or mistaken for a public framework dependency.
  await Bun.write(join(root, 'app/fixture-readiness.ts'), Bun.file(join(repository, 'src/test-support/build-fixture-readiness.ts')));
  return join(root, 'zero.config.ts');
}

async function running<T>(command: readonly string[], cwd: string, verify: (url: string) => Promise<T>): Promise<T> {
  const started = Date.now();
  const child = Bun.spawn([...command], { cwd, env: { PATH: Bun.env.PATH ?? '', TMPDIR: Bun.env.TMPDIR, NODE_ENV: 'production' }, stdout: 'pipe', stderr: 'pipe' });
  const stdout = new Response(child.stdout).text(); const stderr = new Response(child.stderr).text();
  const admissionMs = command.length === 1 ? 60_000 : 20_000;
  const evidence = { pid: child.pid, command, startedAt: started, admissionMs, appStartupMs: 20_000 };
  let entryStartedAt: number | undefined, entryMarker: string | undefined;
  try {
    await Bun.write(join(cwd, 'startup-parent.json'), JSON.stringify(evidence, null, 2));
    while (!(await Bun.file(join(cwd, 'ready-port.txt')).exists())) {
      if (child.exitCode !== null) throw new Error(`Built server exited ${child.exitCode}: ${await stderr}\n${await stdout}`);
      if (entryStartedAt === undefined && await Bun.file(join(cwd, 'startup-entry.txt')).exists()) {
        entryMarker = await Bun.file(join(cwd, 'startup-entry.txt')).text();
        entryStartedAt = parseBuildFixtureEntryTime(entryMarker, started, Date.now());
      }
      // macOS cold executables can remain in _dyld_start before Bun even loads
      // (qualified by a process sample). Bound that admission separately; app
      // startup still has a strict 20s deadline after the entry evaluates.
      const deadline = entryStartedAt === undefined ? started + admissionMs : entryStartedAt + 20_000;
      if (Date.now() > deadline) {
        child.kill('SIGKILL');
        await child.exited;
        const phase = await Bun.file(join(cwd, 'startup-phase.txt')).text().catch(() => 'phase-marker-unpublished');
        throw new Error(`Built server did not report its listening port (pid=${child.pid}, startedAt=${started}, phase=${phase}): ${await stderr}\n${await stdout}`);
      }
      await Bun.sleep(25);
    }
    const port = await Bun.file(join(cwd, 'ready-port.txt')).text();
    const entryAt = parseBuildFixtureEntryTime(await Bun.file(join(cwd, 'startup-entry.txt')).text(), started, Date.now());
    if (entryAt === undefined) throw new Error('Built server reported readiness without a valid current entry marker.');
    console.info('Synthetic build readiness', { pid: child.pid, startedAt: started, mode: command.length === 1 ? 'compiled' : 'javascript', beforeEntryMs: entryAt - started, appStartupMs: Date.now() - entryAt });
    return await verify(`http://127.0.0.1:${port}`);
  } catch (error) {
    await Bun.write(join(cwd, 'startup-failure.json'), JSON.stringify({ ...evidence, failedAt: Date.now(),
      exitCode: child.exitCode, signal: child.signalCode, entryMarker: entryMarker ?? null, admittedEntryAt: entryStartedAt ?? null,
      phase: await Bun.file(join(cwd, 'startup-phase.txt')).text().catch(() => null) }, null, 2));
    throw error;
  } finally {
    child.kill('SIGTERM');
    await Promise.race([child.exited, Bun.sleep(3_000).then(() => child.kill('SIGKILL'))]);
    await child.exited;
  }
}

describe('Zero build arguments', () => {
  test('supports normal config/entry/output and optional self-contained executable mode', () => {
    expect(parseZeroBuildArgs([])).toEqual({ configPath: './zero.config.ts', help: false, compile: false, entryPath: undefined, outDir: undefined, outfile: undefined });
    expect(parseZeroBuildArgs(['--config', '/app/zero.config.ts', '--entry', 'app/server.ts', '--outdir', 'dist', '--compile', '--outfile', 'api']).compile).toBe(true);
    expect(() => parseZeroBuildArgs(['--config'])).toThrow('Missing'); expect(() => parseZeroBuildArgs(['--config', 'a', '--config', 'b'])).toThrow('Duplicate'); expect(() => parseZeroBuildArgs(['--outfile', 'api'])).toThrow('requires --compile'); expect(() => parseZeroBuildArgs(['--arbitrary'])).toThrow('Unknown');
  });
});

describe('normal declared app deployment', () => {
  for (const compile of [false, true]) {
    test(`${compile ? 'compiled executable' : 'server bundle'} serves docs and public assets without app/plugin/node_modules sources`, async () => {
      const root = await scratch();
      const source = join(root, 'source'); const deployment = join(root, 'deployment');
      let verified = false;
      try {
        const configPath = await fixture(source);
        const result = await buildZeroApp({ configPath, compile });
        await verifyMacCompiledSignature(result.serverPath, compile);
        expect(result.pluginCount).toBe(1); expect(result.publicAssetCount).toBeGreaterThanOrEqual(4);
        if (!compile) await running([process.execPath, result.serverPath], source, async (url) => {
          // A compiled plugin must not switch dispatchers merely because the
          // consuming app still has a physical React installation available.
          const response = await fetch(`${url}/docs`); expect(response.status).toBe(200);
          expect(await response.text()).toContain('data-hook-state="hooks-rendered"');
        });
        await cp(dirname(result.serverPath), deployment, { recursive: true });
        // Disabled auth/avatars do not load the optional native processor.
        // The payload is required only for real avatar decoding.
        await rm(join(deployment, 'zero-native'), { recursive: true, force: true });
        // Deployment receives only build output; source remains elsewhere and is
        // renamed so any accidental absolute runtime source access also fails.
        const movedSource = join(root, 'source-unavailable');
        await (await import('node:fs/promises')).rename(source, movedSource);
        const entry = join(deployment, compile ? 'server' : 'server.js');
        await running(compile ? [entry] : [process.execPath, entry], deployment, async (url) => {
          const docs = await fetch(`${url}/docs`); const html = await docs.text();
          expect(docs.status).toBe(200); expect(html).toContain('Compiled documentation survives deployment'); expect(html).toContain('<div id="docs-root"><article'); expect(html).not.toContain('PRIVATE_COMPILED_METADATA');
          expect(html).toContain('data-hook-state="hooks-rendered"'); expect(html).toContain('data-react-id=');
          expect(await fetch(`${url}/entry-hook`).then((response) => response.json())).toEqual({ custom: 'retained' });
          const assets = await fetch(`${url}/docs-assets`).then((response) => response.json()) as Record<string, { publicPath: string }>;
          for (const asset of Object.values(assets)) { const response = await fetch(`${url}${asset.publicPath}`); expect(response.status).toBe(200); expect((await response.text()).length).toBeGreaterThan(0); }
          const script = await fetch(`${url}${assets.reader!.publicPath}`).then((response) => response.text());
          const dynamic = /import\(["']([^"']+)["']\)/.exec(script)?.[1]; expect(dynamic).toBeDefined();
          const chunk = await fetch(new URL(dynamic!, `${url}${assets.reader!.publicPath}`)); expect(chunk.status).toBe(200); expect(await chunk.text()).toContain('DYNAMIC_TOOL_CHUNK');
          const missingPrivate = await fetch(`${url}/_build/frontend-build.json`); expect(missingPrivate.status).toBe(404);
          expect(await fetch(`${url}/docs/attachment`).then((response) => response.text())).toBe('ADMITTED_ATTACHMENT_BYTES');
          await fetch(`${url}/simulate-revoke`); expect((await fetch(`${url}/docs/attachment`)).status).toBe(404);
          expect((await fetch(`${url}/_build/attachment.txt`)).status).toBe(404);
        });
        expect(await Bun.file(join(deployment, 'plugin-stopped.txt')).text()).toBe('1');
        await verifyMacCompiledSignature(entry, compile);
        if (compile) {
          // A second clean process/cwd exercises cold embedded-file startup,
          // rather than accepting a single warm executable launch.
          const coldDeployment = join(root, 'cold-deployment');
          await cp(join(movedSource, 'dist'), coldDeployment, { recursive: true });
          await running([join(coldDeployment, 'server')], coldDeployment, async (url) => {
            expect((await fetch(`${url}/docs`)).status).toBe(200);
            expect(await fetch(`${url}/docs/attachment`).then((response) => response.text())).toBe('ADMITTED_ATTACHMENT_BYTES');
          });
          expect(await Bun.file(join(coldDeployment, 'plugin-stopped.txt')).text()).toBe('1');
        }
        verified = true;
      } finally {
        if (verified) await rm(root, { recursive: true, force: true });
        else console.info('Failed synthetic deployment retained for diagnostics', root);
      }
    }, 180_000);
  }
  for (const compile of [false, true]) {
    test(`${compile ? 'compiled executable' : 'server bundle'} retains real enabled avatar decoding after relocation`, async () => {
      const root = await scratch(), source = join(root, 'source'), deployment = join(root, 'deployment');
      let verified = false;
      try {
        const configPath = await fixture(source, true);
        const result = await buildZeroApp({ configPath, compile });
        await verifyMacCompiledSignature(result.serverPath, compile);
        await cp(dirname(result.serverPath), deployment, { recursive: true });
        await (await import('node:fs/promises')).rename(source, join(root, 'source-unavailable'));
        expect(await Bun.file(join(deployment, 'node_modules/package.json')).exists()).toBe(false);
        const entry = join(deployment, compile ? 'server' : 'server.js');
        await running(compile ? [entry] : [process.execPath, '--no-env-file', entry], deployment, async url => {
          const register = await fetch(`${url}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'compiled-avatar', email: 'compiled-avatar@example.test', password: 'password123', firstName: 'Avatar' }) });
          expect(register.status).toBe(200);
          const session = await register.json() as { accessToken: string };
          const headers = { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' };
          const before = await fetch(`${url}/auth/profile/avatar`, { headers }).then(response => response.json()) as { revision: number; capabilities: { state: string } };
          expect(before.capabilities.state).toBe('ready');
          const allocated = await fetch(`${url}/auth/profile/avatar/stages`, { method: 'POST', headers, body: JSON.stringify({ expectedRevision: before.revision }) });
          expect(allocated.status).toBe(200);
          const stage = await allocated.json() as { id: string; receipt: string; upload: { token: string } };
          const png = await sharp({ create: { width: 80, height: 70, channels: 3, background: '#223355' } }).png().toBuffer();
          const uploaded = await fetch(`${url}/storage/upload-grants/${encodeURIComponent(stage.upload.token)}`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: Uint8Array.from(png) });
          expect(uploaded.status).toBe(201);
          const finalized = await fetch(`${url}/auth/profile/avatar/stages/${stage.id}/finalize`, { method: 'POST', headers, body: JSON.stringify({ receipt: stage.receipt }) });
          expect(finalized.status).toBe(200);
          const accepted = await finalized.json() as { revision: number; asset: { deliveryPath: string; width: number; height: number; mimeType: string } };
          expect(accepted).toMatchObject({ revision: before.revision + 1, asset: { width: 64, height: 64, mimeType: 'image/webp' } });
          const delivered = await fetch(new URL(accepted.asset.deliveryPath, url), { headers });
          expect(delivered.status).toBe(200);
          expect(delivered.headers.get('cache-control')).toContain('no-store');
          expect(delivered.headers.get('content-type')).toBe('image/webp');
          const metadata = await sharp(new Uint8Array(await delivered.arrayBuffer())).metadata();
          expect(metadata).toMatchObject({ format: 'webp', width: 64, height: 64 });
          expect((await fetch(`${url}/_build/zero-native/LICENSE-sharp`)).status).toBe(404);
        });
        await verifyMacCompiledSignature(entry, compile);
        verified = true;
      } finally {
        if (verified) await rm(root, { recursive: true, force: true });
        else console.info('Failed synthetic avatar deployment retained for diagnostics', root);
      }
    }, 180_000);
  }
  test('a default-root file-page app still routes copied sources after deployment relocation', async () => {
    const root = await scratch();
    const source = join(root, 'source'); const deployment = join(root, 'deployment');
    try {
      const configPath = await fixture(source);
      await mkdir(join(source, 'app/view'), { recursive: true });
      await Bun.write(join(source, 'app/view/page.ts'), 'import {useId,createElement} from "react";export default function Page(){const id=useId();return createElement("p",{id},"Relocated application page");}');
      const result = await buildZeroApp({ configPath });
      await cp(dirname(result.serverPath), deployment, { recursive: true });
      await cp(join(source, 'app'), join(deployment, 'app'), { recursive: true });
      await mkdir(join(deployment, 'node_modules'), { recursive: true });
      for (const dependency of ['react', 'react-dom']) await symlink(join(repository, 'node_modules', dependency), join(deployment, 'node_modules', dependency), 'dir');
      await (await import('node:fs/promises')).rename(source, join(root, 'source-unavailable'));
      await running([process.execPath, join(deployment, 'server.js')], deployment, async (url) => {
        const response = await fetch(`${url}/view`);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('Relocated application page');
        expect((await fetch(`${url}/docs`)).status).toBe(200);
      });
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 90_000);
});
