/** Proves Cascader's public root/subpath exports in an actual freshly installed packed consumer. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';

test('packed Cascader exports browser-build and server-render with full-path selection metadata', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'cascader-package-'));
  const consumer = join(root, 'consumer'), archive = join(root, 'framework.tgz');
  try {
    await mkdir(consumer);
    await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], process.cwd());
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({
      name: 'zero-cascader-public-consumer', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4' },
    }));
    await Bun.write(join(consumer, 'consumer.tsx'), CONSUMER);
    await Bun.write(join(consumer, 'verify.ts'), VERIFY);
    await checked(['install', '--ignore-scripts'], consumer);
    const output = await checked(['verify.ts'], consumer);
    const result = JSON.parse(output.trim()) as { exported: number; browserBytes: number; html: string };
    expect(result.exported).toBe(14);
    expect(result.browserBytes).toBeGreaterThan(0);
    expect(result.html).toContain('People / Name');
    expect(result.html).toContain('Projects / Name');
    expect(result.html).toContain('data-paths="people|people.name;projects|projects.name"');
    expect(result.html).toContain('name="attributes" value="people.name"');
    expect(result.html).toContain('name="attributes" value="projects.name"');
  } finally {
    // Only this test's newly allocated consumer, dependencies and archive are disposable.
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
    if (expired || code !== 0) throw new Error(`Cascader package consumer failed (${expired ? 'timeout' : code}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally { clearTimeout(timeout); }
}

const CONSUMER = `
import * as React from 'react';
import * as Root from '@zero/framework';
import * as Parts from '@zero/framework/components/cascader';
import type { CascaderNode } from '@zero/framework/components/cascader';
const exported = ['Cascader', 'CascaderTrigger', 'CascaderContent', 'CascaderPanel',
  'CascaderInput', 'CascaderBreadcrumb', 'CascaderValue', 'CascaderList', 'CascaderItems',
  'CascaderFooter', 'CascaderAction', 'CascaderImportMenu', 'CascaderSelectionChips', 'useCascaderSelection'] as const;
for (const name of exported) {
  if (typeof Parts[name] !== 'function' || Parts[name] !== Root[name]) throw new Error('Missing public Cascader export: ' + name);
}
export const exportedCount = exported.length;
const items: readonly CascaderNode[] = [
  { value: 'people', label: 'People', children: [{ value: 'people.name', label: 'Name' }] },
  { value: 'projects', label: 'Projects', children: [{ value: 'projects.name', label: 'Name' }] },
];
function CustomPaths() {
  const selection = Root.useCascaderSelection();
  return <span data-paths={selection.items.map(item => item.path.map(node => node.value).join('|')).join(';')} />;
}
export function Consumer() {
  return <Root.Cascader items={items} label="Package attributes" name="attributes" multiple max={2}
    defaultValue={['people.name', 'projects.name']}>
    <Parts.CascaderTrigger><Parts.CascaderValue /></Parts.CascaderTrigger>
    <Parts.CascaderContent><Parts.CascaderPanel>
      <Parts.CascaderInput /><Parts.CascaderBreadcrumb />
      <Parts.CascaderList><Parts.CascaderItems /></Parts.CascaderList>
      <Parts.CascaderFooter>
        <Parts.CascaderAction>Create attribute</Parts.CascaderAction>
        <Parts.CascaderImportMenu actions={[]} />
      </Parts.CascaderFooter>
    </Parts.CascaderPanel></Parts.CascaderContent>
    <Root.CascaderSelectionChips /><CustomPaths />
  </Root.Cascader>;
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
