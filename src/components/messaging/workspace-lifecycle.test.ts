import { expect, test } from 'bun:test';
import { MessagingWorkspaceController } from './messaging-workspace-controller';
import { MessagingWorkspaceCommands } from './workspace-command';
import { MessagingWorkspaceUploads } from './workspace-uploads';
import { workspaceFixture, workspaceConversation, workspaceMessage } from './workspace.test-fixtures';
import type { MessagingAttachment } from '../../messaging/attachment-contracts';
import type { MessagingMutationOptions } from '../../messaging/contracts';
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('new history grants purge cached rows even when removal/readmission is coalesced; late older grants cannot restore them', async () => {
  const f = workspaceFixture(70), list = f.mutable.messages.list;
  const initial = { from: 1, revision: 1, visibility: 'conversation' as const };
  f.mutable.messages.list = async (...args) => ({ ...await list(...args), history: initial });
  const owner = new MessagingWorkspaceController(f.source, 'me');
  try {
    await owner.start(); await owner.select('one'); await owner.older(); await flush(); expect(owner.getSnapshot().messages).toHaveLength(70);
    const head = [...f.watchers].find(row => row.options.query?.after === undefined)!;
    const old = { ...f.page('one'), history: initial };
    const current = { from: 71, revision: 3, visibility: 'conversation' as const };
    head.listener({ items: [], hasMore: false, nextCursor: null, history: current }); expect(owner.getSnapshot().messages).toEqual([]);
    head.listener(old); expect(owner.getSnapshot().messages).toEqual([]);
    f.messages.push(workspaceMessage(71)); head.listener({ ...f.page('one'), history: current }); expect(owner.getSnapshot().messages.map(row => row.sequence)).toEqual([71]);
    // A later explicitly broadened grant is distinct from an old delayed page.
    head.listener({ ...f.page('one'), history: { from: 1, revision: 5, visibility: 'conversation' } }); expect(owner.getSnapshot().messages[0]?.sequence).toBe(22);
    head.listener({ items: [], hasMore: false, nextCursor: null, history: current }); expect(owner.getSnapshot().messages[0]?.sequence).toBe(22);
    const privateRow = { ...workspaceMessage(72), visibility: 'staff' as const };
    head.listener({ items: [privateRow], hasMore: false, nextCursor: null, history: { from: 1, revision: 6, visibility: 'staff' } });
    expect(owner.getSnapshot().messages.some(row => row.visibility === 'staff')).toBe(true);
    head.listener({ items: [workspaceMessage(71)], hasMore: false, nextCursor: null, history: { from: 1, revision: 7, visibility: 'conversation' } });
    expect(owner.getSnapshot().messages.some(row => row.visibility === 'staff')).toBe(false);
  } finally { owner.dispose(); }
});

test('many retained pages use one historical connection, and scrolling refreshes only the active bounded window', async () => {
  const f = workspaceFixture(350), owner = new MessagingWorkspaceController(f.source, 'me');
  try {
    await owner.start(); await owner.select('one');
    for (let i = 0; i < 6; i++) { await owner.older(); await flush(); expect(f.watchers.size).toBeLessThanOrEqual(2); }
    expect(owner.getSnapshot().messages).toHaveLength(350);
    const retired = [...f.watchers].find(row => row.options.query?.after !== undefined)!;
    f.messages[199] = { ...f.messages[199]!, revision: 2, text: 'Fresh visible middle history' };
    owner.observeVisible(200); await Bun.sleep(140);
    expect(f.watchers.size).toBe(2); expect(owner.getSnapshot().messages.find(row => row.sequence === 200)?.text).toBe('Fresh visible middle history');
    retired.listener({ items: [{ ...f.messages[0]!, revision: 99, text: 'Retired range must not return' }], hasMore: false, nextCursor: null });
    expect(owner.getSnapshot().messages[0]?.text).not.toBe('Retired range must not return');
  } finally { owner.dispose(); }
});

test('private note and public reply drafts stay separate across mode switches, conversation replacement and stale input handlers', async () => {
  const f = workspaceFixture(1), source = { ...f.source, conversations: { ...f.source.conversations,
    get: async (id: string) => ({ ...workspaceConversation(id), kind: 'support' as const, participants: [{ id: 'me', kind: 'user' as const, role: 'staff' as const, joinedAt: 1 }] }) } };
  const owner = new MessagingWorkspaceController(source, 'me');
  try {
    await owner.start(); await flush(); await owner.select('one');
    owner.edit('Public reply'); owner.setVisibility('staff'); expect(owner.getSnapshot().draft.text).toBe('');
    owner.edit('Private note'); owner.setVisibility('conversation'); expect(owner.getSnapshot().draft.text).toBe('Public reply');
    owner.edit('Retained private callback must not write here', 'one', 'staff'); expect(owner.getSnapshot().draft.text).toBe('Public reply');
    await owner.select('two'); await owner.select('one'); expect(owner.getSnapshot().draft.text).toBe('Public reply');
    owner.setVisibility('staff'); expect(owner.getSnapshot().draft.text).toBe('Private note');
    await owner.send(false, 'conversation'); expect(f.sends).toHaveLength(0);
    await owner.send(false, 'staff'); expect(f.sends).toHaveLength(1); expect(f.sends[0]?.input.visibility).toBe('staff');
    expect(f.sends[0]?.input.text).toBe('Private note'); owner.setVisibility('conversation'); expect(owner.getSnapshot().draft.text).toBe('Public reply');
  } finally { owner.dispose(); }
});

test('synchronous send failures and concurrent checks retain one exact operation, without clearing a rejected or uncertain draft', async () => {
  const f = workspaceFixture(1), owner = new MessagingWorkspaceController(f.source, 'me');
  try {
    await owner.start(); await owner.select('one'); owner.edit('Pinned request');
    let calls = 0;
    f.mutable.messages.send = (id, input, options) => { calls++; f.sends.push({ id, input, options }); throw new Error('Synthetic synchronous transport failure'); };
    await owner.send(); expect(owner.getSnapshot().draft.phase).toBe('unknown'); await owner.send(true);
    expect(calls).toBe(2); expect(f.sends[0]?.options.requestId).toBe(f.sends[1]?.options.requestId);
    let receipts = 0; f.mutable.receipt = async () => { receipts++; await flush(); return null; };
    await Promise.all([owner.reconcileSend(), owner.reconcileSend(), owner.reconcileSend()]); expect(receipts).toBe(1);
    expect(owner.getSnapshot().draft.text).toBe('Pinned request'); expect(owner.hasUnfinished()).toBe(true);
  } finally { owner.dispose(); }
});

test('management retries reuse one identity, validate receipt operation and cannot restore scope-retired state', async () => {
  const f = workspaceFixture(1), keys: string[] = [];
  const source = { ...f.source, conversations: { ...f.source.conversations, create: (_input: unknown, options: MessagingMutationOptions) => { keys.push(options.requestId); throw new Error('Synthetic lost result'); } } };
  const owner = new MessagingWorkspaceController(source, 'me', { isCurrent: f.current });
  try {
    await owner.start(); await owner.create({ userIds: ['peer'] }); expect(owner.getSnapshot().command?.phase).toBe('unknown');
    await owner.retryCommand(); expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
    source.receipt = async requestId => ({ requestId, operation: 'message.send', resourceId: 'one', acceptedAt: 1 });
    await owner.checkCommand(); expect(owner.getSnapshot().command?.phase).toBe('unknown'); expect(owner.getSnapshot().selectedId).toBeNull();
    source.receipt = async requestId => { await flush(); return { requestId, operation: 'conversation.create', resourceId: 'one', acceptedAt: 1 }; };
    const checking = owner.checkCommand(); f.retire(); await checking;
    expect(owner.getSnapshot().selectedId).toBeNull(); expect(owner.getSnapshot().conversations).toEqual([]);
  } finally { owner.dispose(); }
});

test('command runner coalesces duplicate clicks and recovers from a synchronously throwing adapter', async () => {
  const f = workspaceFixture(), abort = new AbortController(), keys: string[] = [], accepted: string[] = [];
  const commands = new MessagingWorkspaceCommands(f.source, f.current, abort.signal, () => {}); let fail = true;
  const run = (options: MessagingMutationOptions): Promise<string> => { keys.push(options.requestId); if (fail) throw new Error('Synthetic adapter throw'); return Promise.resolve('accepted'); };
  await Promise.all([commands.execute('Synthetic change', run, async () => 'accepted', value => accepted.push(value)), commands.retry()]);
  expect(keys).toHaveLength(1); expect(commands.snapshot()?.phase).toBe('unknown');
  fail = false; await commands.retry(); expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]); expect(accepted).toEqual(['accepted']); expect(commands.snapshot()).toBeNull();
});

test('equal live revisions retain object identity while reaction projections still update; accepted writes obey the transcript bound', async () => {
  const f = workspaceFixture(50), owner = new MessagingWorkspaceController(f.source, 'me', { maxMessages: 50 });
  try {
    await owner.start(); await owner.select('one'); await flush(); const first = owner.getSnapshot().messages[0];
    f.messages[0] = structuredClone(f.messages[0]!); f.emit(); expect(owner.getSnapshot().messages[0]).toBe(first);
    f.messages[0] = { ...f.messages[0]!, reactions: [{ emoji: '👍', count: 1, selected: false }] }; f.emit();
    expect(owner.getSnapshot().messages[0]?.reactions).toHaveLength(1);
    owner.setFollowing(false); owner.edit('No displacement'); await owner.send();
    expect(owner.getSnapshot().messages).toHaveLength(50); expect(owner.getSnapshot().messages[0]?.sequence).toBe(1); expect(owner.getSnapshot().hasNewer).toBe(true);
  } finally { owner.dispose(); }
});

test('private upload retries preserve checksum, allocation and byte identity; cancellation cannot make a late upload ready', async () => {
  const f = workspaceFixture(), abort = new AbortController(), allocated: Array<{ requestId: string; checksum: string; visibility: string }> = [], uploads: string[] = [];
  let asset: MessagingAttachment, fail = true, held: (() => void) | undefined;
  const source = { ...f.source, attachments: { ...f.source.attachments,
    allocate: async (id: string, input: any, options: MessagingMutationOptions) => {
      allocated.push({ requestId: options.requestId, checksum: input.checksum, visibility: input.visibility });
      return asset = { ...input, id: 'synthetic-asset', conversationId: id, state: 'allocated', messageId: null, createdAt: 1, expiresAt: Date.now() + 60000 };
    }, upload: async (_id: string, _asset: string, _body: unknown, options: MessagingMutationOptions) => {
      uploads.push(options.requestId); if (fail) { fail = false; throw new Error('Synthetic upload response lost'); }
      await new Promise<void>(resolve => { held = resolve; }); return { ...asset, state: 'ready' as const };
    },
  } };
  const stages = new MessagingWorkspaceUploads(source, f.current, abort.signal, () => {});
  stages.add('one', [new File([new TextEncoder().encode('Synthetic private bytes')], 'note.pdf', { type: 'application/pdf' })], 1024, 'staff');
  await flush(); await flush(); const row = stages.snapshot('one', 'staff')[0]!;
  expect(row.state).toBe('failed'); expect(stages.snapshot('one')).toEqual([]); const retry = stages.retry(row.id); await flush();
  expect(allocated).toHaveLength(2); expect(allocated[0]).toEqual(allocated[1]); expect(uploads[0]).toBe(uploads[1]);
  expect(allocated[0]?.checksum).toMatch(/^[a-f0-9]{64}$/); await stages.remove(row.id); held!(); await retry;
  expect(stages.snapshot('one', 'staff')).toEqual([]); expect(stages.hasUnfinished()).toBe(false);
  expect(() => stages.add('one', [new File(['x'], '../bad.txt', { type: 'text/plain' })], 1024, 'conversation')).toThrow();
  stages.clear(); abort.abort();
});
