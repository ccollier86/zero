/** Bounded diagnostics for captured test-owned processes; never changes host security policy. */
export interface MacDiagnosticCommandResult {
  readonly command: readonly string[];
  readonly pid: number;
  readonly exitCode: number;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

async function waitFor<T>(operation: Promise<T>, duration: number): Promise<{ settled: true; value: T } | { settled: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation.then(value => ({ settled: true as const, value })),
      new Promise<{ settled: false }>(resolve => { timer = setTimeout(() => resolve({ settled: false }), duration); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Each command is spawned here, killed on its own bound, then reaped and drained. */
export async function captureMacDiagnosticCommand(
  command: readonly string[], cwd: string, deadlineMs = 4_000,
): Promise<MacDiagnosticCommandResult> {
  const child = Bun.spawn([...command], { cwd, env: { PATH: Bun.env.PATH ?? '' }, stdout: 'pipe', stderr: 'pipe' });
  const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  void output.catch(() => undefined);
  let exit = await waitFor(child.exited, deadlineMs), timedOut = false;
  if (!exit.settled) { timedOut = true; child.kill('SIGKILL'); exit = await waitFor(child.exited, 3_000); }
  if (!exit.settled) throw new Error('An owned macOS diagnostic subprocess did not reap after SIGKILL.');
  const captured = await waitFor(output, 2_000);
  if (!captured.settled) throw new Error('An owned macOS diagnostic subprocess output did not drain.');
  return { command: [...command], pid: child.pid, exitCode: exit.value, signal: child.signalCode,
    timedOut, stdout: captured.value[0].slice(0, 32_768), stderr: captured.value[1].slice(0, 32_768) };
}

/** ps must confirm both the captured live PID and the exact no-argument native executable. */
export function isOwnedMacSampleTarget(pid: number, binary: string, live: boolean, ps: Pick<MacDiagnosticCommandResult, 'exitCode' | 'stdout'>): boolean {
  if (!live || !Number.isSafeInteger(pid) || pid <= 0 || ps.exitCode !== 0) return false;
  const row = /^\s*(\d+)\s+(\S+)\s+(\S+)\s+([^\r\n]+)\s*$/u.exec(ps.stdout);
  return Number(row?.[1]) === pid && row?.[4]?.trim() === binary;
}

export interface MacNativeExecution {
  readonly pid: number;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly deadlineMs: 20_000;
  readonly timedOut: boolean;
  readonly reaped: boolean;
  readonly exitCode: number;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly observations: readonly unknown[];
}

/** The actual native test's launch deadline remains fixed at twenty seconds. */
export async function executeOwnedMacNativeBinary(
  binary: string, root: string, record: (execution: unknown) => void = () => undefined,
): Promise<MacNativeExecution> {
  const child = Bun.spawn([binary], { cwd: root, env: { PATH: Bun.env.PATH ?? '' }, stdout: 'pipe', stderr: 'pipe' });
  const started = performance.now(), startedAt = new Date().toISOString();
  const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  void output.catch(() => undefined);
  let exited = false, timedOut = false;
  void child.exited.then(() => { exited = true; });
  const deadline = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 20_000);
  record({ pid: child.pid, startedAt, deadlineMs: 20_000, reaped: false });
  async function observe(afterMs: number) {
    if ((await waitFor(child.exited, Math.max(0, afterMs - (performance.now() - started)))).settled || exited) {
      return { atMs: afterMs, alreadyExited: true };
    }
    const state = await captureMacDiagnosticCommand(['/bin/ps', '-p', String(child.pid), '-o', 'pid=,stat=,etime=,args='], root, 2_000);
    const observation: Record<string, unknown> = { atMs: performance.now() - started, pid: child.pid, state };
    if (isOwnedMacSampleTarget(child.pid, binary, !exited && child.exitCode === null, state) && performance.now() - started < 17_000) {
      const path = `${root}/sample-${afterMs}.txt`;
      observation.sample = await captureMacDiagnosticCommand(['/usr/bin/sample', String(child.pid), '1', '1', '-file', path], root);
      observation.samplePath = path;
    } else observation.sampleSkipped = 'The captured live PID and exact binary path were not confirmed, or observation ended.';
    return observation;
  }
  const observations = [4_000, 12_000].map(at => observe(at).catch(error => ({
    atMs: at, observationFailed: true,
    error: error instanceof Error ? error.message.slice(0, 1024) : 'An owned process observation failed.',
  })));
  try {
    const exit = await waitFor(child.exited, 23_500);
    if (!exit.settled) throw new Error('The test-owned native executable did not reap after its twenty-second deadline.');
    clearTimeout(deadline);
    const captured = await waitFor(output, 2_000);
    if (!captured.settled) throw new Error('The test-owned native executable output did not drain.');
    const result: MacNativeExecution = { pid: child.pid, startedAt, endedAt: new Date().toISOString(), durationMs: performance.now() - started,
      deadlineMs: 20_000, timedOut, reaped: true, exitCode: exit.value, signal: child.signalCode,
      stdout: captured.value[0], stderr: captured.value[1], observations: await Promise.all(observations) };
    record(result); return result;
  } finally { clearTimeout(deadline); if (!exited) child.kill('SIGKILL'); }
}
