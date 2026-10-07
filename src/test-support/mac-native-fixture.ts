/** Retain failed actual native fixtures, not replacement retries; successful fixtures are removed. */
// Bun has no direct directory/temp-directory/rename/removal or lstat API.
import { lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { captureMacDiagnosticCommand, executeOwnedMacNativeBinary, type MacNativeExecution } from './mac-native-process';

const CANONICAL_ARTIFACTS = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/mac-native-fixtures';
const FIXTURE_PREFIX = 'mac-signature-test-';
const buildSource = new URL('../build/', import.meta.url);

export interface MacNativeFixtureRoots { readonly scratch: string; readonly artifacts: string }

/** Resolve explicit task roots or existing local artifact storage, with no creation of workstation-specific parents. */
export async function resolveMacNativeFixtureRoots(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
  temporaryRoot = tmpdir(), canonicalArtifactsAvailable?: boolean,
): Promise<MacNativeFixtureRoots> {
  const available = canonicalArtifactsAvailable ?? await lstat(dirname(CANONICAL_ARTIFACTS)).then(stat => stat.isDirectory(), () => false);
  const scratch = environment.ZERO_MAC_NATIVE_SCRATCH_ROOT ?? temporaryRoot;
  const artifacts = environment.ZERO_MAC_NATIVE_ARTIFACTS_ROOT
    ?? (available ? CANONICAL_ARTIFACTS : join(temporaryRoot, 'zero-platform-diagnostics', 'mac-native-fixtures'));
  if (!isAbsolute(scratch) || !isAbsolute(artifacts)) throw new Error('Mac native fixture roots must be absolute paths.');
  return { scratch: resolve(scratch), artifacts: resolve(artifacts) };
}

/** Delete only an exact generated child directory, never a broad root, sibling prefix or symbolic link. */
export async function removeOwnedMacNativeFixture(root: string, parent: string): Promise<void> {
  if (!isAbsolute(root) || resolve(root) !== root || dirname(root) !== resolve(parent)
    || !basename(root).startsWith(FIXTURE_PREFIX) || basename(root) === FIXTURE_PREFIX) {
    throw new Error('Refusing cleanup outside the owned mac native fixture.');
  }
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Refusing cleanup of a non-directory or symbolic-link mac native fixture.');
  await rm(root, { recursive: true, force: true });
}

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
  const roots = await resolveMacNativeFixtureRoots();
  await mkdir(roots.scratch, { recursive: true });
  const root = await mkdtemp(join(roots.scratch, FIXTURE_PREFIX)), binary = join(root, 'server'), source = join(root, 'entry.ts');
  const evidence: Record<string, unknown> = { kind: 'actual-mac-native-fixture', diagnosticOnly: true,
    retries: 0, root, binary, source, scratchRoot: roots.scratch, artifactRoot: roots.artifacts,
    bun: Bun.version, platform: process.platform, arch: process.arch,
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
    await run(fixture); await removeOwnedMacNativeFixture(root, roots.scratch);
  }
  catch (originalError) {
    evidence.failedAt = new Date().toISOString();
    evidence.error = originalError instanceof Error ? { name: originalError.name, message: originalError.message.slice(0, 1024) } : { name: 'UnknownError' };
    try { await retainFixture(testSource, fixture, roots.artifacts); }
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

async function retainFixture(testSource: string, fixture: MacNativeFixture, artifacts: string) {
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
  await mkdir(artifacts, { recursive: true });
  const retained = join(artifacts, basename(root));
  await rename(root, retained);
  evidence.retainedRoot = retained;
  evidence.originalFixtureRoot = root;
  evidence.renamedWithoutCopyingBinary = true;
  await Bun.write(join(retained, 'provenance.json'), JSON.stringify(evidence, null, 2));
  console.error(JSON.stringify({ macNativeFailureEvidence: retained, binarySha256: evidence.binarySha256 }));
}
