/** Proves the SignaturePad family through real public exports in a newly installed package consumer. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';

test('packed SignaturePad primitives and prefabs browser-build and render safely without a DOM', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'signature-package-'));
  const consumer = join(root, 'consumer'), archive = join(root, 'framework.tgz');
  try {
    await mkdir(consumer);
    await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], process.cwd());
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({
      name: 'zero-signature-public-consumer', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4' },
    }));
    await Bun.write(join(consumer, 'consumer.tsx'), CONSUMER);
    await Bun.write(join(consumer, 'verify.ts'), VERIFY);
    await checked(['install', '--ignore-scripts'], consumer);
    const output = await checked(['verify.ts'], consumer);
    const result = JSON.parse(output.trim()) as { exported: number; browserBytes: number; html: string };
    expect(result.exported).toBe(13);
    expect(result.browserBytes).toBeGreaterThan(0);
    expect(result.html).toContain('Package signature');
    expect(result.html).toContain('name="signature"');
    expect(result.html).toContain('data:image/svg+xml;charset=utf-8,');
    expect(result.html).toContain('data-ink="1"');
    expect(result.html).toContain('Package agreement');
    expect(result.html).toContain('Package clause');
    expect(result.html).not.toContain('window is not defined');
  } finally {
    // Only this test's freshly allocated consumer and archive are disposable.
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

async function checked(arguments_: string[], cwd: string): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...arguments_], {
    cwd, stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH, TMPDIR: SCRATCH, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' },
  });
  let expired = false;
  const timeout = setTimeout(() => { expired = true; child.kill(); }, 90_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (expired || code !== 0) throw new Error(`Signature package consumer failed (${expired ? 'timeout' : code}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally { clearTimeout(timeout); }
}

const CONSUMER = `
import * as React from 'react';
import * as Root from '@zero/framework';
import * as ReactParts from '@zero/framework/react';
import * as Parts from '@zero/framework/components/signature-pad';
const exported = ['SignaturePad', 'SignaturePadArea', 'SignaturePadControls',
  'SignaturePadGuide', 'SignaturePadPlaceholder', 'SignaturePadPreview', 'useSignaturePad',
  'SignaturePadClear', 'SignaturePadUndo', 'SignaturePadRedo', 'SignaturePadSave',
  'SignatureAgreementCard', 'ClauseInitials'] as const;
for (const name of exported) {
  if (typeof Parts[name] !== 'function' || Parts[name] !== Root[name] || Parts[name] !== ReactParts[name])
    throw new Error('Missing public signature export: ' + name);
}
export const exportedCount = exported.length;
function InkMetadata() {
  const api = Parts.useSignaturePad();
  return <span data-ink={api.strokes.length} />;
}
export function Consumer() {
  return <div>
    <Parts.SignaturePad name="signature" required defaultValue={[{ points: [[10, 20, 2], [60, 40, 3]] }]}>
      <Parts.SignaturePadArea aria-label="Package signature">
      <Parts.SignaturePadControls><Parts.SignaturePadUndo /><Parts.SignaturePadRedo />
        <Parts.SignaturePadClear /><Parts.SignaturePadSave onSave={() => undefined} />
      </Parts.SignaturePadControls></Parts.SignaturePadArea>
      <InkMetadata />
    </Parts.SignaturePad>
    <Parts.SignatureAgreementCard sourceKey="package-agreement" title="Package agreement"
      onSign={async () => ({ signedAt: '2026-10-05T12:00:00Z' })} />
    <Parts.ClauseInitials clauses={[{ id: 'terms', label: 'Package clause' }]} />
  </div>;
}
`;

const VERIFY = `
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { Consumer, exportedCount } from './consumer';
const result = await Bun.build({ entrypoints: ['./consumer.tsx'], target: 'browser', format: 'esm' });
if (!result.success) throw new Error(result.logs.map(log => log.message).join('\\n'));
const html = renderToString(React.createElement(Consumer));
console.log(JSON.stringify({ exported: exportedCount, browserBytes: result.outputs.reduce((sum, item) => sum + item.size, 0), html }));
`;
