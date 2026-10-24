import { expect, test } from 'bun:test';
import { ImapMailbox } from './imap-mailbox';
import { imapFixture } from './test-support/imap-fixture';

test('IMAP lists folders and bounded stable UID pages including sparse incremental ranges', async () => {
  const local = await imapFixture(), mailbox = new ImapMailbox(local.config);
  try {
    expect((await mailbox.folders()).map(folder => folder.path)).toEqual(['INBOX', 'Sent', 'Trash']);
    const first = await mailbox.list({ limit: 2 });
    expect(first.uidValidity).toBe('123'); expect(first.messages.map(message => message.uid)).toEqual([3]);
    expect(first.nextBeforeUid).toBe(2);
    expect((await mailbox.list({ beforeUid: first.nextBeforeUid, limit: 2 })).messages.map(message => message.uid)).toEqual([1]);
    const initial = await mailbox.list({ afterUid: 0, limit: 2 });
    expect(initial.messages.map(message => message.uid)).toEqual([1]); expect(initial.nextAfterUid).toBe(2);
    expect((await mailbox.list({ afterUid: initial.nextAfterUid, limit: 2 })).messages.map(message => message.uid)).toEqual([3]);
    expect((await mailbox.list({ afterUid: 999, limit: 2 })).messages).toEqual([]);
    await expect(mailbox.list({ uidValidity: '122' })).rejects.toMatchObject({ code: 'EMAIL_MAILBOX_RESYNC_REQUIRED' });
  } finally { await mailbox.close(); await local.close(); }
});

test('IMAP reads MIME and attachments without marking read, and supports flags, moves and draft append', async () => {
  const local = await imapFixture(), mailbox = new ImapMailbox(local.config);
  const ref = { folder: 'INBOX', uidValidity: '123', uid: 1 };
  try {
    const message = await mailbox.read(ref);
    expect(message.text.trim()).toBe('Body 1'); expect(message.flags).not.toContain('\\Seen');
    expect(message.attachments[0]?.filename).toBe('sample.txt');
    expect(new TextDecoder().decode(message.attachments[0]!.content)).toBe('attachment bytes');
    await mailbox.setFlags(ref, { seen: true });
    expect((await mailbox.list({ afterUid: 0 })).messages.find(message => message.uid === 1)?.flags).toContain('\\Seen');
    const moved = await mailbox.move(ref, 'Trash'); expect(moved.folder).toBe('Trash'); expect(moved.uidValidity).toBe('123');
    const draft = await mailbox.append({ from: 'sender@example.test', to: 'recipient@example.test', bcc: 'private@example.test', subject: 'Draft', text: 'Draft body' }, { folder: 'Sent', draft: true });
    expect(draft).toMatchObject({ folder: 'Sent', uidValidity: '123' });
    const restored = await mailbox.read(draft!);
    expect(restored.bcc[0]?.address).toBe('private@example.test');
    expect(restored.flags).toContain('\\Draft'); expect(restored.flags).not.toContain('\\Seen');
  } finally { await mailbox.close(); await local.close(); }
});

test('IMAP IDLE pushes arrivals/flags/removals, and reconnect explicitly resynchronizes identifiers', async () => {
  const local = await imapFixture(), mailbox = new ImapMailbox(local.config);
  const iterator = mailbox.watch()[Symbol.asyncIterator]();
  try {
    expect((await iterator.next()).value).toMatchObject({ type: 'resync', reason: 'connected', uidValidity: '123' });
    await local.ready(); const before = local.commands;
    await Bun.sleep(60); expect(local.commands).toBe(before); // Live connection, not a polling loop.
    local.arrive(); expect((await iterator.next()).value).toMatchObject({ type: 'arrival', total: 3, previousTotal: 2 });
    local.flags(3); expect((await iterator.next()).value).toMatchObject({ type: 'flags', uid: 3, flags: ['\\Seen'] });
    local.expunge(); expect((await iterator.next()).value).toMatchObject({ type: 'resync', reason: 'sequence-expunge' });
    local.disconnect(true);
    expect((await iterator.next()).value).toMatchObject({ type: 'resync', reason: 'reconnected', uidValidity: '124' });
    expect(local.connections).toBe(2);
    await iterator.return?.();
  } finally { await mailbox.close(); await local.close(); }
}, 10_000);

test('mailbox close aborts stalled operations and IDLE instead of leaking connections', async () => {
  const local = await imapFixture({ stall: true }), mailbox = new ImapMailbox(local.config);
  try {
    const pending = mailbox.verify().catch(error => error);
    await Bun.sleep(30); await mailbox.close();
    expect((await pending).code).toBe('EMAIL_DELIVERY_ABORTED');
  } finally { await mailbox.close(); await local.close(); }
});

test('message byte limits and unsupported IDLE fail safely without a polling fallback', async () => {
  const local = await imapFixture({ idle: false }), mailbox = new ImapMailbox({ ...local.config, maxMessageBytes: 10 });
  try {
    await expect(mailbox.read({ folder: 'INBOX', uidValidity: '123', uid: 1 })).rejects.toMatchObject({ code: 'EMAIL_MESSAGE_TOO_LARGE' });
    const iterator = mailbox.watch()[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({ code: 'EMAIL_MAILBOX_IDLE_UNSUPPORTED' });
  } finally { await mailbox.close(); await local.close(); }
});

test('slow live consumers receive a bounded resync and can cancel a blocked next call', async () => {
  const local = await imapFixture(), mailbox = new ImapMailbox(local.config);
  const iterator = mailbox.watch()[Symbol.asyncIterator]();
  try {
    await iterator.next(); await local.ready();
    for (let count = 0; count < 300; count++) local.flags(1);
    await Bun.sleep(50);
    expect((await iterator.next()).value).toMatchObject({ type: 'resync', reason: 'overflow' });
    await iterator.return?.();
    const fresh = mailbox.watch()[Symbol.asyncIterator]();
    await fresh.next(); await local.ready();
    const pending = fresh.next();
    await fresh.return?.(); expect((await pending).done).toBe(true);
  } finally { await mailbox.close(); await local.close(); }
});

test('mailbox operation deadlines and caller cancellation close stalled sockets', async () => {
  const local = await imapFixture({ stall: true });
  try {
    for (const cancel of [true, false]) {
      const mailbox = new ImapMailbox({ ...local.config, timeoutMs: 150 });
      const controller = new AbortController();
      const pending = mailbox.verify({ signal: controller.signal }).catch(error => error);
      if (cancel) controller.abort();
      expect((await pending).code).toBe(cancel ? 'EMAIL_DELIVERY_ABORTED' : 'EMAIL_DELIVERY_TIMEOUT');
      await mailbox.close();
    }
  } finally { await local.close(); }
});

test('IMAP never authenticates when required STARTTLS is unavailable', async () => {
  const local = await imapFixture(), mailbox = new ImapMailbox({ ...local.config, requireTLS: true });
  try {
    await expect(mailbox.verify()).rejects.toMatchObject({ code: 'EMAIL_MAILBOX_FAILED' });
    expect(local.loginAttempts).toBe(0);
  } finally { await mailbox.close(); await local.close(); }
});
