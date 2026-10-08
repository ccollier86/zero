/** Fresh archive consumer proof; no app config evaluation, services, live databases, or publication. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, test } from 'bun:test';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const ARTIFACTS = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/modal-system';

test('packed modal/DenseList contracts, source-copy facade and source-only Doctor qualify in a fresh consumer', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'modal-package-'));
  const consumer = join(root, 'consumer'), archive = join(root, 'framework.tgz');
  try {
    await mkdir(join(consumer, 'app'), { recursive: true });
    await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], process.cwd());
    const sha256 = createHash('sha256').update(new Uint8Array(await Bun.file(archive).arrayBuffer())).digest('hex');
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({ name: 'zero-modal-public-consumer', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4',
        '@types/bun': 'latest', '@types/react': '^19.2.14', '@types/react-dom': '^19.2.3', typescript: '^5.7.0' } }));
    await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext',
      moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, esModuleInterop: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: ['bun'], paths: { '@/*': ['./*'] } },
      include: ['consumer.tsx', 'copied-consumer.tsx'] }));
    await Bun.write(join(consumer, 'consumer.tsx'), CONSUMER);
    await Bun.write(join(consumer, 'verify.ts'), VERIFY);
    // Deliberate tripwire: neither the public source-only API nor CLI may execute it.
    await Bun.write(join(consumer, 'zero.config.ts'), "throw new Error('SYNTHETIC_CONFIG_MUST_NOT_EXECUTE');\n");
    await Bun.write(join(consumer, 'app/modal-usage.tsx'), USAGE);
    await checked(['install', '--ignore-scripts'], consumer);
    const output = await checked(['verify.ts'], consumer);
    const result = JSON.parse(output.trim()) as { exports: number; browserBytes: number; html: string; version: string;
      installed: string; modalShow: boolean; sourceOnly: boolean; scannedFiles: number; codes: string[] };
    expect(result.exports).toBe(12); expect(result.browserBytes).toBeGreaterThan(0);
    expect(result.html).toContain('Package preferences'); expect(result.html).toContain('Package member');
    expect(result.html).toContain('type="button"'); expect(result.html).not.toContain('role="listbox"');
    expect(result.installed).toBe('installed'); expect(result.modalShow).toBe(true); expect(result.sourceOnly).toBe(true);
    expect(result.scannedFiles).toBe(1); expect(result.codes).not.toContain('usage.source.package_unknown');
    expect(await Bun.file(join(consumer, 'node_modules/@zero/framework/src/modals/modal-shell.css')).exists()).toBe(true);
    expect(await Bun.file(join(consumer, 'node_modules/@zero/framework/src/frontend/styles/modal-tokens.css')).exists()).toBe(true);
    expect(await Bun.file(join(consumer, 'node_modules/@zero/framework/src/components/dense-list/dense-list.css')).exists()).toBe(true);
    for (const guide of ['layouts', 'motion', 'forms', 'workflow-progress', 'migration', 'prompt']) {
      expect(await Bun.file(join(consumer, `node_modules/@zero/framework/docs-next/frontend/modals/${guide}.md`)).exists()).toBe(true);
    }
    await checked(['run', 'node_modules/@zero/framework/src/cli/run.ts', 'add', 'modals', 'components/dense-list', '--target', consumer], consumer);
    await Bun.write(join(consumer, 'copied-consumer.tsx'), COPIED_CONSUMER);
    const copiedBuild = await checked(['build', 'copied-consumer.tsx', '--target', 'browser', '--outdir', 'copied-dist'], consumer);
    expect(copiedBuild).not.toContain('error:');
    await checked(['run', 'node_modules/typescript/bin/tsc', '--noEmit'], consumer);
    const cli = JSON.parse((await checked(['run', 'node_modules/@zero/framework/src/cli/run.ts', 'doctor', '--source-only',
      '--project-root', consumer, '--usage-include', 'app', '--json'], consumer)).trim());
    expect(cli.mode).toBe('source-only'); expect(cli.installedFramework.modalShow).toBe(true); expect(cli.scannedFiles).toBe(1);
    await mkdir(ARTIFACTS, { recursive: true });
    await Bun.write(join(ARTIFACTS, 'package-consumer-evidence.json'), JSON.stringify({ version: result.version, sha256,
      snapshot: 'dirty', scope: 'fresh installed archive consumer; not published', publicExports: result.exports,
      browserBytes: result.browserBytes, copiedBrowserBuild: true, consumerTypecheck: true, sourceOnlyDoctor: true,
      configTripwireNotExecuted: true, date: '2026-10-08' }, null, 2));
  } finally {
    // Only this exact freshly allocated archive/consumer tree is disposable.
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);

/** Bounded isolated package subprocess; scripts and ambient environment files remain disabled. */
async function checked(arguments_: string[], cwd: string): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...arguments_], { cwd, stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH, TMPDIR: SCRATCH, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' } });
  let expired = false;
  const timeout = setTimeout(() => { expired = true; child.kill(); }, 110_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (expired || code !== 0) throw new Error(`Modal package consumer failed (${expired ? 'timeout' : code}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally { clearTimeout(timeout); }
}

const CONSUMER = `
import * as React from 'react';
import * as Root from '@zero/framework';
import * as ReactParts from '@zero/framework/react';
import * as Modals from '@zero/framework/modals';
import * as Lists from '@zero/framework/components/dense-list';
import { useWorkflowObservation } from '@zero/framework/react/hooks';
import { useReactiveFormRecord } from '@zero/framework/hooks';
import type { ModalDescriptor, ModalHandle, ModalResult, ModalContext, ModalMotionOptions, ModalPromptOptions } from '@zero/framework/modals';
import type { FormRecordSnapshot } from '@zero/framework/hooks';
const names = ['ModalManager', 'ControlledModal', 'HoldButton', 'useModalForm', 'createModalFormGuard',
  'ModalWorkflowProgress', 'resolveModalMotion'] as const;
for (const name of names) if (typeof Modals[name] !== 'function' || Modals[name] !== Root[name] || Modals[name] !== ReactParts[name])
  throw new Error('Missing public modal export: ' + name);
for (const name of ['DenseList', 'DenseListItem', 'DenseListGroup', 'DenseListChoice'] as const)
  if (typeof Lists[name] !== 'function' || Lists[name] !== Root[name] || Lists[name] !== ReactParts[name])
    throw new Error('Missing public list export: ' + name);
if (Modals.modals !== Root.modals || Modals.modals !== ReactParts.modals) throw new Error('Modal singleton export mismatch');
for (const name of ['show', 'confirm', 'alert', 'prompt', 'actionConfirm'] as const)
  if (typeof Modals.modals[name] !== 'function') throw new Error('Missing public modal method: ' + name);
if (typeof useWorkflowObservation !== 'function' || typeof useReactiveFormRecord !== 'function') throw new Error('Missing public adapter hook');
export const exportCount = names.length + 4 + 1;
export const motion: ModalMotionOptions = { entrance: 'origin', exit: 'mirror', backdrop: 'blur', pageRecedes: true, durationMultiplier: 1.5 };
export const descriptor: ModalDescriptor<{ id: string }> = { title: 'Package modal', motion, layout: 'nav',
  sections: [{ id: 'profile', label: 'Profile', group: 'Account', body: context => <span>{context.id}</span> }],
  actions: [{ id: 'save', label: 'Save', variant: 'primary', submit: true, formId: 'owned-form',
    onClick: async context => { if (context.signal.aborted) return false; return { id: 'accepted' }; } }] };
export const prompt: ModalPromptOptions = { title: 'Rename', required: true, validate: value => value ? null : 'Required' };
export const record: FormRecordSnapshot<{ id: string }> = { status: 'ready', values: { id: 'synthetic' }, revision: 'opaque',
  identity: 'synthetic', origin: 'authoritative' };
export function typedHandle(handle: ModalHandle<{ id: string }>, context: ModalContext<{ id: string }>): Promise<ModalResult<{ id: string }>> {
  context.setError(null); handle.update({ footer: { start: 'Saved after acknowledgment' } }); return handle.result;
}
export function Consumer() {
  return <Modals.ModalManager><Lists.DenseListGroup title="Package preferences"><Lists.DenseList>
    <Lists.DenseListItem title="Package member" description="Synthetic settings row" trailing={<button type="button">Manage</button>} />
    <Lists.DenseListChoice title="Choose a task" onChoose={() => undefined} />
  </Lists.DenseList></Lists.DenseListGroup></Modals.ModalManager>;
}
`;

const VERIFY = `
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { runSourceOnlyDoctor } from '@zero/framework/doctor';
import { Consumer, exportCount } from './consumer';
const build = await Bun.build({ entrypoints: ['./consumer.tsx'], target: 'browser', format: 'esm' });
if (!build.success) throw new Error(build.logs.map(log => log.message).join('\\n'));
const report = await runSourceOnlyDoctor({ projectRoot: process.cwd(), include: ['app'] });
console.log(JSON.stringify({ exports: exportCount, browserBytes: build.outputs.reduce((sum, item) => sum + item.size, 0),
  html: renderToString(React.createElement(Consumer)), version: report.installedFramework.version,
  installed: report.installedFramework.status, modalShow: report.installedFramework.modalShow,
  sourceOnly: report.mode === 'source-only', scannedFiles: report.scannedFiles, codes: report.findings.map(finding => finding.code) }));
`;

const USAGE = `
import { modals } from '@zero/framework/modals';
export function openSyntheticModal(trigger: Element) {
  return modals.show({ title: 'Synthetic modal', trigger, body: 'Content', actions: [{ id: 'cancel', label: 'Cancel', role: 'cancel' }] });
}
`;

const COPIED_CONSUMER = `
import { ModalManager, ControlledModal, modals, useModalForm, ModalWorkflowProgress, resolveModalMotion } from './modals';
import { DenseList, DenseListItem, DenseListGroup, DenseListChoice } from './components/dense-list';
export { ModalManager, ControlledModal, modals, useModalForm, ModalWorkflowProgress, resolveModalMotion,
  DenseList, DenseListItem, DenseListGroup, DenseListChoice };
`;
