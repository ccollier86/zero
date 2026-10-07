/** Real-process ownership race harness; no shared JavaScript SQLite handles. */
export interface OwnerAcquisitionOutcome {
  ok: boolean;
  ownerId: string;
  code?: string;
  status?: number;
  message?: string;
}

interface AcquisitionChild {
  ready: Promise<void>;
  completed: Promise<OwnerAcquisitionOutcome>;
  start(): void;
  stop(): Promise<void>;
}

interface AcquisitionOptions {
  timeoutMs?: number;
  /** Test-only protocol failure fixtures; never a production actor override. */
  childEntrypoint?: string;
}

const CHILD = Bun.fileURLToPath(new URL('../test-fixtures/workflow-owner-acquisition-child.ts', import.meta.url));

/** Both children must open independently before either receives acquisition admission. */
export async function acquireWorkflowOwnersSimultaneously(
  databasePath: string,
  ownerIds: readonly [string, string],
  options: AcquisitionOptions = {},
): Promise<OwnerAcquisitionOutcome[]> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error('Workflow ownership timeoutMs must be an integer between 1 and 60000.');
  }
  const children: AcquisitionChild[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    for (const ownerId of ownerIds) children.push(startChild(databasePath, ownerId, options.childEntrypoint ?? CHILD));
    const operation = (async () => {
      await Promise.all(children.map(child => child.ready));
      // IPC start is a shared readiness barrier, not staggered acquisition.
      for (const child of children) child.start();
      return Promise.all(children.map(child => child.completed));
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Workflow ownership subprocess race timed out.')), timeoutMs);
    });
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // Join process exit before the caller can close parent handles/remove files.
    await Promise.all(children.map(child => child.stop()));
  }
}

function startChild(databasePath: string, ownerId: string, entrypoint: string): AcquisitionChild {
  const executable = Bun.argv[0];
  if (!executable) throw new Error('Bun executable is unavailable for the ownership race.');
  const ready = Promise.withResolvers<void>();
  const result = Promise.withResolvers<OwnerAcquisitionOutcome>();
  void ready.promise.catch(() => {});
  void result.promise.catch(() => {});
  let readyReceived = false, started = false, resultReceived = false;
  let protocolFailure: Error | null = null;
  const fail = (error: Error) => { protocolFailure ??= error; ready.reject(error); result.reject(error); };
  const child = Bun.spawn({
    cmd: [executable, '--no-env-file', entrypoint, databasePath, ownerId],
    cwd: import.meta.dir,
    env: {},
    stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
    ipc(message: unknown) {
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        fail(new Error('Workflow ownership child sent an invalid IPC message.')); return;
      }
      const value = message as Record<string, unknown>;
      if (value.type === 'ready' && value.ownerId === ownerId && !readyReceived && !resultReceived) {
        readyReceived = true; ready.resolve(); return;
      }
      if (value.type === 'result' && readyReceived && started && !resultReceived && value.disposed === true) {
        const outcome = readOutcome(value.outcome, ownerId);
        if (outcome) { resultReceived = true; result.resolve(outcome); return; }
      }
      fail(new Error('Workflow ownership child violated the ready/start/disposed-result protocol.'));
    },
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  const exited = child.exited.then(async exitCode => {
    const errorOutput = await stderr;
    await stdout;
    if (protocolFailure) throw protocolFailure;
    if (exitCode !== 0 || child.signalCode !== null || !resultReceived) {
      const error = new Error(`Workflow ownership child failed before clean disposed-result exit (code ${exitCode}, signal ${child.signalCode ?? 'none'}).${errorOutput ? `\n${errorOutput.slice(0, 4000)}` : ''}`);
      fail(error); throw error;
    }
  });
  const completed = Promise.all([result.promise, exited]).then(([outcome]) => outcome);
  void completed.catch(() => {});
  return {
    ready: ready.promise,
    completed,
    start() { started = true; child.send({ type: 'start', ownerId }); },
    async stop() {
      let escalation: ReturnType<typeof setTimeout> | undefined;
      try {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM');
          escalation = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          }, 1000);
        }
        await child.exited;
        await Promise.all([stdout, stderr]);
      } finally {
        if (escalation !== undefined) clearTimeout(escalation);
      }
    },
  };
}

function readOutcome(input: unknown, ownerId: string): OwnerAcquisitionOutcome | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (typeof value.ok !== 'boolean' || value.ownerId !== ownerId) return null;
  if (value.ok) return { ok: true, ownerId };
  if (typeof value.code !== 'string' || typeof value.status !== 'number' || !Number.isInteger(value.status)
    || typeof value.message !== 'string') return null;
  return { ok: false, ownerId, code: value.code, status: value.status, message: value.message };
}
