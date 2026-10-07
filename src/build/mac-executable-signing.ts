/** Finalize only newly built macOS executables with the host's ad-hoc signer. No certificate, notarization, or native-library signing is selected. */
import { lstat } from 'node:fs/promises';
import { macSignatureFailure, runMacSigningCommand } from './mac-signing-command';

type SigningCommandRunner = (command: readonly string[]) => Promise<void>;

/** Replace stale Bun compile signatures, preserving existing metadata, and admit the output only after strict verification. */
export async function finalizeMacExecutableSignature(
  executable: string,
  platform: string = process.platform,
  run: SigningCommandRunner = runMacSigningCommand,
): Promise<void> {
  if (platform !== 'darwin') return;
  let file;
  try { file = await lstat(executable); }
  catch (cause) { throw macSignatureFailure('output', 'unavailable', 'Zero compiled signing could not inspect the newly built executable.', cause); }
  if (!file.isFile() || file.isSymbolicLink()) throw macSignatureFailure('output', 'invalid-output', 'Zero compiled signing requires an ordinary newly built executable file.');
  // Keep existing JIT entitlements where present. Ad-hoc signing repairs the
  // output's code hashes; it does not establish a Developer ID or trust policy.
  await run(['/usr/bin/codesign', '--force', '--sign', '-', '--preserve-metadata=identifier,entitlements,flags', executable]);
  await run(['/usr/bin/codesign', '--verify', '--strict', executable]);
}
