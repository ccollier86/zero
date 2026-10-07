import { expect, test } from 'bun:test';
import { GuardianPresenceActivity } from './guardian-presence-activity';

test('one activity tracker reports heartbeats without inventing human activity, and resets on reconnect', () => {
  const target = new EventTarget(), visibility = new EventTarget(); let now = 0, visible = true;
  let tick = () => {}, scheduled = 0, cancelled = 0;
  const reports: Array<{ sequence: number; activity: boolean; visible: boolean }> = [];
  const tracker = new GuardianPresenceActivity(value => { reports.push(value); return true; }, {
    target, visibility, isVisible: () => visible, now: () => now,
    schedule(callback) { tick = callback; ++scheduled; return 1 as never; }, cancel() { ++cancelled; },
  });
  tracker.start(10_000); tracker.start(10_000);
  expect(scheduled).toBe(1); expect(reports[0]).toEqual({ sequence: 1, activity: false, visible: true });
  target.dispatchEvent(new Event('keydown')); now = 5_000; tick();
  expect(reports.at(-1)?.activity).toBe(true);
  now = 15_000; tick(); expect(reports.at(-1)?.activity).toBe(false);
  visible = false; visibility.dispatchEvent(new Event('visibilitychange'));
  expect(reports.at(-1)?.visible).toBe(false);
  tracker.stop(); target.dispatchEvent(new Event('keydown')); tick(); expect(cancelled).toBe(1);
  visible = true; tracker.start(10_000); expect(reports.at(-1)).toEqual({ sequence: 1, activity: false, visible: true }); tracker.stop();
});
test('dropped or hidden activity expires instead of replaying stale observations', () => {
  let now = 0, writable = false, tick = () => {}; const target = new EventTarget(), reports: boolean[] = [];
  const tracker = new GuardianPresenceActivity(value => { if (writable) reports.push(value.activity); return writable; }, {
    target, visibility: new EventTarget(), isVisible: () => true, now: () => now,
    schedule(callback) { tick = callback; return 1 as never; }, cancel() {},
  });
  tracker.start(10_000); target.dispatchEvent(new Event('pointermove')); tick();
  now = 40_000; writable = true; tick(); expect(reports).toEqual([false]); tracker.stop();
});
