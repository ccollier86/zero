/** Failure retention and owned-process guards do not weaken native test acceptance. */
import { expect, test } from 'bun:test';
// Bun has no direct recursive directory-removal or lstat API.
import { lstat, rm } from 'node:fs/promises';
import { withMacNativeFixtureDiagnostics, type MacNativeFixture } from './mac-native-fixture';
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
    expect(path.startsWith('/Volumes/code-bank/artifacts/zero-platform/diagnostics/mac-native-fixtures/mac-signature-test-')).toBe(true);
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
    if (typeof retained === 'string' && retained.startsWith('/Volumes/code-bank/artifacts/zero-platform/diagnostics/mac-native-fixtures/mac-signature-test-')) {
      await rm(retained, { recursive: true, force: true });
    }
  }
});

test('incomplete diagnostic collection keeps the original assertion and exact failed fixture', async () => {
  const original = new Error('synthetic primary error');
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
    if (fixture?.root.startsWith('/Volumes/code-bank/tmp/scratch/zero-platform/mac-signature-test-')) await rm(fixture.root, { recursive: true, force: true });
  }
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
