/** Qualifies public grouped controls/menu exports in a freshly installed isolated package consumer. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const DIAGNOSTICS = '/Volumes/code-bank/artifacts/zero-platform/diagnostics';

test('packed groups and menus retain public identity, native SSR semantics, docs and browser bundling', async () => {
  await mkdir(SCRATCH, { recursive: true });
  await mkdir(DIAGNOSTICS, { recursive: true });
  const directory = await mkdtemp(join(SCRATCH, 'group-menu-package-'));
  const artifact = await mkdtemp(join(DIAGNOSTICS, 'group-menu-package-'));
  const consumer = join(directory, 'consumer');
  const archive = join(artifact, 'framework.tgz');
  try {
    await mkdir(consumer);
    await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], process.cwd());
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({
      name: 'zero-group-menu-consumer', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4' },
    }));
    await Bun.write(join(consumer, 'consumer.tsx'), CONSUMER);
    await Bun.write(join(consumer, 'verify.ts'), VERIFY);
    await checked(['install', '--ignore-scripts'], consumer);
    // A fresh CLI compiler avoids test-process server/browser resolver warming.
    await checked(['build', 'consumer.tsx', '--target=browser', '--outfile=browser.js'], consumer);
    const result = JSON.parse((await checked(['verify.ts'], consumer)).trim()) as {
      exported: number; bytes: number; version: string; html: string; noDom: boolean; docs: number;
    };
    expect(result.exported).toBe(23);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.version).toBe((await Bun.file('package.json').json()).version);
    expect(result.noDom).toBe(true);
    expect(result.docs).toBe(3);
    expect(result.html).toContain('Package file actions');
    expect(result.html).toContain('data-slot="button-group"');
    expect(result.html).toContain('data-slot="button-group-toggle-item"');
    expect(result.html).toContain('aria-checked="true"');
    expect(result.html).toContain('aria-pressed="true"');
    expect(result.html).toContain('role="menuitemcheckbox"');
    expect(result.html).toContain('role="menuitemradio"');
    expect(result.html).toContain('data-indicator-position="right"');
    expect(result.html).toContain('data-slot="context-menu-end-adornment"');
    expect(result.html).toContain('href="/records"');
    expect(result.html).not.toContain('opacity:0;');
    const commit = (await checked(['-e', 'console.log(Bun.spawnSync(["git","rev-parse","HEAD"]).stdout.toString().trim())'], process.cwd())).trim();
    const dirty = (await checked(['-e', 'console.log(Bun.spawnSync(["git","status","--porcelain"]).stdout.toString().trim())'], process.cwd())).trim() !== '';
    const sha256 = new Bun.CryptoHasher('sha256').update(await Bun.file(archive).arrayBuffer()).digest('hex');
    await Bun.write(join(artifact, 'provenance.json'), JSON.stringify({
      version: result.version, sourceCommit: commit, uncommittedCandidate: dirty,
      archive, sha256, exports: result.exported, docs: result.docs, browserBytes: result.bytes,
      verifiedAt: new Date().toISOString(),
    }, null, 2));
    console.info('[zero-group-menu-package]', JSON.stringify({ artifact, version: result.version, sha256 }));
  } finally {
    // Only this test's newly allocated consumer is disposable; retained package evidence is external.
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);

async function checked(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], {
    cwd, stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH, TMPDIR: SCRATCH, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' },
  });
  let expired = false;
  const timeout = setTimeout(() => { expired = true; child.kill(); }, 90_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (expired || code !== 0) throw new Error(`Grouped-controls package check failed (${expired ? 'timeout' : code}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally { clearTimeout(timeout); }
}

const CONSUMER = `
import * as React from 'react';
import * as Root from '@zero/framework';
import * as ReactParts from '@zero/framework/react';
import * as Group from '@zero/framework/components/button-group';
import * as Menu from '@zero/framework/components/context-menu';
const groups = ['ButtonGroup','ButtonGroupText','ButtonGroupSeparator','ButtonGroupToggle','ButtonGroupToggleItem','buttonGroupVariants'] as const;
const menus = ['ContextMenu','ContextMenuTrigger','ContextMenuPortal','ContextMenuContent','ContextMenuGroup',
  'ContextMenuItem','ContextMenuCheckboxItem','ContextMenuRadioGroup','ContextMenuRadioItem','ContextMenuItemIndicator',
  'ContextMenuLabel','ContextMenuSeparator','ContextMenuShortcut','ContextMenuSub','ContextMenuSubTrigger','ContextMenuSubContent','ContextMenuArrow'] as const;
for (const name of groups) if (typeof Group[name] !== 'function' || Group[name] !== Root[name] || Group[name] !== ReactParts[name]) throw new Error('Missing public group export: '+name);
for (const name of menus) if (typeof Menu[name] !== 'function' || Menu[name] !== Root[name] || Menu[name] !== ReactParts[name]) throw new Error('Missing public menu export: '+name);
export const exported = groups.length + menus.length;
export function Consumer() {
  return <main>
    <Group.ButtonGroup aria-label="Package file actions"><Root.Button type="button" variant="outline">Copy</Root.Button>
      <Group.ButtonGroupSeparator/><Group.ButtonGroupText>4</Group.ButtonGroupText></Group.ButtonGroup>
    <Group.ButtonGroupToggle type="single" defaultValue="list" aria-label="Package view"><Group.ButtonGroupToggleItem value="list">List</Group.ButtonGroupToggleItem></Group.ButtonGroupToggle>
    <Group.ButtonGroupToggle type="multiple" defaultValue={['bold']} aria-label="Package format"><Group.ButtonGroupToggleItem value="bold">Bold</Group.ButtonGroupToggleItem></Group.ButtonGroupToggle>
    <Menu.ContextMenu><Menu.ContextMenuTrigger asChild><button type="button">Package record</button></Menu.ContextMenuTrigger>
      <Menu.ContextMenuContent portal={false} forceMount aria-label="Package record actions">
        <Menu.ContextMenuLabel>Record</Menu.ContextMenuLabel>
        <Menu.ContextMenuItem asChild endAdornment="4"><a href="/records">Records</a></Menu.ContextMenuItem>
        <Menu.ContextMenuSeparator/>
        <Menu.ContextMenuCheckboxItem checked indicatorPosition="right">Pinned</Menu.ContextMenuCheckboxItem>
        <Menu.ContextMenuRadioGroup value="list"><Menu.ContextMenuRadioItem value="list" indicatorPosition="right">List</Menu.ContextMenuRadioItem></Menu.ContextMenuRadioGroup>
        <Menu.ContextMenuSub><Menu.ContextMenuSubTrigger>Export</Menu.ContextMenuSubTrigger>
          <Menu.ContextMenuSubContent portal={false} forceMount><Menu.ContextMenuItem>JSON</Menu.ContextMenuItem></Menu.ContextMenuSubContent></Menu.ContextMenuSub>
      </Menu.ContextMenuContent>
    </Menu.ContextMenu>
  </main>;
}
`;
const VERIFY = `
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import manifest from '@zero/framework/package.json';
import { Consumer, exported } from './consumer';
const root = new URL('.',import.meta.resolve('@zero/framework/package.json'));
const docs = ['docs/frontend/button-group.md','docs/frontend/context-menu.md','THIRD_PARTY_NOTICES.md'];
for (const name of docs) if (!await Bun.file(new URL(name,root)).exists()) throw new Error('Archive omitted '+name);
console.log(JSON.stringify({version:manifest.version,exported,docs:docs.length,bytes:Bun.file('browser.js').size,
  html:renderToString(React.createElement(Consumer)),noDom:typeof window==='undefined'&&typeof document==='undefined'}));
`;
