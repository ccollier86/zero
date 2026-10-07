/** POSIX group ownership for one detached Bun child; never enumerates or signals unrelated processes. */

export interface TestSuiteOwnedProcessGroup {
  signal(signal: 'SIGTERM' | 'SIGKILL'): void;
  retireAfterExit(): Promise<{ leakedDescendants: boolean; cleanupIncomplete: boolean; cleanupError?: string }>;
}

/** Capture only the fresh child's setsid-established PGID; no Bun-native group-signal API exists. */
export function captureTestSuiteProcessGroup(child: Bun.Subprocess): TestSuiteOwnedProcessGroup {
  const pgid = child.pid;
  if (!Number.isSafeInteger(pgid) || pgid <= 1) throw new Error('Detached test child has no safe owned process-group identity.');
  const exists = () => {
    try { process.kill(-pgid, 0); return true; }
    catch (error) {
      if ((error as { code?: string }).code === 'ESRCH') return false;
      throw error;
    }
  };
  const signal = (value: 'SIGTERM' | 'SIGKILL') => {
    // Bun's process.kill compatibility is needed only for negative-PGID signaling.
    try { process.kill(-pgid, value); }
    catch (error) { if ((error as { code?: string }).code !== 'ESRCH') throw error; }
  };
  const waitForExit = async (milliseconds: number) => {
    const deadline = performance.now() + milliseconds;
    while (true) {
      let pendingPermissionError: unknown;
      try { if (!exists()) return true; }
      catch (error) {
        // Darwin can briefly report EPERM for signal-zero while a successfully killed group is reaped.
        // It is indeterminate, never absence: require a later actual ESRCH within this same deadline.
        if ((error as { code?: string }).code !== 'EPERM') throw error;
        pendingPermissionError = error;
      }
      if (performance.now() >= deadline) {
        if (pendingPermissionError) throw pendingPermissionError;
        return false;
      }
      await Bun.sleep(10);
    }
  };
  return {
    signal,
    async retireAfterExit() {
      let cleanupError: string | undefined;
      try {
        // An orderly browser/actor close can finish just after its leader exits.
        if (await waitForExit(250)) return { leakedDescendants: false, cleanupIncomplete: false };
        signal('SIGKILL');
      } catch (error) { cleanupError = error instanceof Error ? error.message : 'Owned process-group cleanup failed.'; }
      try {
        return { leakedDescendants: true, cleanupIncomplete: !await waitForExit(1000), ...(cleanupError ? { cleanupError } : {}) };
      } catch (error) {
        return { leakedDescendants: true, cleanupIncomplete: true,
          cleanupError: cleanupError ?? (error instanceof Error ? error.message : 'Owned process-group retirement could not be verified.') };
      }
    },
  };
}
