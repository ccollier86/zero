/**
 * Qualifies installed profile-settings presentation facades and the additive
 * session-recovery API. Uses a disposable archive/consumer, not a live app,
 * provider, profile database or presence service.
 */
// Bun has no direct directory-creation/temp-directory/removal API.
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { expect, test } from 'bun:test';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';

test('installed adaptive settings facades browser-build and render without domain services', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(`${SCRATCH}/profile-settings-package-`);
  const consumer = `${root}/consumer`, archive = `${root}/framework.tgz`;
  try {
    await mkdir(consumer);
    await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], process.cwd());
    await Bun.write(`${consumer}/package.json`, JSON.stringify({
      name: 'zero-profile-settings-public-consumer', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4' },
    }));
    await Bun.write(`${consumer}/consumer.tsx`, CONSUMER);
    await Bun.write(`${consumer}/verify.ts`, VERIFY);
    await checked(['install', '--ignore-scripts'], consumer);
    const result = JSON.parse((await checked(['verify.ts'], consumer)).trim()) as {
      browserBytes: number; html: string; exports: boolean; recovery: boolean; guides: boolean; notices: boolean;
    };
    expect(result.browserBytes).toBeGreaterThan(0);
    expect(result.exports).toBe(true);
    expect(result.recovery).toBe(true);
    expect(result.guides).toBe(true);
    expect(result.notices).toBe(true);
    expect(result.html).toContain('Public reviewers');
    expect(result.html).toContain('data-shape="square"');
    expect(result.html).not.toContain('Busy');
    expect(result.html).not.toContain('avatar-presence-indicator');
    expect(result.html).not.toContain('Add user');
    expect(result.html).toContain('Delivery rules');
    expect(result.html).toContain('Mentions: Email');
    expect(result.html).toContain('Team chat');
    expect(result.html).toContain('Connected');
    expect(result.html).toContain('Actions for Team chat');
    expect(result.html).not.toContain('New Connection');
  } finally {
    // Only this freshly allocated fixture is disposable; no app data is opened.
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

async function checked(arguments_: string[], cwd: string): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...arguments_], {
    cwd, stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH, TMPDIR: SCRATCH,
      BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' },
  });
  let expired = false;
  const timeout = setTimeout(() => { expired = true; child.kill(); }, 90_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (expired || code !== 0) throw new Error(`Profile UI consumer failed (${expired ? 'timeout' : code}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally { clearTimeout(timeout); }
}

const CONSUMER = `
import * as React from 'react';
import * as Root from '@zero/framework';
import * as ReactParts from '@zero/framework/react';
import { AvatarGroup, AvatarPresenceIndicator } from '@zero/framework/components/avatar-group';
import { SettingsMatrix } from '@zero/framework/components/settings-matrix';
import { IntegrationSettingsList } from '@zero/framework/components/integration-settings-list';
export const exportsMatch = [
  ['AvatarGroup', AvatarGroup], ['AvatarPresenceIndicator', AvatarPresenceIndicator],
  ['SettingsMatrix', SettingsMatrix], ['IntegrationSettingsList', IntegrationSettingsList],
].every(([name, component]) => Root[name] === component && ReactParts[name] === component);
export const recovery = typeof Root.AuthClient.prototype.recoverSession === 'function'
  && typeof Object.getOwnPropertyDescriptor(Root.AuthClient.prototype, 'hasRecoverableSession')?.get === 'function';
export function Consumer() {
  return <main>
    <AvatarGroup aria-label="Public reviewers" role="group" shape="square" members={[
      { id: 'reviewer', name: 'Public reviewer', presence: { label: 'Busy', tone: 'destructive' } },
    ]} />
    <SettingsMatrix title="Delivery rules" columns={[{ id: 'email', label: 'Email' }]}
      rows={[{ id: 'mentions', label: 'Mentions' }]} value={{ mentions: { email: true } }} />
    <IntegrationSettingsList title="Connections" items={[{
      id: 'chat', title: 'Team chat', status: { label: 'Connected', tone: 'success' },
      actions: [{ id: 'review', label: 'Review setup', onSelect() {} }],
    }]} />
  </main>;
}
`;

const VERIFY = `
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { Consumer, exportsMatch, recovery } from './consumer';
const build = await Bun.build({ entrypoints: ['./consumer.tsx'], target: 'browser', format: 'esm' });
if (!build.success) throw new Error(build.logs.map(log => log.message).join('\\n'));
const base = './node_modules/@zero/framework/';
const guides = (await Promise.all(['avatar-group', 'settings-matrix', 'integration-settings-list']
  .map(name => Bun.file(base + 'docs-next/frontend/components/' + name + '.md').exists()))).every(Boolean);
const notices = (await Bun.file(base + 'THIRD_PARTY_NOTICES.md').text()).includes('c-avatar-29.json');
console.log(JSON.stringify({ exports: exportsMatch, recovery, guides, notices,
  html: renderToString(React.createElement(Consumer)),
  browserBytes: build.outputs.reduce((sum, item) => sum + item.size, 0) }));
`;
