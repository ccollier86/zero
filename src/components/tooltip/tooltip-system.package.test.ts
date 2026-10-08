/** Fresh installed/archive and source-copy tooltip qualification; no app config, live data or publication. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, test } from 'bun:test';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const ARTIFACTS = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/tooltip-system';
test('packed tooltip provider/group contracts browser-build, SSR and copy through the actual public CLI', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'tooltip-package-'));
  const consumer = join(root, 'consumer'), archive = join(root, 'framework.tgz');
  try {
    await mkdir(consumer);
    await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], process.cwd());
    const sha256 = createHash('sha256').update(new Uint8Array(await Bun.file(archive).arrayBuffer())).digest('hex');
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({ name: 'zero-tooltip-public-consumer', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4',
        '@types/bun': 'latest', '@types/react': '^19.2.14', '@types/react-dom': '^19.2.3', typescript: '^5.7.0' } }));
    await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext',
      moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, esModuleInterop: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: ['bun'], paths: { '@/*': ['./*'] } }, include: ['consumer.tsx', 'copied-consumer.tsx'] }));
    await Bun.write(join(consumer, 'consumer.tsx'), CONSUMER);
    await Bun.write(join(consumer, 'verify.ts'), VERIFY);
    await Bun.write(join(consumer, 'zero.config.ts'), "throw new Error('SYNTHETIC_CONFIG_MUST_NOT_EXECUTE');\n");
    await checked(['install', '--ignore-scripts'], consumer);
    const result = JSON.parse((await checked(['verify.ts'], consumer)).trim()) as { exports: number; bytes: number; html: string; version: string; grow: number };
    expect(result.exports).toBe(6); expect(result.bytes).toBeGreaterThan(0); expect(result.grow).toBe(400);
    expect(result.html).toContain('Package tooltip'); expect(result.html).toContain('Package grouped tooltip');
    expect(result.html).not.toContain('window is not defined');
    expect(await Bun.file(join(consumer, 'node_modules/@zero/framework/src/frontend/styles/tooltip-tokens.css')).exists()).toBe(true);
    expect(await Bun.file(join(consumer, 'node_modules/@zero/framework/docs-next/frontend/components/overlays/tooltip.md')).exists()).toBe(true);
    await checked(['run', 'node_modules/@zero/framework/src/cli/run.ts', 'add', 'components/tooltip', '--target', consumer], consumer);
    await Bun.write(join(consumer, 'copied-consumer.tsx'), COPIED_CONSUMER);
    const copied = await checked(['build', 'copied-consumer.tsx', '--target', 'browser', '--outdir', 'copied-dist'], consumer);
    expect(copied).not.toContain('error:');
    await checked(['run', 'node_modules/typescript/bin/tsc', '--noEmit'], consumer);
    await mkdir(ARTIFACTS, { recursive: true });
    await Bun.write(join(ARTIFACTS, 'package-consumer-evidence.json'), JSON.stringify({ version: result.version,
      commit: '59cb76dc12d18a9428a616b08509cae1eecdf74d', snapshot: 'dirty', sha256,
      scope: 'fresh installed archive and source copy; not published', publicExports: result.exports,
      browserBytes: result.bytes, copiedBrowserBuild: true, consumerTypecheck: true, configTripwireNotExecuted: true,
      date: '2026-10-08' }, null, 2));
  } finally {
    // Only this exact newly allocated synthetic consumer/archive tree is disposable.
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);

/** Disable lifecycle scripts and automatic env files in isolated package subprocesses. */
async function checked(arguments_: string[], cwd: string) {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...arguments_], { cwd, stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH, TMPDIR: SCRATCH, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' } });
  let expired = false; const timer = setTimeout(() => { expired = true; child.kill(); }, 110_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (expired || code !== 0) throw new Error('Tooltip package consumer failed (' + (expired ? 'timeout' : code) + '):\n' + stdout + '\n' + stderr);
    return stdout;
  } finally { clearTimeout(timer); }
}

const CONSUMER = `
import * as React from 'react';
import * as Parts from '@zero/framework/components/tooltip';
import type { TooltipProps, TooltipContentProps, TooltipProviderProps, TooltipGroupProps, TooltipMotionOptions } from '@zero/framework/components/tooltip';
const names = ['TooltipProvider', 'TooltipGroup', 'Tooltip', 'TooltipTrigger', 'TooltipContent', 'resolveTooltipMotion'] as const;
for (const name of names) if (typeof Parts[name] !== 'function') throw new Error('Missing tooltip export: ' + name);
for (const name of ['TOOLTIP_MOTION_DEFAULTS', 'TOOLTIP_MOTION_TIMINGS', 'TOOLTIP_MOTION_EASING', 'TOOLTIP_MOTION_GEOMETRY'] as const)
  if (!Parts[name]) throw new Error('Missing tooltip token export: ' + name);
export const exportCount = names.length;
export const settings: TooltipMotionOptions = { motion: 'grow', durationMultiplier: 1, arrow: true, variant: 'neutral' };
export const provider: TooltipProviderProps = { ...settings, children: null, delayDuration: 450, skipDelayDuration: 450, closeDelay: 70 };
export const group: TooltipGroupProps = { ...settings, children: null };
export const tooltip: TooltipProps = { ...settings, followCursor: 'x', overflowOnly: true };
export const content: TooltipContentProps = { title: <span>Rich title</span>, description: 'Synthetic description', shortcut: ['⌘', 'K'], side: 'right', arrow: false };
export function Consumer() {
  return <Parts.TooltipProvider {...provider}><Parts.Tooltip><Parts.TooltipTrigger asChild><button>Package tooltip</button></Parts.TooltipTrigger>
    <Parts.TooltipContent>Package hint</Parts.TooltipContent></Parts.Tooltip>
    <Parts.TooltipGroup><Parts.Tooltip><Parts.TooltipTrigger asChild><button>Package grouped tooltip</button></Parts.TooltipTrigger>
      <Parts.TooltipContent title="Package rich title" shortcut="G" /></Parts.Tooltip></Parts.TooltipGroup></Parts.TooltipProvider>;
}
`;
const VERIFY = `
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { resolveTooltipMotion } from '@zero/framework/components/tooltip';
import { Consumer, exportCount } from './consumer';
import manifest from '@zero/framework/package.json';
const build = await Bun.build({ entrypoints: ['./consumer.tsx'], target: 'browser', format: 'esm' });
if (!build.success) throw new Error(build.logs.map(log => log.message).join('\\n'));
console.log(JSON.stringify({ exports: exportCount, bytes: build.outputs.reduce((sum, output) => sum + output.size, 0),
  html: renderToString(React.createElement(Consumer)), version: manifest.version, grow: resolveTooltipMotion(null).timings.growEnter }));
`;
const COPIED_CONSUMER = `
import * as React from 'react';
import { TooltipProvider, TooltipGroup, Tooltip, TooltipTrigger, TooltipContent, resolveTooltipMotion } from './components/tooltip';
export { resolveTooltipMotion };
export function CopiedHints() { return <TooltipGroup><Tooltip motion="spring" arrow={false}><TooltipTrigger asChild><button>Copied hint</button></TooltipTrigger>
  <TooltipContent title="Copied title" shortcut={["⌘", "K"]} /></Tooltip></TooltipGroup>; }
export const CopiedProvider = TooltipProvider;
`;
