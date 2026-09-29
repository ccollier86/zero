/**
 * subprocess-database-executor-lifecycle.ts
 *
 * Reusable promise deadlines and child-process termination mechanics for the
 * subprocess executor. Policy and public lifecycle state stay in the facade.
 */

import type { DatabaseError } from './database-error';

export type DatabaseExecutorProcess = Bun.Subprocess<
  'ignore',
  'ignore',
  'ignore'
>;

export interface DatabaseExecutorDeferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: DatabaseError) => void;
}

interface ProcessObservationCallbacks {
  readonly observeNoProcessSettlement: () => void;
  readonly captureSettledProcess: (child: DatabaseExecutorProcess) => void;
}

interface WaitForProcessExitOptions extends ProcessObservationCallbacks {
  readonly child: DatabaseExecutorProcess | null;
  readonly exitObserved: boolean;
  readonly timeoutMs: number;
}

interface TerminateProcessOptions extends ProcessObservationCallbacks {
  readonly child: DatabaseExecutorProcess | null;
  readonly exitObserved: boolean;
  readonly sigtermTimeoutMs: number;
  readonly sigkillTimeoutMs: number;
}

export interface DatabaseExecutorProcessDiagnostics {
  readonly exitObserved: boolean;
  readonly settled: boolean;
  readonly exitCode: number | null;
  readonly signalCode: string | number | null;
}

/** Owns settlement evidence and retryable termination for one child generation. */
export class DatabaseExecutorProcessSettlement {
  private readonly deferred = createDatabaseExecutorDeferred<void>();
  private readonly onSettlement: () => void;
  private terminationTask: Promise<boolean> | null = null;
  private _exitObserved = false;
  private _settled = false;
  private _exitCode: number | null = null;
  private _signalCode: string | number | null = null;

  constructor(onSettlement: () => void) {
    this.onSettlement = onSettlement;
  }

  get exitObserved(): boolean {
    return this._exitObserved;
  }

  get settledObserved(): boolean {
    return this._settled;
  }

  settled(): Promise<void> {
    return this.deferred.promise;
  }

  diagnostics(): DatabaseExecutorProcessDiagnostics {
    return {
      exitObserved: this._exitObserved,
      settled: this._settled,
      exitCode: this._exitCode,
      signalCode: this._signalCode,
    };
  }

  observeExit(
    exitCode: number | null,
    signalCode: string | number | null,
  ): void {
    this._exitObserved = true;
    this._exitCode = exitCode;
    this._signalCode = signalCode;
    this.observeSettlement();
  }

  captureSettledProcess(child: DatabaseExecutorProcess): void {
    this.observeExit(child.exitCode, child.signalCode);
  }

  observeNoProcessSettlement(child: DatabaseExecutorProcess | null): void {
    if (child) return;
    this.observeSettlement();
  }

  async ensureTerminated(
    terminate: () => Promise<boolean>,
  ): Promise<boolean> {
    const existing = this.terminationTask;
    if (existing) return await existing;

    const task = terminate();
    this.terminationTask = task;
    const terminated = await task;
    // A timed-out attempt is not settlement and must not be cached as one.
    // Keep successful completion stable, but permit an explicit later retry.
    if (!terminated && this.terminationTask === task) {
      this.terminationTask = null;
    }
    return terminated;
  }

  private observeSettlement(): void {
    if (this._settled) return;
    this._settled = true;
    this.deferred.resolve(undefined);
    this.onSettlement();
  }
}

export function createDatabaseExecutorDeferred<T>(): DatabaseExecutorDeferred<T> {
  let settled = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: DatabaseError) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value) {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
    reject(error) {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    },
  };
}

export async function promiseWithDatabaseExecutorTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  createError: () => DatabaseError,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(createError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Cooperatively terminate one exact child generation, escalating if needed. */
export async function terminateDatabaseExecutorProcess(
  options: TerminateProcessOptions,
): Promise<boolean> {
  const child = options.child;
  if (!child) {
    options.observeNoProcessSettlement();
    return true;
  }
  if (options.exitObserved || child.exitCode !== null) {
    options.captureSettledProcess(child);
    return true;
  }

  try {
    child.kill('SIGTERM');
  } catch {
    // The process may have exited between the state check and signal send.
  }
  if (await waitForDatabaseExecutorProcessExit({
    ...options,
    timeoutMs: options.sigtermTimeoutMs,
  })) {
    return true;
  }

  try {
    child.kill('SIGKILL');
  } catch {
    // The process may have exited between deadline escalation and signal send.
  }
  return await waitForDatabaseExecutorProcessExit({
    ...options,
    timeoutMs: options.sigkillTimeoutMs,
  });
}

/** Wait for process settlement without depending on callback/promise ordering. */
export async function waitForDatabaseExecutorProcessExit(
  options: WaitForProcessExitOptions,
): Promise<boolean> {
  const child = options.child;
  if (!child) {
    options.observeNoProcessSettlement();
    return true;
  }
  if (options.exitObserved || child.exitCode !== null) {
    options.captureSettledProcess(child);
    return true;
  }
  const exited = await settlesWithin(child.exited, options.timeoutMs);
  if (exited) {
    // Bun may settle `exited` just before `onExit`; capture observable state
    // here so caller settlement never depends on callback ordering.
    options.captureSettledProcess(child);
  }
  return exited;
}

async function settlesWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
