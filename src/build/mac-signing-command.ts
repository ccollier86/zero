/** Owns bounded host codesign subprocesses and safe build failure events; it does not select certificates or inspect application data. */
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';

type SigningStage = 'output' | 'signing' | 'verification';
type FailureReason = 'unavailable' | 'invalid-output' | 'spawn' | 'timeout' | 'exit' | 'process';
interface SigningProcess { readonly exited: Promise<number>; kill(signal: 'SIGKILL'): void; }
interface SigningCommandOptions {
  readonly deadlineMs?: number;
  readonly spawn?: (command: readonly string[]) => SigningProcess;
  readonly emit?: typeof emitPlatformCode;
}
const COMMAND_DEADLINE_MS = 60_000;

/** Emit only static failure context while retaining the original cause on the locally thrown error. */
export function macSignatureFailure(
  stage: SigningStage,
  reason: FailureReason,
  message: string,
  cause?: unknown,
  exitCode?: number,
  emit: typeof emitPlatformCode = emitPlatformCode,
): Error {
  emit(OBS_CODES.APP_COMPILED_SIGNATURE_FAILED, {
    source: 'cli', metadata: { stage, reason, ...(exitCode === undefined ? {} : { exitCode }) },
  });
  return new Error(message, cause === undefined ? undefined : { cause });
}

/** Run one owned host command with a deadline; timeout kills and awaits the child before rejecting. Internal adapters support deterministic command tests. */
export async function runMacSigningCommand(command: readonly string[], options: SigningCommandOptions = {}): Promise<void> {
  const stage = command.includes('--verify') ? 'verification' : 'signing';
  const emit = options.emit ?? emitPlatformCode;
  const spawn = options.spawn ?? (args => Bun.spawn([...args], { stdout: 'ignore', stderr: 'ignore' }));
  let child: SigningProcess;
  try { child = spawn(command); }
  catch (cause) {
    throw macSignatureFailure(stage, 'spawn', `Zero macOS compiled executable ${stage} could not start. The host /usr/bin/codesign tool is required.`, cause, undefined, emit);
  }
  let expired = false;
  const timeout = setTimeout(() => { expired = true; child.kill('SIGKILL'); }, options.deadlineMs ?? COMMAND_DEADLINE_MS);
  let exitCode: number;
  try { exitCode = await child.exited; }
  catch (cause) {
    throw macSignatureFailure(stage, 'process', `Zero macOS compiled executable ${stage} could not complete. The output is not admitted as a successful build.`, cause, undefined, emit);
  } finally { clearTimeout(timeout); }
  if (expired || exitCode !== 0) {
    const reason = expired ? 'timeout' : 'exit';
    const cause = new Error(expired ? 'The host signing command exceeded its deadline.' : 'The host signing command exited unsuccessfully.');
    throw macSignatureFailure(stage, reason, `Zero macOS compiled executable ${stage} ${expired ? 'timed out' : 'failed'}. The output is not admitted as a successful build.`, cause, exitCode, emit);
  }
}
