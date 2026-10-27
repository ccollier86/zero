import { expect, test } from 'bun:test';
import { MessagingWorkspaceController } from './messaging-workspace-controller';
import { workspaceFixture, workspaceMessage } from './workspace.test-fixtures';
import { MessagingLiveError } from '../../messaging/live-error';
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('selection never marks read; live append/backfill retain rows and historical edits/reactions remain live', async () => {
  const f = workspaceFixture(), owner = new MessagingWorkspaceController(f.source, 'me', { isCurrent: f.current });
  try {
    await owner.start(); await owner.select('one'); await flush();
    expect(owner.getSnapshot().messages.map(row => row.sequence)).toEqual(Array.from({ length: 50 }, (_, i) => i + 21)); expect(f.reads).toEqual([]);
    const retained = owner.getSnapshot().messages[0]; await owner.older(); await flush();
    expect(owner.getSnapshot().messages).toHaveLength(70); expect(owner.getSnapshot().messages[20]).toBe(retained);
    f.messages[0] = { ...f.messages[0]!, revision: 2, text: 'Edited retained message', reactions: [{ emoji: '👍', count: 1, selected: false }] }; f.emit();
    expect(owner.getSnapshot().messages[0]?.text).toBe('Edited retained message');
    f.messages.push(workspaceMessage(71)); f.emit(); expect(owner.getSnapshot().messages.at(-1)?.sequence).toBe(71);
    expect(f.reads).toEqual([]); await owner.markPresented(71); await owner.markPresented(70);
    expect(f.reads).toEqual([71]); expect(owner.getSnapshot().conversation?.unreadCount).toBe(0);
  } finally { owner.dispose(); }
});
test('uncertain sends are locked, reconcile edited accepted messages, and explicit retries retain the exact key and pinned intent', async () => {
  const f = workspaceFixture(1), owner = new MessagingWorkspaceController(f.source, 'me', { isCurrent: f.current });
  try {
    await owner.start(); await owner.select('one'); owner.edit('Original draft');
    const original = f.mutable.messages.send; let lose = true;
    f.mutable.messages.send = async (...args) => { const result = await original(...args); if (lose) { lose = false; throw new Error('Synthetic response lost'); } return result; };
    await owner.send(); expect(owner.getSnapshot().draft.phase).toBe('unknown'); owner.edit('Must not replace the uncertain intent');
    await owner.send(); expect(f.sends).toHaveLength(1); expect(owner.getSnapshot().draft.text).toBe('Original draft');
    await owner.reconcileSend(); expect(owner.getSnapshot().draft.phase).toBe('unknown');
    const sent = f.sends[0]!; f.mutable.receipt = async requestId => ({ requestId, operation: 'message.send', resourceId: f.messages.at(-1)!.id, acceptedAt: 1 });
    f.messages[f.messages.length - 1] = { ...f.messages.at(-1)!, text: 'Later authorized edit', revision: 2 };
    await owner.reconcileSend(); expect(owner.getSnapshot().draft.phase).toBe('editing'); expect(owner.getSnapshot().draft.text).toBe('');
    expect(f.sends).toHaveLength(1); expect(sent.options.requestId).toBeTruthy();
    owner.edit('Another draft'); f.mutable.messages.send = async (...args) => { f.sends.push({ id: args[0], input: args[1], options: args[2] }); throw new Error('Lost again'); };
    await owner.send(); const before = f.sends.at(-1)!; await owner.send(true); const after = f.sends.at(-1)!;
    expect(after.options.requestId).toBe(before.options.requestId); expect(after.input).toEqual(before.input);
  } finally { owner.dispose(); }
});
test('scope retirement masks state before notifications; selection races, late watches and denied live access cannot restore old history', async () => {
  const f = workspaceFixture(2), owner = new MessagingWorkspaceController(f.source, 'me', { isCurrent: f.current });
  try {
    await owner.start(); await owner.select('one'); await flush(); const old = [...f.watchers][0]!;
    await owner.select('two'); old.listener(f.page('one')); expect(owner.getSnapshot().messages).toEqual([]);
    await owner.select('one'); await flush(); const current = [...f.watchers].find(watch => watch.id === 'one')!;
    current.options.onError?.(new MessagingLiveError('MESSAGING_LIVE_UNAVAILABLE', true)); expect(owner.getSnapshot().messages).toHaveLength(2);
    current.options.onError?.(new MessagingLiveError('MESSAGING_LIVE_INVALIDATED', false)); expect(owner.getSnapshot().messages).toEqual([]);
    expect(owner.getSnapshot().conversation).toBeNull(); old.listener(f.page('one')); expect(owner.getSnapshot().messages).toEqual([]);
    [...f.listWatchers][0]!.listener({ items: [await f.source.conversations.get('one')], hasMore: false, nextCursor: null });
    expect(owner.getSnapshot().conversation).toBeNull(); await owner.select('one'); await flush(); expect(owner.getSnapshot().messages).toHaveLength(2);
    f.retire(); expect(owner.getSnapshot().conversations).toEqual([]); await owner.markPresented(2); expect(f.reads).toEqual([]);
  } finally { owner.dispose(); }
});
test('large reconnect gaps and retained-history bounds do not invent continuity or displace an older reader', async () => {
  const f = workspaceFixture(50), owner = new MessagingWorkspaceController(f.source, 'me', { isCurrent: f.current, maxMessages: 50 });
  try {
    await owner.start(); await owner.select('one'); await flush(); owner.setFollowing(false);
    for (let sequence = 51; sequence <= 150; sequence++) f.messages.push(workspaceMessage(sequence)); f.emit();
    expect(owner.getSnapshot().messages.at(-1)?.sequence).toBe(50); expect(owner.getSnapshot().hasNewer).toBe(true);
    owner.latest(); expect(owner.getSnapshot().messages[0]?.sequence).toBe(101); expect(owner.getSnapshot().messages).toHaveLength(50);
    expect(owner.getSnapshot().hasOlder).toBe(true); await owner.older(); expect(owner.getSnapshot().messages).toHaveLength(50);
    expect(owner.getSnapshot().messages[0]?.sequence).toBe(76); expect(owner.getSnapshot().messages.at(-1)?.sequence).toBe(125); expect(owner.getSnapshot().hasNewer).toBe(true);
    await owner.older(); expect(owner.getSnapshot().messages[0]?.sequence).toBe(51);
  } finally { owner.dispose(); }
});

test('list outages are visible without erasing retained data, and explicit post-denial recovery restores the transcript subscription', async () => {
  const f = workspaceFixture(2), owner = new MessagingWorkspaceController(f.source, 'me');
  try {
    await owner.start(); await owner.select('one'); await flush(); const watch = [...f.listWatchers][0]!;
    watch.options.onError?.(new MessagingLiveError('MESSAGING_LIVE_UNAVAILABLE', true));
    expect(owner.getSnapshot().listError).toContain('unavailable'); expect(owner.getSnapshot().conversations).toHaveLength(1); expect(owner.getSnapshot().messages).toHaveLength(2);
    watch.listener({ items: [await f.source.conversations.get('one')], hasMore: false, nextCursor: null }); expect(owner.getSnapshot().listError).toBeNull();
    watch.options.onError?.(new MessagingLiveError('MESSAGING_LIVE_INVALIDATED', false));
    expect(owner.getSnapshot().status).toBe('error'); expect(owner.getSnapshot().messages).toEqual([]);
    await owner.retry(); await flush(); expect(owner.getSnapshot().status).toBe('ready'); expect(owner.getSnapshot().messages).toHaveLength(2);
    f.messages.push(workspaceMessage(3)); f.emit(); expect(owner.getSnapshot().messages.at(-1)?.sequence).toBe(3);
  } finally { owner.dispose(); }
});
