/** Qualifies Data Studio/Storage editor public imports in an isolated freshly installed archive consumer. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const DIAGNOSTICS = '/Volumes/code-bank/artifacts/zero-platform/diagnostics';

test('packed Data Studio and Storage editors retain public exports, browser modules and SSR-safe rendering', async () => {
  await mkdir(SCRATCH, { recursive: true });
  await mkdir(DIAGNOSTICS, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'studio-storage-package-'));
  const artifact = await mkdtemp(join(DIAGNOSTICS, 'studio-storage-package-'));
  const consumer = join(root, 'consumer'), archive = join(artifact, 'framework.tgz');
  try {
    await mkdir(consumer);
    const commit = (await checked(['git', 'rev-parse', 'HEAD'], process.cwd())).trim();
    const dirty = (await checked(['git', 'status', '--porcelain'], process.cwd())).trim() !== '';
    await bun(['pm', 'pack', '--ignore-scripts', '--filename', archive], process.cwd());
    const hash = new Bun.CryptoHasher('sha256').update(await Bun.file(archive).arrayBuffer()).digest('hex');
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({
      name: 'zero-studio-storage-public-consumer', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4' },
    }));
    await Bun.write(join(consumer, 'consumer.tsx'), CONSUMER);
    await Bun.write(join(consumer, 'verify.ts'), VERIFY);
    await bun(['install', '--ignore-scripts'], consumer);
    const result = JSON.parse((await bun(['verify.ts'], consumer)).trim()) as {
      version: string; identityCount: number; browserBytes: number; runtimeModules: number;
      html: string; iso: string; calendar: string; noDom: boolean;
    };
    expect(result.identityCount).toBe(6);
    expect(result.runtimeModules).toBe(10);
    expect(result.browserBytes).toBeGreaterThan(0);
    expect(result.noDom).toBe(true);
    expect(result.iso).toBe('2026-02-03T17:45:37.123Z');
    expect(result.calendar).toBe('2026-02-03');
    expect(result.html).toContain('data-slot="data-studio-grid"');
    expect(result.html).toContain('Package meeting');
    expect(result.html).toContain('data-slot="data-studio-inline-cell"');
    expect(result.html).toContain('aria-label="Drive visibility"');
    expect(result.html).toContain('Current grants');
    expect(result.html).toContain('Add object grant');
    expect(result.html).not.toContain('window is not defined');
    expect(result.html).not.toContain('colSpan="NaN"');
    expect(result.html).not.toMatch(/<input[^>]*\stype="(?:date|time|datetime-local)"/);
    const provenance = { success: true, version: result.version, sourceCommit: commit, uncommittedCandidate: dirty,
      archive, sha256: hash, artifact, exports: result.identityCount, runtimeModules: result.runtimeModules,
      browserBytes: result.browserBytes, verifiedAt: new Date().toISOString() };
    await Bun.write(join(artifact, 'provenance.json'), JSON.stringify(provenance, null, 2));
    await Bun.write(join(artifact, 'ssr.html'), result.html);
    console.info('[zero-editor-package]', JSON.stringify(provenance));
  } finally {
    // Only this test's freshly allocated consumer is disposable; the exact
    // qualified archive/provenance is retained in the external diagnostics root.
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

const ENV = { PATH: process.env.PATH, TMPDIR: SCRATCH, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' };

async function bun(arguments_: string[], cwd: string): Promise<string> {
  return checked([process.execPath, '--no-env-file', ...arguments_], cwd);
}

async function checked(command: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe', env: ENV });
  let expired = false;
  const timeout = setTimeout(() => { expired = true; child.kill(); }, 90_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (expired || code !== 0) throw new Error(`Editor package consumer failed (${expired ? 'timeout' : code}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally { clearTimeout(timeout); }
}

const CONSUMER = `
import * as React from 'react';
import * as Root from '@zero/framework';
import * as ReactParts from '@zero/framework/react';
import * as Studio from '@zero/framework/components/data-studio';
import * as Storage from '@zero/framework/components/storage';
const studioNames = ['DataStudioGrid','DataStudioInlineCell','DataStudioFilterControl'] as const;
const storageNames = ['StorageDrivePermissionsPanel','StorageDriveSettingsPanel','StorageObjectPermissionsPanel'] as const;
for (const name of studioNames) if (typeof Studio[name] !== 'function' || Studio[name] !== Root[name] || Studio[name] !== ReactParts[name])
  throw new Error('Public Data Studio export identity failed: ' + name);
for (const name of storageNames) if (typeof Storage[name] !== 'function' || Storage[name] !== Root[name] || Storage[name] !== ReactParts[name])
  throw new Error('Public Storage export identity failed: ' + name);
if (typeof Studio.DataStudioRowDialog !== 'function' || typeof Studio.parseDataStudioValueDraft !== 'function')
  throw new Error('Missing public Data Studio dialog or value parser.');
export const identityCount = studioNames.length + storageNames.length;
const meeting = {columnId:'meeting',key:'meeting',label:'Package meeting',type:'datetime',required:false} as const;
const table = {tableId:'package-table',key:'package_records',name:'Package records',description:'Synthetic packaged editor proof.',
  status:'active',schema:{version:1,columns:[meeting]},schemaRevision:1,revision:1,rowCount:0,createdAt:1,updatedAt:1} as const;
const drive = {id:'package-drive',name:'Package drive',max_size_bytes:0,max_file_size_bytes:0,allowed_mime_types:'*',public:'0',owner_id:null};
const file = {id:'package-file',driveId:drive.id,name:'package.txt',path:'package.txt',type:'file',mimeType:'text/plain',sizeBytes:0,
  checksum:null,isPublic:false,metadata:{},createdBy:null,createdAt:1,updatedAt:1} as const;
const access = {effectiveAccess:'admin',canRead:true,canWrite:true,canAdmin:true,isOwner:false,isPlatformAdmin:false,isPublic:false} as const;
export const parsedIso = Studio.parseDataStudioValueDraft('2026-02-03T12:45:37.123-05:00', meeting);
export const parsedCalendar = Studio.parseDataStudioValueDraft('2026-02-03', {...meeting,type:'date'});
export function Consumer() {
  return <main>
    <Studio.DataStudioRowDialog open={false} table={table} scopeKey="package-scope" onOpenChange={()=>undefined} onCreate={async()=>({})}/>
    <Studio.DataStudioGrid table={table} rows={[]} selectedRowId={null} editable onSelectRow={()=>undefined}
      onCommit={async()=>undefined} onReload={async()=>undefined}/>
    <Studio.DataStudioInlineCell value="2026-02-03T17:45:37.123Z" column={meeting} revision={1} onCommit={async()=>undefined}/>
    <Studio.DataStudioInlineCell value={{status:'draft'}} column={{columnId:'metadata',key:'metadata',label:'Package JSON',type:'json',required:false}} revision={1} onCommit={async()=>undefined}/>
    <Studio.DataStudioFilterControl columns={[meeting]} filters={[]} onChange={()=>undefined}/>
    <Storage.StorageDriveSettingsPanel drive={drive} onSave={async()=>undefined}/>
    <Storage.StorageDrivePermissionsPanel driveId={drive.id} canAdmin/>
    <Storage.StorageObjectPermissionsPanel driveId={drive.id} file={file} access={access}/>
  </main>;
}
`;

const VERIFY = `
import * as React from 'react';
import {renderToString} from 'react-dom/server';
import packageJson from '@zero/framework/package.json';
import {Consumer,identityCount,parsedIso,parsedCalendar} from './consumer';
const modules = [
  'src/components/data-studio/data-studio-row-field.tsx',
  'src/components/data-studio/data-studio-row-draft.ts',
  'src/components/data-studio/use-data-studio-row-dialog.ts',
  'src/components/data-studio/data-studio-temporal-input.tsx',
  'src/components/data-studio/data-studio-temporal-value.ts',
  'src/components/data-studio/data-studio-temporal-cell-editor.tsx',
  'src/components/data-studio/data-studio-cell-editor.tsx',
  'src/components/data-studio/data-studio-json-cell-editor.tsx',
  'src/components/data-studio/data-studio-cell-state-indicator.tsx',
  'src/components/storage/storage-permission-list.tsx',
];
const packageDirectory = new URL('.',import.meta.resolve('@zero/framework/package.json'));
for (const path of modules) if (!await Bun.file(new URL(path,packageDirectory)).exists()) throw new Error('Archive omitted runtime module: '+path);
const built = await Bun.build({entrypoints:['./consumer.tsx'],target:'browser',format:'esm',minify:false});
if(!built.success)throw new Error(built.logs.map(log=>log.message).join('\\n'));
const html = renderToString(React.createElement(Consumer));
console.log(JSON.stringify({version:packageJson.version,identityCount,browserBytes:built.outputs.reduce((sum,item)=>sum+item.size,0),
  runtimeModules:modules.length,html,iso:parsedIso,calendar:parsedCalendar,noDom:typeof window==='undefined'&&typeof document==='undefined'}));
`;
