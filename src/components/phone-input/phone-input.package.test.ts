/** Verifies installed public phone/schema/base-input facades without an application, DOM or live service. */
// Bun has no native mkdtemp/mkdir/rm API; filesystem compatibility is limited to disposable fixture directories.
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { expect, test } from 'bun:test';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';

test('packed phone input browser-builds and SSR-renders with canonical form and schema validation', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(`${SCRATCH}/phone-package-`);
  const consumer = `${root}/consumer`, archive = `${root}/framework.tgz`;
  try {
    await mkdir(consumer);
    await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], process.cwd());
    await Bun.write(`${consumer}/package.json`, JSON.stringify({
      name: 'zero-phone-public-consumer', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4' },
    }));
    await Bun.write(`${consumer}/consumer.tsx`, CONSUMER);
    await Bun.write(`${consumer}/verify.ts`, VERIFY);
    await checked(['install', '--ignore-scripts'], consumer);
    const result = JSON.parse((await checked(['verify.ts'], consumer)).trim()) as {
      browserBytes: number; html: string; valid: boolean; invalid: boolean; sql: string;
    };
    expect(result.browserBytes).toBeGreaterThan(0);
    expect(result.valid).toBe(true);
    expect(result.invalid).toBe(false);
    expect(result.sql).toBe('text');
    expect(result.html).toContain('phone-input-country-readonly');
    expect(result.html).toContain('type="tel"');
    expect(result.html).toContain('name="phone" value="+12025550123"');
    expect(result.html.match(/name="phone"/gu)).toHaveLength(1);
    expect(result.html).toContain('id="public-phone"');
    expect(result.html).toContain('readOnly=""');
    expect(result.html).not.toContain('wrapperClassName=');
  } finally {
    // Only the fresh test-owned consumer/archive is disposable; no application data is opened.
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
    if (expired || code !== 0) throw new Error(`Phone package consumer failed (${expired ? 'timeout' : code}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally { clearTimeout(timeout); }
}

const CONSUMER = `
import * as React from 'react';
import * as Root from '@zero/framework';
import * as ReactParts from '@zero/framework/react';
import { PhoneInput } from '@zero/framework/components/phone-input';
import { Input } from '@zero/framework/components/ui/input';
import { field, isPhoneNumber, isPhoneCountry } from '@zero/framework/schema';
if (PhoneInput !== Root.PhoneInput || PhoneInput !== ReactParts.PhoneInput)
  throw new Error('Phone component facade mismatch');
if (isPhoneNumber !== Root.isPhoneNumber || isPhoneCountry !== ReactParts.isPhoneCountry)
  throw new Error('Headless phone facade mismatch');
export const valid = isPhoneNumber('+12025550123') && isPhoneCountry('US');
export const invalid = isPhoneNumber('+');
export const sql = field.phone()._sqlType;
export function Consumer() {
  return <form>
    <PhoneInput id="public-phone" name="phone" aria-label="Public phone"
      value="+12025550123" readOnly />
    <Input name="account" aria-label="Public account" value="example" readOnly
      wrapperClassName="min-w-0" />
  </form>;
}
`;

const VERIFY = `
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { Consumer, valid, invalid, sql } from './consumer';
const build = await Bun.build({ entrypoints: ['./consumer.tsx'], target: 'browser', format: 'esm' });
if (!build.success) throw new Error(build.logs.map(log => log.message).join('\\n'));
console.log(JSON.stringify({valid, invalid, sql, html: renderToString(React.createElement(Consumer)),
  browserBytes: build.outputs.reduce((sum, item) => sum + item.size, 0)}));
`;
