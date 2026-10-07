/** Actual package archives, public imports and the normal build CLI; no source aliases or live app data. */
import { expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, rename } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const repository = resolve(import.meta.dir, '../..');
const scratchRoot = '/Volumes/code-bank/tmp/scratch/zero-platform';
const artifactRoot = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/docs-plugin';
const image = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=='), character => character.charCodeAt(0));
interface DocsPackageManifest { version: string; peerDependencies: { '@zero/framework': string } }

test('docs preview manifest requires the framework release containing shared keyboard hints', async () => {
  const manifest = await Bun.file(join(repository, 'packages/docs/package.json')).json() as DocsPackageManifest;
  expect(manifest.version).toBe('0.1.1');
  expect(manifest.peerDependencies['@zero/framework']).toBe('>=2.6.0 <3');
});

async function command(cmd: readonly string[], cwd: string, maximum = 60_000, environment?: Record<string, string | undefined>, captureStderr = false): Promise<string> {
  const child = Bun.spawn([...cmd], { cwd, env: environment, stdout: 'pipe', stderr: 'pipe' });
  const out = new Response(child.stdout).text(), error = new Response(child.stderr).text();
  const timeout = setTimeout(() => child.kill('SIGKILL'), maximum);
  try { const code = await child.exited; const [stdout, stderr] = await Promise.all([out, error]); if (code !== 0) throw new Error(`Synthetic package command failed (${code}): ${stderr.slice(-8_000)}\n${stdout.slice(-2_000)}`); return captureStderr ? stdout + '\n' + stderr : stdout; }
  finally { clearTimeout(timeout); }
}
async function write(root: string, name: string, contents: string | Uint8Array): Promise<void> {
  const path = join(root, name), folder = path.slice(0, path.lastIndexOf('/')); await mkdir(folder, { recursive: true }); await Bun.write(path, contents);
}
function configModule(kind: 'default' | 'named'): string {
  return ['import {defineZeroConfig} from "@zero/framework/server";', 'export const retainedNamedExport="retained-package-entry";',
    'const selected=defineZeroConfig({app:{name:"Installed Zero Reader",publicUrl:"https://docs.example.test"},db:{mode:"ephemeral"},tables:{},auth:false,email:false,migrate:false,observability:false,ai:false,vector:false,kv:false,serverMiddlewareDir:false,serverEndpointsDir:false,serverRoutesDir:false,serverResourcesDir:false});',
    kind === 'default' ? 'export default selected; export const config=selected; export const appConfig=selected;' : 'export const zeroConfig=selected; export const appConfig=selected; export default "the named object is deliberately authoritative";',
  ].join('\n');
}
function serverEntry(kind: 'default' | 'named'): string {
  return ['import {createApp} from "@zero/framework/server";', kind === 'default'
    ? 'import selected,{config as alternate,appConfig,retainedNamedExport} from "../zero.config";'
    : 'import {zeroConfig as selected,appConfig as alternate,retainedNamedExport} from "../named.config";',
    'await Bun.write("./entry-started.txt","entered");',
    'const app=await createApp(selected);',
    'app.get("/entry-hook",()=>({retained:retainedNamedExport,same:alternate===selected,compiled:Boolean(selected.frontendBuild)}));',
    'app.listen({port:0,hostname:"127.0.0.1"});',
    'await Bun.write("./ready-port.txt",String(app.server.port));',
    'console.log(JSON.stringify({kind:"ready",url:`http://127.0.0.1:${app.server.port}`}));',
  ].join('\n');
}
async function createConsumer(root: string, framework: string, docs: string): Promise<void> {
  await write(root, 'package.json', JSON.stringify({ name: 'zero-docs-installed-qualification', private: true, type: 'module',
    dependencies: { '@zero/framework': 'file:' + framework, '@zero/plugin-docs': 'file:' + docs, react: '19.2.4', 'react-dom': '19.2.4' },
    overrides: { '@zero/framework': 'file:' + framework } }));
  await command(['bun', '--no-env-file', 'install', '--ignore-scripts'], root);
  await write(root, 'zero.config.ts', configModule('default')); await write(root, 'named.config.ts', configModule('named'));
  await write(root, 'app/server.ts', serverEntry('default')); await write(root, 'app/custom-server.ts', serverEntry('named'));
  await write(root, 'server/plugins/docs.ts', 'import {docs} from "@zero/plugin-docs"; export default docs({contentDir:"./documentation",watch:false,headerLinks:[{label:"Entry",href:"/entry-hook"}]});');
  await write(root, 'server/plugins/drain.ts', [
    'import {defineZeroPlugin} from "@zero/framework/server";',
    'export default defineZeroPlugin({name:"installed.docs.drain",setup(context){context.app.onStop(async()=>{await Bun.sleep(30);const value=context.zero.sql.raw.query("select 1 as alive").get();await Bun.write("./extension-drained.json",JSON.stringify({alive:value.alive,awaited:true}));});}});',
  ].join('\n'));
  await write(root, 'documentation/index.md', '# Installed reader\n\nThis is public documentation served from the actual package.\n\n## Setup\n\n[Guide](guides/start.md#details) ![Pixel](assets/pixel.png)\n\n```ts filename="app.ts" showLineNumbers {1}\nconst installed = true;\n```\n\n:::tip[Production]\nNo source folder is required after the build.\n:::\n');
  await write(root, 'documentation/guides/start.md', '# Start\n\n## Details\n\nPublic package integration details.');
  await write(root, 'documentation/assets/pixel.png', image);
  await write(root, 'documentation/private.md', '---\nvisibility: private\n---\n# PRIVATE_INSTALLED_SOURCE_SENTINEL');
  await write(root, 'documentation/_work/note.md', '# PRIVATE_INSTALLED_WORK_SENTINEL');
  await write(root, 'public-imports.ts', [
    'import {docs} from "@zero/plugin-docs"; import {compileDocsContent,DocsContentError} from "@zero/plugin-docs/content";',
    'import {DocsApp} from "@zero/plugin-docs/react"; import {defineZeroPlugin,prepareAppBuild,renderServerPage,isReservedAppRoutePath} from "@zero/framework/server";',
    'import {CodeBlock,CodeBlockRoot,CodeBlockFiles,CodeBlockInline,Kbd,KbdGroup} from "@zero/framework/react"; import {prepareCodeBlock} from "@zero/framework/components/code-block/server";',
    'import {Kbd as FocusedKbd,KbdGroup as FocusedKbdGroup} from "@zero/framework/components/kbd"; import {createElement} from "react"; import {renderToStaticMarkup} from "react-dom/server";',
    'import {readCodeBlockMetadata} from "@zero/framework/components/code-block/metadata";',
    'if([docs,compileDocsContent,DocsContentError,DocsApp,defineZeroPlugin,prepareAppBuild,renderServerPage,isReservedAppRoutePath,CodeBlock,CodeBlockRoot,CodeBlockFiles,CodeBlockInline,Kbd,KbdGroup,prepareCodeBlock,readCodeBlockMetadata].some(value=>value===undefined)) throw new Error("Public package export is missing");',
    'if(Kbd!==FocusedKbd||KbdGroup!==FocusedKbdGroup) throw new Error("Keyboard hints must share the public framework facade");',
    'const keyboardHtml=renderToStaticMarkup(createElement(KbdGroup,null,createElement(Kbd,null,"Ctrl"),createElement(Kbd,null,"K")));',
    'if(!keyboardHtml.includes("data-slot=\\\"kbd-group\\\"")||!keyboardHtml.includes("data-slot=\\\"kbd\\\"")) throw new Error("Public keyboard hints failed SSR");',
    'console.log(JSON.stringify({publicImports:true,keyboardHints:true,claim:docs({contentDir:"./documentation"}).build.mountPaths}));',
  ].join('\n'));
}
async function startDeployment(directory: string, compiled: boolean) {
  const child = Bun.spawn(compiled ? [join(directory, 'reader')] : ['bun', '--no-env-file', join(directory, 'server.js')], {
    cwd: directory, env: { PATH: Bun.env.PATH ?? '', NODE_ENV: 'production' }, stdout: 'pipe', stderr: 'pipe' });
  const stdout = new Response(child.stdout).text(), stderr = new Response(child.stderr).text();
  const started = performance.now(); let enteredAt: number | undefined;
  while (!(await Bun.file(join(directory, 'ready-port.txt')).exists())) {
    if (child.exitCode !== null) throw new Error(`Installed deployment failed: ${(await stderr).slice(-8_000)}\n${(await stdout).slice(-2_000)}`);
    if (enteredAt === undefined && await Bun.file(join(directory, 'entry-started.txt')).exists()) enteredAt = performance.now();
    if (enteredAt !== undefined ? performance.now() - enteredAt > 20_000 : performance.now() - started > (compiled ? 60_000 : 25_000)) {
      child.kill('SIGKILL'); await child.exited;
      throw new Error(`Installed docs deployment readiness failed (${enteredAt === undefined ? 'host admission before app entry' : 'app startup'}): ${(await stderr).slice(-4_000)}\n${(await stdout).slice(-1_000)}`);
    }
    await Bun.sleep(25);
  }
  const url = 'http://127.0.0.1:' + (await Bun.file(join(directory, 'ready-port.txt')).text()).trim();
  return { url, async stop() {
    child.kill('SIGTERM'); const timeout = setTimeout(() => child.kill('SIGKILL'), 4_000); await child.exited; clearTimeout(timeout);
    return { exitCode: child.exitCode, stdout: await stdout, stderr: await stderr };
  } };
}
async function verifyDeployment(url: string) {
  const response = await fetch(url + '/docs'), html = await response.text();
  expect(response.status).toBe(200); expect(html).toContain('<div id="zero-docs-root">'); expect(html).toContain('Installed reader'); expect(html).toContain('Installed Zero Reader Documentation');
  expect(html).toContain('data-slot="kbd"');
  expect(html).not.toContain('PRIVATE_INSTALLED_SOURCE_SENTINEL'); expect(html).not.toContain('PRIVATE_INSTALLED_WORK_SENTINEL'); expect(html).not.toContain('Restoring your secure session');
  expect(response.headers.get('content-security-policy')).toContain("script-src 'self' 'nonce-"); expect(response.headers.get('link')).toBe('<https://docs.example.test/docs>; rel="canonical"');
  const head = await fetch(url + '/docs', { method: 'HEAD' }); expect(head.status).toBe(200); expect(await head.text()).toBe('');
  expect(await (await fetch(url + '/entry-hook')).json()).toEqual({ retained: 'retained-package-entry', same: true, compiled: true });
  const search = await (await fetch(url + '/docs/_api/search?q=Details')).json(); expect(search.results.some((result: { route: string }) => result.route === '/docs/guides/start#details')).toBe(true);
  const markdown = await (await fetch(url + '/docs/_api/markdown?path=/docs')).text(); expect(markdown).toContain('/docs/guides/start#details'); expect(markdown).toContain('/docs/_assets/'); expect(markdown).not.toContain('guides/start.md');
  const index = await (await fetch(url + '/docs/_api/manifest')).json(); expect(index.pages.every((page: { body?: unknown }) => page.body === undefined)).toBe(true); expect(JSON.stringify(index)).not.toContain('PRIVATE_INSTALLED');
  expect((await fetch(url + '/docs/private')).status).toBe(404); expect((await fetch(url + '/docs/_api/markdown?path=/docs/private')).status).toBe(404);
  const assetRoute = /<img[^>]+src="([^"]+\/_assets\/[^"]+)"/u.exec(html)?.[1]; expect(assetRoute).toBeDefined();
  const asset = await fetch(url + assetRoute); expect(asset.status).toBe(200); expect(asset.headers.get('content-type')).toBe('image/png'); expect(new Uint8Array(await asset.arrayBuffer())).toEqual(image);
  const publicUrls = [...html.matchAll(/(?:src|href)="(\/_build\/[^" ]+)"/gu)].map(match => match[1]!);
  expect(publicUrls.length).toBeGreaterThanOrEqual(3);
  for (const path of new Set(publicUrls)) { const result = await fetch(url + path); expect(result.status).toBe(200); const body = await result.text(); expect(body.length).toBeGreaterThan(0); expect(body).not.toContain('PRIVATE_INSTALLED'); }
  expect((await fetch(url + '/_build/frontend-build.json')).status).toBe(404); expect((await fetch(url + '/_build/documentation/private.md')).status).toBe(404);
  const sitemap = await (await fetch(url + '/docs/sitemap.xml')).text(); expect(sitemap).toContain('https://docs.example.test/docs/guides/start'); expect(sitemap).not.toContain('PRIVATE_INSTALLED');
  return { publicUrls: [...new Set(publicUrls)], assetRoute };
}

test('fresh framework/docs archives qualify public imports and normal/compiled source-free deployments', async () => {
  await Promise.all([mkdir(scratchRoot, { recursive: true }), mkdir(artifactRoot, { recursive: true })]);
  const work = await mkdtemp(join(scratchRoot, 'docs-installed-')), evidence = await mkdtemp(join(artifactRoot, 'installed-'));
  const sourceVersion = (await Bun.file(join(repository, 'package.json')).json()).version as string;
  const sourceDocs = await Bun.file(join(repository, 'packages/docs/package.json')).json() as DocsPackageManifest;
  const frameworkArchive = join(evidence, `zero-framework-${sourceVersion}.tgz`), docsArchive = join(evidence, `zero-plugin-docs-${sourceDocs.version}.tgz`);
  await command(['bun', 'pm', 'pack', '--ignore-scripts', '--quiet', '--filename', frameworkArchive], repository);
  await command(['bun', 'pm', 'pack', '--ignore-scripts', '--quiet', '--filename', docsArchive], join(repository, 'packages/docs'));
  const packedFramework = JSON.parse(await command(['tar', '-xOf', frameworkArchive, 'package/package.json'], repository)) as { version: string };
  expect(packedFramework.version).toBe(sourceVersion);
  const packedDocs = JSON.parse(await command(['tar', '-xOf', docsArchive, 'package/package.json'], repository)) as DocsPackageManifest;
  expect(packedDocs.version).toBe(sourceDocs.version);
  expect(packedDocs.peerDependencies['@zero/framework']).toBe(sourceDocs.peerDependencies['@zero/framework']);
  expect(packedDocs.peerDependencies['@zero/framework']).toBe('>=2.6.0 <3');
  const files = await command(['tar', '-tzf', docsArchive], repository); expect(files).not.toMatch(/\.test\.|test-fixture|docs-next|planning\//u);
  const frameworkFiles = new Set((await command(['tar', '-tzf', frameworkArchive], repository)).trim().split('\n'));
  for (const obsolete of ['components/animate/code.tsx', 'components/animate/code-tabs.tsx', 'primitives/animate/code-block.tsx']) {
    expect(frameworkFiles.has('package/src/' + obsolete)).toBe(false);
  }
  const consumer = join(work, 'consumer'); await createConsumer(consumer, frameworkArchive, docsArchive);
  expect(await Bun.file(join(consumer, 'tsconfig.json')).exists()).toBe(false);
  expect(JSON.parse(await Bun.file(join(consumer, 'node_modules/@zero/framework/package.json')).text()).version).toBe(packedFramework.version);
  const installedDocs = await Bun.file(join(consumer, 'node_modules/@zero/plugin-docs/package.json')).json() as DocsPackageManifest;
  expect(installedDocs.version).toBe(packedDocs.version);
  expect(installedDocs.peerDependencies['@zero/framework']).toBe(packedDocs.peerDependencies['@zero/framework']);
  const imports = JSON.parse(await command(['bun', '--no-env-file', 'run', './public-imports.ts'], consumer)); expect(imports).toEqual({ publicImports: true, keyboardHints: true, claim: ['/docs'] });
  const cli = join(consumer, 'node_modules/@zero/framework/src/cli/run.ts');
  await command(['bun', '--no-env-file', cli, 'build', '--outdir', 'dist-normal'], consumer, 90_000);
  await command(['bun', '--no-env-file', cli, 'build', '--config', './named.config.ts', '--entry', './app/custom-server.ts', '--outdir', 'dist-compiled', '--compile', '--outfile', 'reader'], consumer, 90_000);
  // A copied JS deployment can legitimately retain its app dependencies. Its components and renderer
  // still must use the build's SINGLE bundled React identity, not a second physical dependency copy.
  const installedTree = await startDeployment(join(consumer, 'dist-normal'), false);
  try { await verifyDeployment(installedTree.url); } finally { await installedTree.stop(); }
  expect(JSON.parse(await Bun.file(join(consumer, 'dist-normal/extension-drained.json')).text())).toEqual({ alive: 1, awaited: true });
  const normal = join(evidence, 'normal'), compiled = join(evidence, 'compiled');
  const copy = { recursive: true, filter: (path: string) => !['ready-port.txt', 'entry-started.txt', 'extension-drained.json'].includes(basename(path)) };
  await cp(join(consumer, 'dist-normal'), normal, copy); await cp(join(consumer, 'dist-compiled'), compiled, copy);
  await rename(consumer, join(work, 'source-not-available'));
  const provenance: Record<string, unknown> = { sourceHead: (await command(['git', 'rev-parse', 'HEAD'], repository)).trim(), branch: (await command(['git', 'branch', '--show-current'], repository)).trim(),
    sourceSnapshot: (await command(['git', 'status', '--porcelain', '--untracked-files=all'], repository)).trim() ? 'dirty' : 'clean',
    bun: Bun.version, registryPublished: false, framework: { version: packedFramework.version, path: frameworkArchive, sha256: new Bun.CryptoHasher('sha256').update(await Bun.file(frameworkArchive).arrayBuffer()).digest('hex') },
    docs: { version: packedDocs.version, frameworkPeer: packedDocs.peerDependencies['@zero/framework'], path: docsArchive, sha256: new Bun.CryptoHasher('sha256').update(await Bun.file(docsArchive).arrayBuffer()).digest('hex') }, work, normal, compiled, deployments: [] };
  for (const [directory, executable] of [[normal, false], [compiled, true]] as const) {
    expect(await Bun.file(join(directory, 'node_modules/package.json')).exists()).toBe(false); expect(await Bun.file(join(directory, 'documentation/index.md')).exists()).toBe(false);
    const server = await startDeployment(directory, executable);
    try {
      (provenance.deployments as unknown[]).push({ directory, executable, url: server.url, ...(await verifyDeployment(server.url)) });
      if (executable) {
        // HTTP/SSR success does not prove emitted split JavaScript can hydrate. Qualify the actual archive.
        const browser = await command(['bun', '--no-env-file', 'test', join(repository, 'packages/docs/package-browser.integration.test.ts')], repository, 120_000,
          { ...Bun.env, ZERO_DOCS_INSTALLED_BROWSER_URL: server.url + '/docs' }, true);
        await Bun.write(join(evidence, 'compiled-browser.log'), browser);
        provenance.compiledBrowser = { passed: true, log: join(evidence, 'compiled-browser.log') };
      }
    }
    finally { const stopped = await server.stop(); expect(stopped.stderr).not.toContain('PRIVATE_INSTALLED'); }
    expect(JSON.parse(await Bun.file(join(directory, 'extension-drained.json')).text())).toEqual({ alive: 1, awaited: true });
  }
  await Bun.write(join(evidence, 'provenance.json'), JSON.stringify(provenance, null, 2));
  console.log(JSON.stringify({ docsInstalledEvidence: evidence, compiled, work }));
}, 300_000);
