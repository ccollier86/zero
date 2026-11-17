/** Commit-driven invalidation with bounded authority checks. Never publishes rows from a raw database subscription. */
import { admitCalendarRequest, type CalendarAuthority } from './authority';
import type { ResolvedCalendarConfig } from './config';
import type { CalendarRangeQuery, CalendarWatchOptions, CalendarWatchUpdate } from './contracts';
import type { CalendarServiceBroker } from './service';
import { CalendarError } from './error';
import { calendarRecord } from './validation';

type CalendarWatchQuery = { queryName?: 'calendar.appointments'; query: CalendarRangeQuery }
  | { queryName: 'calendar.blocks'; query: CalendarRangeQuery }
  | { queryName: 'calendar.availability'; query: { readonly id: string } };
export function watchCalendarPage<T>(input: {
  request: CalendarAuthority; broker: CalendarServiceBroker; config: ResolvedCalendarConfig; closing: AbortSignal;
  /** Fixed by the canonical facade, never selected by authored input. Omission preserves appointment callers. */
  listener: (page: T, update?: CalendarWatchUpdate) => void;
  options: CalendarWatchOptions; track: <T>(task: Promise<T>) => Promise<T>;
} & CalendarWatchQuery): () => void {
  const options = calendarRecord(input.options, ['signal', 'onError']);
  const queryName = input.queryName ?? 'calendar.appointments';
  if (!['calendar.appointments', 'calendar.blocks', 'calendar.availability'].includes(queryName)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  if (typeof input.listener !== 'function' || options.onError !== undefined && typeof options.onError !== 'function'
    || options.signal !== undefined && !(options.signal instanceof AbortSignal)
    || input.request.signal !== undefined && !(input.request.signal instanceof AbortSignal)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const stop = new AbortController(), signal = AbortSignal.any([input.closing, stop.signal,
    ...(input.request.signal ? [input.request.signal] : []), ...(options.signal ? [options.signal as AbortSignal] : [])]);
  let closed = false, remove: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let active = false, pending = false, invalidated = false, last = '';
  const close = () => {
    if (closed) return; closed = true; pending = false; invalidated = false; last = ''; stop.abort();
    const unsubscribe = remove; remove = undefined;
    try { unsubscribe?.(); } finally { clearTimeout(timer); timer = undefined; signal.removeEventListener('abort', close); }
  };
  signal.addEventListener('abort', close, { once: true });
  if (signal.aborted) { close(); return close; }
  const failure = (error: unknown) => { if (closed) return; close(); try { (options.onError as CalendarWatchOptions['onError'])?.(error); } catch { /* Observer exceptions never retain authority. */ } };
  input.track((async () => {
    const authority = await admitCalendarRequest(input.request, input.config, signal);
    if (closed) return;
    authority.guard();
    const refresh = () => {
      if (closed) return;
      pending = true;
      if (active) return;
      active = true;
      void input.track((async () => {
        while (pending && !closed) {
          pending = false;
          const changed = invalidated; invalidated = false;
          await authority.confirm();
          authority.guard();
          const page = await input.broker.read<T>(authority.scope, queryName,
            { ...input.query, actor: authority.actor }, authority.guard, authority.signal);
          await authority.confirm();
          if (closed) return;
          authority.guard();
          const serialized = JSON.stringify(page);
          if (serialized !== last || changed) { last = serialized; input.listener(page, { invalidated: changed }); }
        }
      })()).catch(failure).finally(() => {
        active = false;
        if (!closed) { clearTimeout(timer); timer = setTimeout(refresh, 5_000); timer.unref?.(); }
      });
    };
    const unsubscribe = input.broker.subscribe?.(authority.scope, () => { invalidated = true; refresh(); });
    // Installation may synchronously retire this request. Its returned removal
    // capability still belongs to this watch, even if close ran before assignment.
    if (closed) { unsubscribe?.(); return; }
    remove = unsubscribe;
    // Subscribe before the first query so an intervening commit cannot disappear in the initial snapshot race.
    refresh();
  })()).catch(failure);
  return close;
}
