/** Controlled visit drafting only. Current eligibility and assignment checks remain server-owned. */
import type { CalendarLocationSnapshot, CalendarLocationPage, CalendarVisitInput, CalendarVisitSnapshot } from '../../../calendar/contracts';
import type { CalendarCoreDraft } from './calendar-workspace-model';
export function calendarVisitDraft(visit?: CalendarVisitSnapshot): Pick<CalendarCoreDraft, 'visitMode' | 'visitLocation'> {
  return visit ? { visitMode: visit.mode, ...(visit.mode === 'in-person' ? { visitLocation: { ...visit.location } } : {}) }
    : { visitMode: 'unspecified' };
}
export function calendarLocationVersion(location: Pick<CalendarLocationSnapshot, 'id' | 'revision'>): string {
  return JSON.stringify([location.id, location.revision]);
}
/** Only an accepted source binding may outlive the current picker page as named history. */
export function calendarVisitSelectionCurrent(draft: Pick<CalendarCoreDraft, 'visitMode' | 'visitLocation'>,
  page: CalendarLocationPage | null, accepted?: CalendarLocationSnapshot): boolean {
  if (draft.visitMode !== 'in-person') return true;
  const selected = draft.visitLocation;
  if (!selected) return false;
  const version = calendarLocationVersion(selected);
  return page?.items.some(item => calendarLocationVersion(item) === version) === true
    || accepted !== undefined && calendarLocationVersion(accepted) === version;
}
export function calendarVisitDraftInput(draft: Pick<CalendarCoreDraft, 'visitMode' | 'visitLocation'>, original?: CalendarVisitSnapshot):
  { visit?: CalendarVisitInput | null } | { error: string } {
  const mode = draft.visitMode ?? 'unspecified';
  if (mode === 'unspecified') return original ? { visit: null } : {};
  if (!['in-person', 'phone', 'video'].includes(mode)) return { error: 'Choose a supported visit mode.' };
  let visit: CalendarVisitInput;
  if (mode === 'in-person') {
    const location = draft.visitLocation;
    if (!location || location.id.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(location.id)
      || !Number.isSafeInteger(location.revision) || location.revision < 1) return { error: 'Choose an authorized location for the in-person visit.' };
    visit = { mode, location: { id: location.id, revision: location.revision } };
  } else visit = { mode };
  if (original?.mode === visit.mode && (visit.mode !== 'in-person'
    || original.mode === 'in-person' && calendarLocationVersion(original.location) === calendarLocationVersion(visit.location))) return {};
  return { visit };
}
export function calendarVisitLabel(visit?: CalendarVisitSnapshot): string {
  return !visit ? 'Visit mode unspecified' : visit.mode === 'in-person' ? `In-person · ${visit.location.label}`
    : visit.mode === 'video' ? 'Video visit' : 'Phone visit';
}
