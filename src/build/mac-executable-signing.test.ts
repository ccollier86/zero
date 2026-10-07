/** Synthetic command admission and actual macOS Bun/JIT execution; no certificate, provider, or app data is used. */
import { expect, test } from 'bun:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { finalizeMacExecutableSignature } from './mac-executable-signing';
import { withMacNativeFixtureDiagnostics } from '../test-support/mac-native-fixture';

async function fixture(run: (root: string, binary: string) => Promise<void>) {
  const root = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/mac-signature-test-');
  const binary = join(root, 'server');
  try { await Bun.write(binary, 'synthetic owned output'); await run(root, binary); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('non-macOS builds do not require a signer or inspect a nonexistent macOS output', async () => {
  let called = false;
  await finalizeMacExecutableSignature('/nonexistent-synthetic-output', 'linux', async () => { called = true; });
  expect(called).toBe(false);
});

test('macOS output is ad-hoc signed before strict verification without a certificate or recursive native signing', async () => {
  await fixture(async (_root, binary) => {
    const commands: string[][] = [];
    await finalizeMacExecutableSignature(binary, 'darwin', async command => { commands.push([...command]); });
    expect(commands).toEqual([
      ['/usr/bin/codesign', '--force', '--sign', '-', '--preserve-metadata=identifier,entitlements,flags', binary],
      ['/usr/bin/codesign', '--verify', '--strict', binary],
    ]);
    expect(commands.flat()).not.toContain('--deep');
  });
});

test('a failed signing operation cannot proceed to verification or return an admitted build', async () => {
  await fixture(async (_root, binary) => {
    let commands = 0;
    await expect(finalizeMacExecutableSignature(binary, 'darwin', async () => { commands += 1; throw new Error('synthetic signer denied'); })).rejects.toThrow('synthetic signer denied');
    expect(commands).toBe(1);
  });
});

test('strict verification failure cannot return a successful build', async () => {
  await fixture(async (_root, binary) => {
    let commands = 0;
    await expect(finalizeMacExecutableSignature(binary, 'darwin', async () => { if (++commands === 2) throw new Error('synthetic invalid signature'); })).rejects.toThrow('synthetic invalid signature');
    expect(commands).toBe(2);
  });
});

test('signing refuses a symbolic link rather than mutating its unrelated target', async () => {
  await fixture(async (root, binary) => {
    const link = join(root, 'linked-server'); await symlink(binary, link);
    let called = false;
    await expect(finalizeMacExecutableSignature(link, 'darwin', async () => { called = true; })).rejects.toThrow('ordinary newly built executable');
    expect(called).toBe(false);
    expect(await Bun.file(binary).text()).toBe('synthetic owned output');
  });
});

const nativeTest = process.platform === 'darwin' ? test : test.skip;
nativeTest('a newly compiled macOS Bun executable has a strictly valid signature and retains JavaScript/JIT execution', async () => {
  await withMacNativeFixtureDiagnostics(import.meta.path, async ({ binary, source, execute }) => {
    await Bun.write(source, 'const values=Array.from({length:2000},(_,index)=>index);console.log(JSON.stringify({sum:values.reduce((total,value)=>total+value,0),jit:true}));');
    const built = await Bun.build({ entrypoints: [source], target: 'bun', compile: { outfile: binary } });
    expect(built.success).toBe(true);
    await finalizeMacExecutableSignature(binary);
    const verification = Bun.spawn(['/usr/bin/codesign', '--verify', '--strict', binary], { stdout: 'ignore', stderr: 'pipe' });
    expect(await verification.exited).toBe(0);
    expect(await new Response(verification.stderr).text()).toBe('');
    const child = await execute();
    expect(child.exitCode).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({ sum: 1999000, jit: true });
    expect(child.stderr).toBe('');
  });
}, 150_000);
