/** Framework-private awaitable entry before a synchronous database transaction. */
import type { ReactiveDB } from './reactive-db';

export interface ReactiveDBCommitAdmissionOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

type Admission = <T>(operation: () => T, options: ReactiveDBCommitAdmissionOptions) => Promise<T>;
const admissions = new WeakMap<ReactiveDB, Admission>();

/** Installed alongside the final commit guard; not part of the public DB facade. */
export function registerReactiveDBCommitAdmission(db: ReactiveDB, admit: Admission): () => void {
  if (admissions.has(db)) throw new TypeError('ReactiveDB commit admission is already installed');
  admissions.set(db, admit);
  return () => { if (admissions.get(db) === admit) admissions.delete(db); };
}

/** Wait without SQLite locks, then execute exactly once with all commit guards. */
export async function withReactiveDBCommitAdmission<T>(
  db: ReactiveDB, operation: () => T, options: ReactiveDBCommitAdmissionOptions = {},
): Promise<T> {
  const admit = admissions.get(db);
  const run = () => {
    // Existing stores own their transaction/rollback sentinels. An extra outer
    // transaction would turn a caught admission rejection into rollback-only.
    const result = operation();
    if (result !== null && (typeof result === 'object' || typeof result === 'function')
      && typeof (result as { then?: unknown }).then === 'function') {
      void Promise.resolve(result).catch(() => undefined);
      throw new TypeError('Commit admission operations must be synchronous');
    }
    return result;
  };
  return admit ? admit(run, options) : run();
}
