/** Failure retention and owned-process guards do not weaken native test acceptance. */
import { expect, test } from 'bun:test';
// Bun has no direct recursive directory-removal or lstat API.
import { lstat, mkdir, mkdtemp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { removeOwnedMacNativeFixture, resolveMacNativeFixtureRoots, withMacNativeFixtureDiagnostics, type MacNativeFixture } from './mac-native-fixture';
import { captureMacDiagnosticCommand, isOwnedMacSampleTarget } from './mac-native-process';

test('the actual native fixture keeps the original placeholder and removes passing output', async () => {
  let root = '';
  await withMacNativeFixtureDiagnostics(import.meta.path, async fixture => {
    root = fixture.root;
    expect(await Bun.file(fixture.binary).text()).toBe('synthetic owned output');
    expect(fixture.evidence.launchDeadlineMs).toBe(20_000);
    expect(fixture.evidence.retries).toBe(0);
    expect(fixture.evidence.placeholderStat).toMatchObject({ bytes: 22 });
    await Bun.write(fixture.source, 'console.log("synthetic fixture");');
  });
  expect(await Bun.file(`${root}/server`).exists()).toBe(false);
  await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('an actual assertion failure retains the same binary inode, static entry and source provenance', async () => {
  const original = new Error('synthetic original native assertion');
  const roots = await resolveMacNativeFixtureRoots();
  let fixture!: MacNativeFixture, inode = 0;
  try {
    await expect(withMacNativeFixtureDiagnostics(import.meta.path, async value => {
      fixture = value;
      await Bun.write(value.source, 'console.log("retained synthetic entry");');
      inode = (await lstat(value.binary)).ino;
      throw original;
    })).rejects.toBe(original);
    const retained = fixture.evidence.retainedRoot;
    expect(typeof retained).toBe('string');
    const path = retained as string;
    expect(path).toBe(join(roots.artifacts, basename(fixture.root)));
    expect(await Bun.file(`${path}/server`).text()).toBe('synthetic owned output');
    expect((await lstat(`${path}/server`)).ino).toBe(inode);
    expect(await Bun.file(`${path}/entry.ts`).text()).toBe('console.log("retained synthetic entry");');
    const provenance = await Bun.file(`${path}/provenance.json`).json();
    expect(provenance.originalFixtureRoot).toBe(fixture.root);
    expect(provenance.renamedWithoutCopyingBinary).toBe(true);
    expect(provenance.binarySha256).toBe(new Bun.CryptoHasher('sha256').update('synthetic owned output').digest('hex'));
    expect(provenance.placeholderBeforeCompile).toBe('synthetic owned output');
    expect(provenance.sourceSnapshots['native-test'].sha256).toHaveLength(64);
    expect(await Bun.file(`${path}/signing-helper-source.txt`).exists()).toBe(true);
  } finally {
    const retained = fixture?.evidence.retainedRoot;
    if (typeof retained === 'string' && retained === join(roots.artifacts, basename(fixture.root))) {
      await removeOwnedMacNativeFixture(retained, roots.artifacts);
    }
  }
});

test('incomplete diagnostic collection keeps the original assertion and exact failed fixture', async () => {
  const original = new Error('synthetic primary error');
  const roots = await resolveMacNativeFixtureRoots();
  let fixture!: MacNativeFixture;
  try {
    await expect(withMacNativeFixtureDiagnostics('/nonexistent-synthetic-test-source', async value => {
      fixture = value; throw original;
    })).rejects.toBe(original);
    expect(fixture.evidence.retainedRoot).toBe(fixture.root);
    expect(await Bun.file(fixture.binary).text()).toBe('synthetic owned output');
    const evidence = await Bun.file(`${fixture.root}/provenance.json`).json();
    expect(evidence.error.message).toBe(original.message);
    expect(evidence.diagnosticError).toBeDefined();
  } finally {
    if (fixture?.root) await removeOwnedMacNativeFixture(fixture.root, roots.scratch);
  }
});

test('fixture roots preserve existing canonical artifacts, admit explicit task roots and fall back without creating workstation paths', async () => {
  const temporary = resolve(tmpdir());
  const fallback = await resolveMacNativeFixtureRoots({}, temporary, false);
  expect(fallback).toEqual({ scratch: temporary, artifacts: join(temporary, 'zero-platform-diagnostics', 'mac-native-fixtures') });
  const canonical = await resolveMacNativeFixtureRoots({}, temporary, true);
  expect(canonical.scratch).toBe(temporary);
  expect(canonical.artifacts).toBe('/Volumes/code-bank/artifacts/zero-platform/diagnostics/mac-native-fixtures');
  const explicit = { ZERO_MAC_NATIVE_SCRATCH_ROOT: join(temporary, 'explicit-scratch'), ZERO_MAC_NATIVE_ARTIFACTS_ROOT: join(temporary, 'explicit-evidence') };
  expect(await resolveMacNativeFixtureRoots(explicit, temporary, true)).toEqual({ scratch: explicit.ZERO_MAC_NATIVE_SCRATCH_ROOT, artifacts: explicit.ZERO_MAC_NATIVE_ARTIFACTS_ROOT });
  await expect(resolveMacNativeFixtureRoots({ ZERO_MAC_NATIVE_SCRATCH_ROOT: 'relative' }, temporary, false)).rejects.toThrow('absolute paths');
  await expect(resolveMacNativeFixtureRoots({ ZERO_MAC_NATIVE_ARTIFACTS_ROOT: '' }, temporary, false)).rejects.toThrow('absolute paths');
});

test('owned cleanup refuses broad roots, unrelated directories and symlink fixtures without deleting their targets', async () => {
  const temporary = resolve(tmpdir()), root = await mkdtemp(join(temporary, 'mac-signature-test-'));
  try {
    const sibling = join(root, 'unrelated'), link = join(root, 'mac-signature-test-link');
    await mkdir(sibling); await Bun.write(join(sibling, 'sentinel.txt'), 'owned cleanup sentinel');
    await symlink(sibling, link, 'dir');
    await expect(removeOwnedMacNativeFixture(root, root)).rejects.toThrow('outside');
    await expect(removeOwnedMacNativeFixture(sibling, root)).rejects.toThrow('outside');
    await expect(removeOwnedMacNativeFixture(link, root)).rejects.toThrow('symbolic-link');
    expect(await Bun.file(join(sibling, 'sentinel.txt')).text()).toBe('owned cleanup sentinel');
  } finally { await removeOwnedMacNativeFixture(root, temporary); }
});

test('sampling admission requires the captured live PID and exact binary path, not a substring or sibling', () => {
  const binary = '/owned-fixture/server';
  expect(isOwnedMacSampleTarget(123, binary, true, { exitCode: 0, stdout: ` 123 S 00:01 ${binary}\n` })).toBe(true);
  for (const [pid, live, exitCode, stdout] of [
    [124, true, 0, `123 S 00:01 ${binary}`], [123, false, 0, `123 S 00:01 ${binary}`],
    [123, true, 1, `123 S 00:01 ${binary}`], [123, true, 0, `123 S 00:01 ${binary}-other`],
    [123, true, 0, `123 S 00:01 /other/server ${binary}`], [123, true, 0, `123 S 00:01 ${binary}\n124 S 00:01 ${binary}`],
  ] as const) expect(isOwnedMacSampleTarget(pid, binary, live, { exitCode, stdout })).toBe(false);
});

test('a timed-out owned diagnostic child is killed and reaped without a native-deadline override', async () => {
  const result = await captureMacDiagnosticCommand([process.execPath, '--no-env-file', '-e', 'await Bun.sleep(10000);'], import.meta.dir, 25);
  expect(result.timedOut).toBe(true);
  expect(result.signal).toBe('SIGKILL');
  expect(result.exitCode).not.toBe(0);
  expect(result.stdout).toBe('');
});
