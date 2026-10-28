import { expect, test } from 'bun:test';
import { NotificationFeedback, type NotificationSoundKind } from './notification-feedback';
import { createNotificationAudio, notificationSoundOptions, type NotificationSoundStatus } from './notification-audio';
import { liveNotificationInsert, type Notification } from './notification-hooks';
function notice(id: string, conversationId?: string): Notification {
  return { notification_id: id, title: 'Synthetic notice', metadata: conversationId ? JSON.stringify({ zero: { version: 1, kind: 'chat', conversationId, messageId: 'message-' + id } }) : null,
    type: 'info', priority: 'normal', body: null, target_type: 'user', target_value: 'user-one', sender_id: null, action_url: null, created_at: 1, expires_at: null };
}
test('active-conversation suppression, other conversations, one cue and independent canonical state', () => {
  const played: NotificationSoundKind[] = []; let active = true;
  const feedback = new NotificationFeedback(() => true, kind => played.push(kind));
  const dispose = feedback.registerConversation('one', () => active);
  const same = notice('one', 'one'); feedback.observe(same);
  expect(feedback.claimToast(same)).toBe(false); expect(played).toEqual([]);
  active = false; feedback.observe(same); expect(feedback.claimToast(same)).toBe(false); expect(played).toEqual([]);
  const other = notice('two', 'two'); feedback.observe(other); feedback.observe(other);
  expect(feedback.claimToast(other)).toBe(true); expect(feedback.claimToast(other)).toBe(false);
  const duplicate = { ...other, notification_id: 'same-message-different-notice' };
  feedback.observe(duplicate); expect(feedback.claimToast(duplicate)).toBe(false);
  feedback.observe(notice('general')); expect(played).toEqual(['chat', 'notification']);
  dispose(); feedback.observe(notice('three', 'one')); expect(played).toEqual(['chat', 'notification', 'chat']);
  expect(same).toEqual(notice('one', 'one')); // No read/seen/dismiss or source mutation.
});
test('scope retirement, expired alerts and bounded decisions fail quiet without retaining another scope', () => {
  let current = true, played = 0;
  const feedback = new NotificationFeedback(() => current, () => played++);
  feedback.observe({ ...notice('expired'), expires_at: Date.now() - 1 }); expect(played).toBe(0);
  for (let i = 0; i < 2100; i++) feedback.observe(notice(String(i)));
  expect(played).toBe(2100); expect((feedback as unknown as { decisions: Map<string, unknown> }).decisions.size).toBe(2048);
  current = false; feedback.observe(notice('retired')); expect(feedback.claimToast(notice('retired'))).toBe(false); expect(played).toBe(2100);
  const replacement = new NotificationFeedback(() => true, () => played++); replacement.observe(notice('retired')); expect(played).toBe(2101);
});
test('only live inserts alert; snapshots, reconnect catchup, cache/receipt updates never replay history', () => {
  const row = notice('one');
  expect(liveNotificationInsert({ type: 'sync.change', table: 'notifications', op: 'INSERT', row })).toBe(row);
  for (const event of [
    { type: 'sync.snapshot', tables: { notifications: [row] } },
    { type: 'sync.catchup', changes: [{ table: 'notifications', op: 'INSERT', row }] },
    { type: 'sync.change', table: 'notifications', op: 'UPDATE', row },
    { type: 'sync.change', table: 'notification_receipts', op: 'INSERT', row },
    { type: 'sync.ack', change: { table: 'notifications', op: 'INSERT', row } },
    { type: 'sync.change', table: 'notifications', op: 'INSERT', row: {} },
  ]) expect(liveNotificationInsert(event)).toBeNull();
});
test('sound configuration is opt-in, independently selectable and bounded', () => {
  expect(notificationSoundOptions(undefined)).toEqual({ chat: false, notifications: false, muted: false, volume: 0.5 });
  expect(notificationSoundOptions(true)).toEqual({ chat: true, notifications: true, muted: false, volume: 0.5 });
  expect(notificationSoundOptions({ chat: true, volume: Infinity }).volume).toBe(0.5);
  expect(notificationSoundOptions({ notifications: true, volume: 4 }).volume).toBe(1);
  expect(notificationSoundOptions({ volume: -1 }).volume).toBe(0);
});

test('blocked autoplay is quiet/recoverable; unlocking and retired audio never queue an old cue', async () => {
  const savedAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio'), savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const created: TestAudio[] = [], statuses: NotificationSoundStatus[] = [];
  let rejectPlay = true;
  class TestAudio {
    volume = 1; preload = ''; currentTime = 0; src: string; pauses = 0; audible = 0;
    constructor(src: string) { this.src = src; created.push(this); }
    pause() { this.pauses++; }
    load() {}
    removeAttribute(name: string) { if (name === 'src') this.src = ''; }
    play() { if (this.volume > 0) this.audible++; return rejectPlay ? Promise.reject(new Error('Synthetic autoplay denied')) : Promise.resolve(); }
  }
  const restore = (key: 'Audio' | 'document', original: PropertyDescriptor | undefined) => {
    if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key);
  };
  let owner: ReturnType<typeof createNotificationAudio> | undefined;
  try {
    Object.defineProperty(globalThis, 'Audio', { configurable: true, value: TestAudio });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: new EventTarget() });
    owner = createNotificationAudio(notificationSoundOptions(true), status => statuses.push(status));
    const until = Date.now() + 2000;
    while (!statuses.includes('locked')) { if (Date.now() >= until) throw new Error('Synthetic media did not load.'); await new Promise(resolve => setTimeout(resolve, 5)); }
    expect(created).toHaveLength(2);
    owner.play('chat'); expect(created.reduce((total, audio) => total + audio.audible, 0)).toBe(0);
    owner.unlock(); await Promise.resolve(); await Promise.resolve();
    expect(statuses.at(-1)).toBe('blocked');
    rejectPlay = false; owner.unlock(); owner.play('chat'); await Promise.resolve();
    expect(statuses.at(-1)).toBe('ready'); expect(created.reduce((total, audio) => total + audio.audible, 0)).toBe(0);
    owner.play('chat'); owner.play('notification');
    expect(created.map(audio => audio.audible)).toEqual([1, 0]); // One shared burst, no overlapping general cue.
    owner.dispose(); owner.play('notification'); owner.unlock();
    expect(created.map(audio => audio.audible)).toEqual([1, 0]); expect(created.every(audio => audio.pauses > 0 && audio.src === '')).toBe(true);
    const off = createNotificationAudio(notificationSoundOptions(undefined), status => statuses.push(status));
    off.unlock(); off.play('chat'); off.dispose(); expect(statuses.at(-1)).toBe('disabled'); expect(created).toHaveLength(2);
  } finally { owner?.dispose(); restore('Audio', savedAudio); restore('document', savedDocument); }
});
