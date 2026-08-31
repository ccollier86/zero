/**
 * animation-loop.ts
 *
 * Schedules the next animated-icon loop on a timer task. A zero delay must
 * still yield to the browser so a missing Motion subscriber cannot create an
 * endless microtask chain that starves rendering, input, and network events.
 */

export function scheduleAnimationLoopTurn(
  delay: number,
  callback: () => void,
): ReturnType<typeof setTimeout> {
  return setTimeout(callback, Math.max(0, delay));
}
