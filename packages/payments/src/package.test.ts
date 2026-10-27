/** Fresh framework/plugin archives: no repository aliases, environment credentials or real provider calls. */
import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
const evidenceRoot = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/payments-multi-provider';

test('optional payments and provider-free clients work from fresh installed archives', async () => {
  const root = await mkdtemp(join(scratch, 'payments-package-'));
  const consumer = join(root, 'consumer');
  const core = process.env.ZERO_PAYMENTS_CORE_ARCHIVE ?? join(root, 'framework.tgz');
  const plugin = process.env.ZERO_PAYMENTS_PLUGIN_ARCHIVE ?? join(root, 'payments.tgz');
  try {
    await mkdir(join(consumer, 'app'), { recursive: true });
    if (!process.env.ZERO_PAYMENTS_CORE_ARCHIVE) await command(['pm', 'pack', '--ignore-scripts', '--filename', core], repository);
    if (!process.env.ZERO_PAYMENTS_PLUGIN_ARCHIVE) await command(['pm', 'pack', '--ignore-scripts', '--filename', plugin], join(repository, 'packages/payments'));
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({ name: 'payments-archive-consumer', private: true, type: 'module', dependencies: {
      '@zero/framework': `file:${core}`, '@zero/plugin-payments': `file:${plugin}`, typescript: '^5.9.3', '@types/bun': '1.3.14', '@types/react': '^19.2.14', '@types/react-dom': '^19.2.3', react: '19.2.4', 'react-dom': '19.2.4',
    } }));
    await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, skipLibCheck: true, esModuleInterop: true, jsx: 'react-jsx', types: ['bun'], lib: ['ES2022', 'DOM', 'DOM.Iterable'] }, include: ['consumer.ts'] }));
    await Bun.write(join(consumer, 'consumer.ts'), CONSUMER);
    await Bun.write(join(consumer, 'verify.ts'), VERIFY);
    await Bun.write(join(consumer, 'browser.ts'), BROWSER);
    await command(['install', '--ignore-scripts'], consumer);
    await command(['run', 'node_modules/typescript/bin/tsc', '--noEmit'], consumer);
    const verified = JSON.parse((await command(['verify.ts'], consumer)).trim());
    const frameworkManifest = await Bun.file(join(consumer, 'node_modules/@zero/framework/package.json')).json();
    const pluginManifest = await Bun.file(join(consumer, 'node_modules/@zero/plugin-payments/package.json')).json();
    expect(frameworkManifest).toEqual(await Bun.file(join(repository, 'package.json')).json());
    expect(pluginManifest).toEqual(await Bun.file(join(repository, 'packages/payments/package.json')).json());
    expect(verified.declared).toBe(true); expect(verified.sharedRegistry).toBe(true); expect(verified.disabledSchema).toBe(true); expect(verified.browserClean).toBe(true);
    expect(verified.checkoutPath).toBe('/api/_zero/payments/checkout');
    expect(verified.squareReady).toBe(true); expect(verified.squareCharge).toBe(true);
    for (const [sourceRoot, installedRoot, files] of [
      [repository, join(consumer, 'node_modules/@zero/framework'), ['src/payments/contracts.ts', 'src/payments/client.ts', 'src/payments/registry.ts', 'src/observability/codes.ts', 'src/frontend/client/sdk.ts', 'src/frontend/server/server-services.ts', 'src/frontend/server/server-request-services/create-request-services.ts']],
      [join(repository, 'packages/payments'), join(consumer, 'node_modules/@zero/plugin-payments'), ['src/index.ts', 'src/options.ts', 'src/service.ts', 'src/store.ts', 'src/scoped.ts', 'src/authority.ts', 'src/http.ts', 'src/projections.ts', 'src/execution.ts', 'src/entitlements.ts', 'src/jobs.ts', 'src/validation.ts', 'src/errors.ts', 'src/provider-plugin.ts', 'src/resources.ts', 'src/merchant-input.ts', 'src/stripe-merchant.ts', 'src/square/index.ts', 'src/square/options.ts', 'src/square/service.ts', 'src/square/scoped.ts', 'src/square/merchant.ts', 'src/square/catalog.ts', 'src/square/checkout.ts', 'src/square/models.ts', 'src/square/ownership.ts', 'src/square/reconcile.ts', 'src/square/transport.ts', 'src/square/worker.ts', 'README.md', 'THIRD_PARTY_NOTICES.md']],
    ] as const) for (const file of files) expect(await Bun.file(join(installedRoot, file)).text(), `Fresh archive source mismatch: ${file}`).toBe(await Bun.file(join(sourceRoot, file)).text());
    for (const path of ['index.md', 'configuration.md', 'api.md', 'webhooks.md', 'operations.md', 'roadmap.md', 'square.md', 'merchant-charges.md']) expect(await Bun.file(join(consumer, 'node_modules/@zero/framework/docs-next/plugins/payments', path)).text()).toBe(await Bun.file(join(repository, 'docs-next/plugins/payments', path)).text());
    const sha = async (path: string) => createHash('sha256').update(new Uint8Array(await Bun.file(path).arrayBuffer())).digest('hex');
    await mkdir(evidenceRoot, { recursive: true });
    const source = await sourceIdentity();
    await Bun.write(join(evidenceRoot, 'installed-archive-evidence.json'), JSON.stringify({ sourceSnapshot: source.dirty ? 'dirty' : 'clean', branch: source.branch, baseCommit: source.commit,
      framework: { version: frameworkManifest.version, archive: core, sha256: await sha(core) }, plugin: { version: pluginManifest.version, archive: plugin, sha256: await sha(plugin) },
      ...verified, verifiedAt: new Date().toISOString(), liveProviderOperations: false }, null, 2));
  } finally {
    const started = Date.now(); console.info('Synthetic payments archive stage', { stage: 'cleanup-started' });
    await rm(root, { recursive: true, force: true });
    console.info('Synthetic payments archive stage', { stage: 'cleanup-completed', durationMs: Date.now() - started });
  }
}, 180000);

async function sourceIdentity() {
  const git = async (args: string[]) => {
    const child = Bun.spawn(['git', ...args], { cwd: repository, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code) throw new Error(`Cannot identify the qualified package source: ${stderr}`);
    return stdout.trim();
  };
  return { commit: await git(['rev-parse', 'HEAD']), branch: await git(['branch', '--show-current']), dirty: !!await git(['status', '--porcelain']) };
}

async function command(args: string[], cwd: string): Promise<string> {
  const started = Date.now();
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH, TMPDIR: scratch, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' } });
  const timeout = setTimeout(() => child.kill(), 110000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`Payments archive qualification failed (${code}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally {
    clearTimeout(timeout);
    console.info('Synthetic payments archive stage', { stage: args[0] === 'run' ? 'typecheck' : args[0], durationMs: Date.now() - started });
  }
}
const CONSUMER = `
import { stripePayments, StripePayments, squarePayments, getPayments, getStripePayments, getSquarePayments, type PaymentsOptions, type SquarePaymentsOptions } from '@zero/plugin-payments';
import { squarePayments as squareSubpath } from '@zero/plugin-payments/square';
import { createPaymentsClient } from '@zero/plugin-payments/client';
import { defineEndpoint, defineZeroPlugin } from '@zero/framework/server';
import { getClient } from '@zero/framework/react';
import type { BillingEvent, ScopedPayments, MerchantPayments, MerchantPaymentEvent } from '@zero/framework/payments';
export const config: PaymentsOptions = { mode:'test', connectionId:'fixture', accountId:'acct_fixture', secretKey:'sk_test_fixture', webhookSecrets:['whsec_fixture'], policyVersion:'v1', catalog:{ pro:{label:'Pro',price:'price_pro',kind:'subscription'} }, allowedOrigins:['https://app.test'], successUrl:'https://app.test/billing', cancelUrl:'https://app.test/billing', portalReturnUrl:'https://app.test/billing' };
export const plugin = stripePayments(config);
export const endpoint = defineEndpoint({ method:'POST',path:'/checkout',auth:'user', handler: ({zero}) => zero.payments?.checkout.create({operationId:'stable-checkout-1',offer:'pro'}) });
export const setup = defineZeroPlugin({name:'merchant-integration',setup:({zero})=>{ const owner:StripePayments=getStripePayments(zero); void owner.native.prices; }});
export const browser = () => getClient()?.payments.snapshot();
export const pure = createPaymentsClient({ request: async <T>() => null as T });
export const squareConfig:SquarePaymentsOptions={mode:'test',connectionId:'square-archive',merchantId:'MERCHANT',locationId:'LOCATION',accessToken:'synthetic-access-token',webhookSignatureKeys:['synthetic-signature-key'],webhookNotificationUrl:'https://app.test/api/webhooks/square',catalog:{},policyVersion:'v1',successUrl:'https://app.test/billing',allowedOrigins:['https://app.test']};
export const squarePlugin=squareSubpath(squareConfig);
export const squareSetup=defineZeroPlugin({name:'square-integration',setup:({zero})=>{const owner=getSquarePayments(zero);const charges:MerchantPayments=getPayments(zero).charges;void owner.native.payments;const createLink=()=>charges.checkout({operationId:'custom-payment-1',total:{amount:100,currency:'usd'},description:'Custom work'});void createLink;}});
`;
const BROWSER = `export { createPaymentsClient } from '@zero/plugin-payments/client';`;
const VERIFY = `
import { stripePayments, StripePayments, squarePayments, SquarePayments, getPayments } from '@zero/plugin-payments';
import { createPaymentsClient } from '@zero/plugin-payments/client';
import { ReactiveDB } from '@zero/framework/sync';
import { registerPaymentsBackend, getPaymentsBackend } from '@zero/framework/payments';
import { createApp, defineZeroPlugin } from '@zero/framework/server';
import { createHmac } from 'node:crypto';
const db = new ReactiveDB({mode:'memory',emitTelemetry:false});
const backend={status(){return {}},forAuthority(){return {}}};
const remove=registerPaymentsBackend(db,backend);
let sharedRegistry=getPaymentsBackend(db)===backend; remove();
const disabledSchema=db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '_zero_payments_%'").all().length===0; db.dispose();
let checkoutPath=''; const client=createPaymentsClient({request:async(path)=>{checkoutPath=path;return {}}}); await client.checkout.create({operationId:'stable-checkout-1',offer:'pro'});
const result=await Bun.build({entrypoints:['browser.ts'],target:'browser',write:false}); if(!result.success)throw new Error(String(result.logs));
const text=await result.outputs[0].text(); const browserClean=!/bun:sqlite|sk_test_|STRIPE_SECRET_KEY|SQUARE_ACCESS_TOKEN|stripe-node|StripeResource|SquareClient|registerPaymentsBackend/.test(text);
const options={mode:'test',connectionId:'archive-fixture',accountId:'acct_fixture',secretKey:'sk_test_fixture',webhookSecrets:['whsec_fixture'],policyVersion:'v1',catalog:{},allowedOrigins:['https://app.test'],successUrl:'https://app.test/billing',cancelUrl:'https://app.test/billing',portalReturnUrl:'https://app.test/billing'};
let apiVersion='';
const app=await createApp({db:{mode:'memory'},systemDb:{mode:'file',path:process.cwd()+'/system.db',synchronous:'FULL'},tables:{},auth:false,appDir:process.cwd()+'/app',outDir:process.cwd()+'/out',generatedDir:process.cwd()+'/generated',storageDir:process.cwd()+'/storage',serverPluginsDir:false,serverEndpointsDir:false,serverRoutesDir:false,serverResourcesDir:false,serverMiddlewareDir:false,workflows:false,email:false,ai:false,vector:false,pdf:false,kv:false,stateSync:false,observability:false,serverExtensions:[stripePayments(options),defineZeroPlugin({name:'archive-payment-owner-check',setup:({zero})=>{sharedRegistry=sharedRegistry&&zero.payments instanceof StripePayments&&getPaymentsBackend(zero.db)===zero.payments;apiVersion=zero.payments.status().apiVersion;}})]});
app.listen({hostname:'127.0.0.1',port:0});
let mountedWebhook=false;
try{const payload=JSON.stringify({id:'evt_archive',object:'event',api_version:apiVersion,livemode:false,type:'product.updated',data:{object:{id:'prod_fixture'}}});const timestamp=Math.floor(Date.now()/1000);const signature='t='+timestamp+',v1='+createHmac('sha256','whsec_fixture').update(timestamp+'.'+payload).digest('hex');const response=await fetch('http://127.0.0.1:'+app.server.port+'/api/webhooks/stripe',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature},body:payload});mountedWebhook=response.status===200&&(await response.json()).supported===false;}finally{await app.stop(true);}
if(!mountedWebhook)throw new Error('Fresh archive webhook did not mount/verify');
let squareOwner;
const squareFetch=Object.assign(async(input,init)=>{const request=new Request(input,init),path=new URL(request.url).pathname;const data=request.method==='GET'?{}:await request.json();
if(path==='/v2/merchants/MERCHANT')return Response.json({merchant:{id:'MERCHANT',status:'ACTIVE'}});
if(path==='/v2/locations/LOCATION')return Response.json({location:{id:'LOCATION',merchant_id:'MERCHANT',status:'ACTIVE',currency:'USD',timezone:'UTC'}});
if(path==='/v2/payments')return Response.json({payment:{id:'PAYMENT',location_id:'LOCATION',reference_id:data.reference_id,status:'COMPLETED',amount_money:data.amount_money,total_money:data.amount_money,created_at:new Date().toISOString()}});
throw new Error('Unexpected Square archive endpoint '+path);},{preconnect:fetch.preconnect});
const squareApp=await createApp({db:{mode:'memory'},systemDb:{mode:'file',path:process.cwd()+'/square-system.db',synchronous:'FULL'},tables:{},auth:false,appDir:process.cwd()+'/app',outDir:process.cwd()+'/square-out',generatedDir:process.cwd()+'/square-generated',storageDir:process.cwd()+'/square-storage',serverPluginsDir:false,serverEndpointsDir:false,serverRoutesDir:false,serverResourcesDir:false,serverMiddlewareDir:false,workflows:false,email:false,ai:false,vector:false,pdf:false,kv:false,stateSync:false,observability:false,serverExtensions:[squarePayments({mode:'test',connectionId:'square-archive',merchantId:'MERCHANT',locationId:'LOCATION',accessToken:'synthetic-access-token',webhookSignatureKeys:['synthetic-signature-key'],webhookNotificationUrl:'https://app.test/api/webhooks/square',catalog:{},policyVersion:'v1',successUrl:'https://app.test/billing',allowedOrigins:['https://app.test'],fetch:squareFetch}),defineZeroPlugin({name:'square-archive-owner',setup:({zero})=>{squareOwner=getPayments(zero);}})]});
let squareReady=false,squareCharge=false;
try{squareReady=squareOwner instanceof SquarePayments&&squareOwner.status().provider==='square';const paid=await squareOwner.charges.create({operationId:'square-archive-charge',total:{amount:1750,currency:'usd'},description:'Standalone amount',paymentToken:'cnon:card-nonce-ok'});squareCharge=paid.status==='succeeded'&&paid.total.amount===1750;}finally{await squareApp.stop(true);}
const declared=typeof stripePayments==='function'; console.log(JSON.stringify({declared,sharedRegistry,disabledSchema,browserClean,mountedWebhook,squareReady,squareCharge,checkoutPath,browserBytes:result.outputs[0].size}));
`;
