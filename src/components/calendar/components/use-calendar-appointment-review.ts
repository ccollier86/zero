import { useEffect, useRef, useSyncExternalStore } from 'react';
import { CalendarAppointmentReviewController } from '../models/calendar-appointment-review-controller';
export function useCalendarAppointmentReview(options: ConstructorParameters<typeof CalendarAppointmentReviewController>[0], basis: string | null) {
  const latest = useRef(options); latest.current = options;
  const controller = useRef<CalendarAppointmentReviewController | null>(null);
  if (!controller.current) controller.current = new CalendarAppointmentReviewController({
    isCurrent: (context, key) => latest.current.isCurrent(context, key), createKey: () => latest.current.createKey(),
    onEdit: () => latest.current.onEdit(), onAuthorityLost: () => latest.current.onAuthorityLost(),
  });
  const prior = useRef(basis);
  useEffect(() => { if (prior.current !== basis) { prior.current = basis; controller.current!.invalidate(); } }, [basis]);
  useEffect(() => () => controller.current!.invalidate(), []);
  const state = useSyncExternalStore(controller.current.subscribe, controller.current.snapshot, controller.current.snapshot);
  return { review: controller.current, state };
}
