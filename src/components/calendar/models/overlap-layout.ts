/** Allocate real overlap lanes without hiding, stretching or duplicating any event. */
import type { ScheduleEvent } from '../types';
export interface EventLane { event: ScheduleEvent; lane: number; lanes: number }
export function eventLanes(events: readonly ScheduleEvent[]): EventLane[] {
  const sorted = [...events].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const groups: ScheduleEvent[][] = [];
  let end = -Infinity;
  for (const event of sorted) {
    if (event.start >= end) { groups.push([]); end = event.end; }
    groups[groups.length - 1]!.push(event); end = Math.max(end, event.end);
  }
  return groups.flatMap(group => {
    const ends: number[] = [], allocated: Array<{ event: ScheduleEvent; lane: number }> = [];
    for (const event of group) {
      let lane = ends.findIndex(until => until <= event.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = event.end; allocated.push({ event, lane });
    }
    return allocated.map(item => ({ ...item, lanes: ends.length }));
  });
}
