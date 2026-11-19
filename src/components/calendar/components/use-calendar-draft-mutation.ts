'use client';
/** React subscription only; mutation decisions and recovery remain in the UI-free controller. */
import { useRef, useSyncExternalStore } from 'react';
import { CalendarDraftMutationController, type CalendarDraftMutationOptions } from '../models/calendar-draft-mutation-controller';

export function useCalendarDraftMutation(options: CalendarDraftMutationOptions) {
  const latest = useRef(options); latest.current = options;
  const controller = useRef<CalendarDraftMutationController | null>(null);
  if (!controller.current) controller.current = new CalendarDraftMutationController({
    isCurrent: context => latest.current.isCurrent(context),
    readReceipt: (key, signal) => latest.current.readReceipt(key, signal),
    onUnknown: request => latest.current.onUnknown(request), onRejected: request => latest.current.onRejected(request),
    onAccepted: request => latest.current.onAccepted(request), onAuthorityLost: () => latest.current.onAuthorityLost(),
  });
  const state = useSyncExternalStore(controller.current.subscribe, controller.current.snapshot, controller.current.snapshot);
  return { controller: controller.current, state };
}
