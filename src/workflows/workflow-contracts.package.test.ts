/** Fresh installed-package proof for public workflow authoring/actor starts, drawer SSR/CSS and the actual documentation snippets. */
import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const repository = new URL('../../', import.meta.url).pathname;
const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
const evidence = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/workflow-contracts';

test('workflow contracts and drawers work through an installed archive without private imports or repository aliases', async () => {
  const root = await mkdtemp(join(scratch, 'workflow-contract-package-')), consumer = join(root, 'consumer');
  const archive = process.env.ZERO_WORKFLOW_CONTRACTS_ARCHIVE ?? join(root, 'zero-framework.tgz');
  try {
    await mkdir(join(consumer, 'app'), { recursive: true });
    if (!process.env.ZERO_WORKFLOW_CONTRACTS_ARCHIVE) await command(['pm', 'pack', '--ignore-scripts', '--filename', archive], repository);
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({ name: 'workflow-contract-package-consumer', private: true, type: 'module', dependencies: {
      '@zero/framework': `file:${archive}`, typescript: '^5.9.3', '@types/bun': '1.3.14', '@types/react': '^19.2.14', '@types/react-dom': '^19.2.3', react: '19.2.4', 'react-dom': '19.2.4',
    } }));
    await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true,
      skipLibCheck: true, esModuleInterop: true, jsx: 'react-jsx', types: ['bun'], lib: ['ES2022', 'DOM', 'DOM.Iterable'] }, include: ['*.ts', '*.tsx'] }));
    await Bun.write(join(consumer, 'verify.tsx'), VERIFY);
    await Bun.write(join(consumer, 'browser.ts'), "export { DrawerManager, DrawerWorkspace, ControlledDrawer, useDrawers, drawers } from '@zero/framework/drawers';");
    for (const [index, path] of ['docs-next/backend/torrent/definition-authoring.md', 'docs-next/frontend/drawers/index.md'].entries()) {
      const text = await Bun.file(join(repository, path)).text();
      for (const [snippet, match] of [...text.matchAll(/```(?:ts|tsx)\n([\s\S]*?)\n```/g)].entries()) await Bun.write(join(consumer, `docs-${index}-${snippet}.tsx`), match[1]!);
    }
    await command(['install', '--ignore-scripts'], consumer);
    await command(['run', 'node_modules/typescript/bin/tsc', '--noEmit'], consumer);
    const verified = JSON.parse((await command(['verify.tsx'], consumer)).trim());
    expect(verified.aliases).toBe(true); expect(verified.ssr).toBe(true); expect(verified.browserClean).toBe(true); expect(verified.css).toBe(true);
    expect(verified.managedStart).toBe(true); expect(verified.nativeRoutesAbsent).toBe(true);
    for (const file of ['src/workflows/workflow-definition-authoring.ts', 'src/workflows/workflow-actor-start-contract.ts', 'src/workflows/workflow-expression.ts',
      'src/workflows/workflow-idempotent-start-coordinator.ts', 'src/workflows/workflow-start-receipt-store.ts', 'src/modals/drawer-workspace.tsx', 'src/modals/drawer-shell.css',
      'src/modals/modal-manager.tsx', 'src/migrations/definitions/044_workflow_actor_start_receipts.ts',
      'docs-next/backend/torrent/definition-authoring.md', 'docs-next/backend/torrent/actor-starts.md', 'docs-next/frontend/drawers/index.md']) {
      expect(await Bun.file(join(consumer, 'node_modules/@zero/framework', file)).text(), file).toBe(await Bun.file(join(repository, file)).text());
    }
    const git = async (args: string[]) => {
      const child = Bun.spawn(['git', ...args], { cwd: repository, stdout: 'pipe', stderr: 'pipe' });
      const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]); if (code) throw new Error('Cannot identify source'); return text.trim();
    };
    await mkdir(evidence, { recursive: true });
    await Bun.write(join(evidence, 'installed-archive-evidence.json'), JSON.stringify({ commit: await git(['rev-parse', 'HEAD']), dirty: !!await git(['status', '--porcelain']),
      archive, sha256: createHash('sha256').update(new Uint8Array(await Bun.file(archive).arrayBuffer())).digest('hex'), ...verified,
      verifiedAt: new Date().toISOString(), liveProviderOperations: false }, null, 2));
  } finally { await rm(root, { recursive: true, force: true }); }
}, 240000);

async function command(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: {
    PATH: process.env.PATH, TMPDIR: scratch, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache',
  } });
  const timer = setTimeout(() => child.kill(), 150000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code) throw new Error(`Installed workflow contract check failed (${code}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally { clearTimeout(timer); }
}

const VERIFY = `
import { DrawerWorkspace, DrawerManager, ControlledDrawer, drawers } from '@zero/framework/drawers';
import { DrawerWorkspace as RootWorkspace, drawers as rootDrawers } from '@zero/framework';
import { DrawerWorkspace as ReactWorkspace } from '@zero/framework/react';
import { expr, type WorkflowActorStartOptions, type WorkflowDefinitionAuthoring, type WorkflowGraphIR } from '@zero/framework/workflows';
import { createApp, defineEndpoint } from '@zero/framework/server';
import { renderToString } from 'react-dom/server';
const aliases = DrawerWorkspace === RootWorkspace && DrawerWorkspace === ReactWorkspace && drawers === rootDrawers;
const html = renderToString(<DrawerWorkspace><p>Canvas</p><ControlledDrawer open={false} descriptor={{title:'Closed'}} onOpenChange={()=>{throw new Error('No SSR callbacks')}}/></DrawerWorkspace>);
const ssr = html.includes('Canvas') && !html.includes('role="dialog"');
const built = await Bun.build({entrypoints:['browser.ts'],target:'browser'});
if(!built.success)throw new Error(String(built.logs));
const js=(await Promise.all(built.outputs.filter(f=>f.type.includes('javascript')).map(f=>f.text()))).join('');
const browserClean=!!js&&!/bun:sqlite|class WorkflowDefinitionVersionStore|function workflowActorStartPrincipal|node:crypto|_workflow_actor_start_receipts/.test(js);
const css=(await Promise.all(built.outputs.filter(f=>f.type.includes('css')).map(f=>f.text()))).join('').includes('.zero-modal--drawer');
const graph:WorkflowGraphIR={schemaVersion:1,entry:'a',metadata:{dependencies:[{build:'immutable-build-one'}]},nodes:[
{id:'a',kind:'activity',activity:{name:'fixture.a',version:'1'}},
{id:'b',kind:'activity',activity:{name:'fixture.b',version:'1'},input:expr.object({email:expr.output('a',['email']),enabled:false})}
],edges:[{id:'ab',from:'a',to:'b'}]};
const options:WorkflowActorStartOptions={idempotencyKey:'installed:one',version:1,binding:{caller:'admitted-caller'}};
const app=await createApp({db:{mode:'memory'},systemDb:{mode:'memory'},tables:{},auth:{bootstrap:'public',registration:{mode:'admin-only'}},
workflows:{http:false,register(registry){registry.registerActivity({name:'fixture.a',version:'1',databaseCallable:true,handler:async()=>({email:'synthetic@example.test'})});registry.registerActivity({name:'fixture.b',version:'1',databaseCallable:true,handler:async({input})=>input});}},
serverExtensions:[defineEndpoint({method:'POST',path:'/api/example/workflows',auth:'user',handler:async({zero})=>{
const author:WorkflowDefinitionAuthoring=zero.workflows!.definitions;
const draft=author.createDraft({name:'installed-chain',graph});author.publishDraft(draft.draft.draft_id,{expectedRevision:1});
const ack=await zero.workflows!.startOnce('installed-chain',{},options);
const replay=await zero.workflows!.startOnce('installed-chain',{},options);
return{same:ack.instanceId===replay.instanceId,receipt:zero.workflows!.getStartReceipt(options.idempotencyKey),instance:zero.workflows!.get(ack.instanceId)};
}})],appDir:process.cwd()+'/app',outDir:process.cwd()+'/out',generatedDir:process.cwd()+'/generated',storageDir:process.cwd()+'/storage',serverPluginsDir:false,serverResourcesDir:false,serverRoutesDir:false,serverEndpointsDir:false,serverMiddlewareDir:false,stateSync:false,email:false,ai:false,vector:false,pdf:false,kv:false,observability:{console:false,endpoint:false}});
let managedStart=false,nativeRoutesAbsent=false;
try{app.listen({hostname:'127.0.0.1',port:0});const origin='http://127.0.0.1:'+app.server!.port;
const registration=await fetch(origin+'/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'archive-owner',email:'archive-owner@example.test',password:'Synthetic-only-password-123'})});if(registration.status!==200)throw new Error('Archive bootstrap failed');
const user=await registration.json() as {accessToken:string};const headers={Authorization:'Bearer '+user.accessToken};
const response=await fetch(origin+'/api/example/workflows',{method:'POST',headers});const body=await response.json() as any;
managedStart=response.status===200&&body.same&&body.receipt.instanceId===body.instance.instance_id&&JSON.parse(body.instance.output).email==='synthetic@example.test'&&!!body.instance.started_by;
nativeRoutesAbsent=(await fetch(origin+'/workflows',{headers})).status===404;
}finally{await app.stop(true);}
if(!managedStart||!nativeRoutesAbsent)throw new Error('Installed managed workflow contracts failed');
console.log(JSON.stringify({aliases,ssr,browserClean,css,managedStart,nativeRoutesAbsent,browserBytes:js.length}));
`;
