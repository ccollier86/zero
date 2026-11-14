import { suggestedTitle } from './appointment-types';
import type { EventDraft } from '../types';
import { appearanceOf, isEnded, visitOf } from './appointment-presentation';
/** Auto titles follow the type/people until the user explicitly chooses their own. */
export function updateAppointmentDraft(current: EventDraft, changes: Partial<EventDraft>): EventDraft {
  const next = { ...current, ...changes };
  if (!changes.visit && (['date', 'resourceId', 'start', 'end'] as const).some(key => changes[key] !== undefined && changes[key] !== current[key])) {
    next.visit = visitOf({});
    if (appearanceOf(current).attention === 'running-late' && !changes.appearance) next.appearance = { ...appearanceOf(current), attention: 'none' };
  }
  if (changes.location && changes.location !== current.location && !changes.visit) next.visit = { ...visitOf(next), waitingRoom: 'none' };
  if (changes.status && isEnded(changes.status)) next.visit = { ...visitOf(next), stage: 'scheduled', waitingRoom: 'none' };
  if (changes.title !== undefined && changes.titleMode === undefined) next.titleMode = 'custom';
  if (next.kind === 'appointment' && next.titleMode === 'automatic') next.title = suggestedTitle(next.visitType, next.customVisitType, next.attendees);
  return next;
}
