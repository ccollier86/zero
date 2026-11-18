/** Native source composition preserves independent logging and dispatch lifetimes. */
import type { DatabaseCoordinator } from '../databases/database-coordinator';
import { CalendarError } from './error';
import type { CalendarRuntimeSource } from './runtime';

export type CalendarRuntimeSourceFactory = (owner: DatabaseCoordinator) => CalendarRuntimeSource | Promise<CalendarRuntimeSource>;

/** Construct incrementally so a later factory failure cannot orphan an installed source. */
export function composeCalendarRuntimeSources(...factories: readonly CalendarRuntimeSourceFactory[]): CalendarRuntimeSourceFactory {
  return async owner => {
    const sources: CalendarRuntimeSource[] = [];
    const closeAll = async () => {
      const failures: unknown[] = [];
      for (const source of [...sources].reverse()) try { await source.close(); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, 'Calendar sources failed to close.');
    };
    try { for (const factory of factories) sources.push(await factory(owner)); }
    catch (error) {
      try { await closeAll(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'Calendar source construction and cleanup failed.'); }
      throw error;
    }
    let closing = false, closeTask: Promise<void> | null = null;
    return {
      prepare(record) {
        if (closing) throw new CalendarError('CALENDAR_NOT_READY');
        for (const source of sources) source.prepare(record);
      },
      wake(ref) {
        if (closing) return;
        for (const source of sources) try { source.wake(ref); } catch { /* Advisory failures must not suppress another source's wake. */ }
      },
      close() {
        if (closeTask) return closeTask;
        closing = true; const task = closeAll(); closeTask = task;
        void task.catch(() => { if (closeTask === task) closeTask = null; });
        return task;
      },
    };
  };
}
