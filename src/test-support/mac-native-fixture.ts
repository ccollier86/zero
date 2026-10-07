/** Retain failed actual native fixtures, not replacement retries; successful fixtures are removed. */
// Bun has no direct directory/temp-directory/rename/removal or lstat API.
import { lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { captureMacDiagnosticCommand, executeOwnedMacNativeBinary, type MacNativeExecution } from './mac-native-process';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const ARTIFACTS = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/mac-native-fixtures';
const buildSource = new URL('../build/', import.meta.url);

export interface MacNativeFixture {
  readonly root: string;
  readonly binary: string;
  readonly source: string;
  readonly evidence: Record<string, unknown>;
  execute(): Promise<MacNativeExecution>;
}

async function hash(path: string): Promise<string> {
  return new Bun.CryptoHasher('sha256').update(await Bun.file(path).arrayBuffer()).digest('hex');
}

/** Preserve the original fixture's placeholder-before-compile behavior and error identity. */
export async function withMacNativeFixtureDiagnostics(
  testSource: string,
  run: (fixture: MacNativeFixture) => Promise<void>,
): Promise<void> {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(`${SCRATCH}/mac-signature-test-`), binary = join(root, 'server'), source = join(root, 'entry.ts');
  const evidence: Record<string, unknown> = { kind: 'actual-mac-native-fixture', diagnosticOnly: true,
    retries: 0, root, binary, source, bun: Bun.version, platform: process.platform, arch: process.arch,
    startedAt: new Date().toISOString(), launchDeadlineMs: 20_000, placeholderBeforeCompile: 'synthetic owned output' };
  const fixture: MacNativeFixture = { root, binary, source, evidence,
    async execute() {
      const result = await executeOwnedMacNativeBinary(binary, root, execution => { evidence.execution = execution; });
      evidence.execution = result; return result;
    } };
  try {
    await Bun.write(binary, 'synthetic owned output');
    const before = await lstat(binary);
    evidence.placeholderStat = { inode: before.ino, mode: before.mode, bytes: before.size };
    await run(fixture); await rm(root, { recursive: true, force: true });
  }
  catch (originalError) {
    evidence.failedAt = new Date().toISOString();
    evidence.error = originalError instanceof Error ? { name: originalError.name, message: originalError.message.slice(0, 1024) } : { name: 'UnknownError' };
    try { await retainFixture(testSource, fixture); }
    catch (diagnosticError) {
      // Never delete a failed fixture or replace the actual assertion error when evidence collection fails.
      const retained = typeof evidence.retainedRoot === 'string' ? evidence.retainedRoot : root;
      evidence.retainedRoot = retained;
      evidence.diagnosticError = diagnosticError instanceof Error ? diagnosticError.message.slice(0, 1024) : 'Failure evidence could not be completed.';
      try { await Bun.write(join(retained, 'provenance.json'), JSON.stringify(evidence, null, 2)); } catch {}
      console.error(JSON.stringify({ macNativeFailureEvidence: retained, diagnosticsIncomplete: true }));
    }
    throw originalError;
  }
}

async function retainFixture(testSource: string, fixture: MacNativeFixture) {
  const { root, binary, evidence } = fixture;
  // Persist a minimal record first so a later diagnostic failure cannot destroy the original evidence.
  await Bun.write(join(root, 'provenance.json'), JSON.stringify(evidence, null, 2));
  const stat = await lstat(binary);
  evidence.binaryStat = { inode: stat.ino, mode: stat.mode, bytes: stat.size };
  evidence.binarySha256 = await hash(binary);
  const sources: Record<string, unknown> = {};
  for (const [label, path] of [
    ['native-test', testSource], ['signing-helper', new URL('mac-executable-signing.ts', buildSource).pathname],
    ['signing-command', new URL('mac-signing-command.ts', buildSource).pathname],
    ['fixture-diagnostics', import.meta.path], ['process-diagnostics', new URL('./mac-native-process.ts', import.meta.url).pathname],
  ] as const) {
    const contents = await Bun.file(path).text();
    await Bun.write(join(root, `${label}-source.txt`), contents);
    sources[label] = { sha256: new Bun.CryptoHasher('sha256').update(contents).digest('hex') };
  }
  evidence.sourceSnapshots = sources;
  if (await Bun.file(fixture.source).exists()) evidence.entrySha256 = await hash(fixture.source);
  if (process.platform === 'darwin') {
    evidence.signature = {
      strict: await captureMacDiagnosticCommand(['/usr/bin/codesign', '--verify', '--strict', binary], root),
      flags: await captureMacDiagnosticCommand(['/usr/bin/codesign', '-dvvv', binary], root),
      entitlements: await captureMacDiagnosticCommand(['/usr/bin/codesign', '-d', '--entitlements', ':-', binary], root),
      xattrs: await captureMacDiagnosticCommand(['/usr/bin/xattr', '-l', binary], root),
    };
  }
  await mkdir(ARTIFACTS, { recursive: true });
  const retained = join(ARTIFACTS, basename(root));
  await rename(root, retained);
  evidence.retainedRoot = retained;
  evidence.originalFixtureRoot = root;
  evidence.renamedWithoutCopyingBinary = true;
  await Bun.write(join(retained, 'provenance.json'), JSON.stringify(evidence, null, 2));
  console.error(JSON.stringify({ macNativeFailureEvidence: retained, binarySha256: evidence.binarySha256 }));
}
