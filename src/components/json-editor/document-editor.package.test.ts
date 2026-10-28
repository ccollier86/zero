/** Fresh packed consumer proves file codecs are production dependencies and all editor APIs/CSS ship without replacing the old editor. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, expect, test } from 'bun:test';

const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
const consumers = new Set<string>();
// Retire every owned consumer before this file exits, but do not mistake
// recursive dependency-tree cleanup for the facade's 120s functional limit.
// Hook failure still fails the file and the runner retains its resource slot.
afterAll(async () => { for (const directory of consumers) { await removeConsumer(directory); consumers.delete(directory); } }, 120_000);
/** Retry Bun/macOS's transient recursive-removal EFAULT only; all other cleanup failures remain failures. */
async function removeConsumer(directory: string) {
  for (let attempt = 0; ; attempt++) {
    try { await rm(directory, { recursive: true, force: true }); return; }
    catch (error) {
      if (attempt >= 2 || (error as { code?: string }).code !== 'EFAULT') throw error;
      await Bun.sleep(1);
    }
  }
}
async function checked(args: string[], cwd: string) {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', timeout: 90_000,
    env: { PATH: process.env.PATH, TMPDIR: scratch, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' } });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`Document package qualification failed (${code}): ${stdout}\n${stderr}`);
  return stdout;
}
test('packed document facade installs, server-renders and browser-builds all four formats with only production dependencies', async () => {
  await mkdir(scratch, { recursive: true }); const root = await mkdtemp(join(scratch, 'document-package-'));
  consumers.add(root);
  const consumer = join(root, 'consumer'), archive = join(root, 'framework.tgz'); await mkdir(consumer);
  await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], new URL('../../../', import.meta.url).pathname);
  await Bun.write(join(consumer, 'package.json'), JSON.stringify({ name: 'zero-document-source-qualification', private: true, type: 'module',
    dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4' } }));
  await Bun.write(join(consumer, 'consumer.tsx'), `
import * as React from 'react';
import {DocumentEditor, JsonDocumentEditor, JsonEditor, parseDocumentSource} from '@zero/framework/components/json-editor';
import {DocumentEditor as ReactEditor} from '@zero/framework/react';
import {DocumentEditor as RootEditor} from '@zero/framework';
export const identities = DocumentEditor === ReactEditor && DocumentEditor === RootEditor;
export function Consumer() { return <><DocumentEditor format="yaml" sourceText={"# comment\\nname: Zero\\n"}/><DocumentEditor format="toml" sourceText={'name="Zero"\\n'}/><DocumentEditor format="env" sourceText="NAME=Zero"/><JsonDocumentEditor value={{old: true}} onChange={()=>{}}/><JsonEditor value={{original: true}} onChange={()=>{}}/></>; }
export const parsed = ['yaml','toml','env'].map((format,i)=>parseDocumentSource(['name: Zero','name="Zero"','NAME=Zero'][i],format as 'yaml'|'toml'|'env'));
`);
  await Bun.write(join(consumer, 'verify.ts'), `
import * as React from 'react'; import {renderToString} from 'react-dom/server'; import {Consumer,identities,parsed} from './consumer';
const bundle=await Bun.build({entrypoints:['./consumer.tsx'],target:'browser',format:'esm'});
if(!bundle.success)throw new Error(bundle.logs.map(log=>log.message).join('\\n'));
const styles=await Promise.all(bundle.outputs.filter(output=>output.path.endsWith('.css')).map(output=>output.text()));
console.log(JSON.stringify({identities,parsed,html:renderToString(React.createElement(Consumer)),css:styles.join('\\n').includes('zero-document-format-pill'),bytes:bundle.outputs.reduce((sum,output)=>sum+output.size,0)}));
`);
  await checked(['install', '--production', '--ignore-scripts'], consumer);
  const result = JSON.parse((await checked(['verify.ts'], consumer)).trim()) as { identities: boolean; parsed: { ok: boolean }[]; html: string; css: boolean; bytes: number };
  expect(result.identities).toBe(true); expect(result.parsed.map(result => result.ok)).toEqual([true, true, true]); expect(result.css).toBe(true); expect(result.bytes).toBeGreaterThan(0);
  expect(result.html).toContain('data-format="yaml"'); expect(result.html).toContain('data-format="toml"'); expect(result.html).toContain('data-format="env"'); expect(result.html).toContain('original');
}, 120_000);
