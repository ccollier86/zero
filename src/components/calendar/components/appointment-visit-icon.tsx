/** Composable calendar VisitIcon; presentation only. */
import { IconVideo } from './calendar-icons';
import { CheckIcon, ClockIcon, CompleteIcon, EyeIcon, PeopleIcon, PinIcon } from './prototype-icons';
import { isEnded, visitOf } from '../models/appointment-presentation';
import type { EventDraft } from '../types';
import '../styles/appointment-presentation.css';
const nested = { 'data-mantine-stop-propagation': true };
export function VisitIcon({ event, clinical = true, size = 'var(--calendar-size-13)' }: { event: EventDraft; clinical?: boolean; size?: number | string }) {
  const visit = visitOf(event);
  if (event.status === 'completed') return <CompleteIcon size={size} />;
  if (isEnded(event.status)) return <ClockIcon size={size} />;
  if (clinical && visit.stage === 'waiting') return visit.waitingRoom === 'virtual' ? <IconVideo size={size} aria-hidden="true" /> : visit.waitingRoom === 'office' ? <PinIcon size={size} /> : <PeopleIcon size={size} />;
  if (clinical && visit.stage === 'in-session') return <EyeIcon size={size} />;
  if (clinical && visit.stage !== 'scheduled') return <PeopleIcon size={size} />;
  return event.status === 'confirmed' ? <CheckIcon size={size} /> : <ClockIcon size={size} />;
}
