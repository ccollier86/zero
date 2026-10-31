/** Native retained-origin regressions. Only disposable Guardian identities, private files and loopback HTTP/Sync are used. */
import { expect, test } from 'bun:test';
import { portalFixture } from './test-support/portal-fixture';
import { messagingTypingSocket } from './test-support/typing-socket';
import { messagingTypingRoom } from './typing-topic';

const auth = { bootstrap: 'public' as const, userProperties: {
  operator: { editableBy: 'admin' as const, useInPolicies: true }, department: { editableBy: 'admin' as const, useInPolicies: true },
} };
const staff = { properties: { operator: 'yes' } };

test('replacing a private inbox with a same-name public entry cannot grant retained reads, claims, files, live history or typing', async () => {
  const f = await portalFixture({ auth, messaging: { portal: true, support: { staff, inboxes: { team: { title: 'Private team', staff: { properties: { department: 'billing' } } } } } } });
  const admin = f.peer(), operator = f.peer(), member = f.peer();
  let socket: Awaited<ReturnType<typeof messagingTypingSocket>> | undefined;
  try {
    await admin.register('origin-private-owner'); await operator.register('origin-private-agent'); await member.register('origin-private-member');
    const set = async (id: string, name: string, value: string) => {
      await admin.json('/auth/admin/users/' + id + '/properties/' + name, { method: 'PUT', body: { value } });
      if (id === admin.id) await admin.login('origin-private-owner');
    };
    await set(operator.id, 'operator', 'yes'); await set(admin.id, 'operator', 'yes'); await set(admin.id, 'department', 'billing'); await operator.login('origin-private-agent');
    const chat = await member.messaging.support.open({ inboxId: 'team', mode: 'human' }, { requestId: 'origin-private-open' });
    const bytes = new TextEncoder().encode('SYNTHETIC_PRIVATE_DESTINATION_FILE');
    const asset = await member.messaging.attachments.allocate(chat.id, { fileName: 'synthetic.txt', mimeType: 'text/plain', sizeBytes: bytes.byteLength,
      checksum: new Bun.CryptoHasher('sha256').update(bytes).digest('hex') }, { requestId: 'origin-private-file' });
    await member.messaging.attachments.upload(chat.id, asset.id, bytes, { requestId: 'origin-private-bytes' });
    await member.messaging.messages.send(chat.id, { text: 'SYNTHETIC_PRIVATE_DESTINATION_TEXT', attachmentIds: [asset.id] }, { requestId: 'origin-private-message' });
    const owned = await admin.messaging.support.claim(chat.id, chat.ownerEpoch, { requestId: 'origin-private-claim' });
    await expect(operator.messaging.support.claim(chat.id, owned.ownerEpoch, { requestId: 'origin-before-claim' })).rejects.toMatchObject({ status: 404 });
    expect((await admin.messaging.messages.list(chat.id)).items).toHaveLength(1);
    f.config.messaging = { portal: true, support: { staff, entries: { team: { origin: f.origin, assistant: false } } } };
    await f.restart(); const login = await admin.login('origin-private-owner'); await operator.login('origin-private-agent');
    expect((await operator.messaging.support.queue()).items).toEqual([]);
    await expect(operator.messaging.support.queue({ inboxId: 'team' })).rejects.toMatchObject({ status: 404 });
    await expect(operator.messaging.support.claim(chat.id, owned.ownerEpoch, { requestId: 'origin-after-claim' })).rejects.toMatchObject({ status: 404 });
    expect((await admin.messaging.conversations.list()).items).toEqual([]);
    for (const user of [admin, operator]) {
      await expect(user.messaging.messages.list(chat.id)).rejects.toMatchObject({ status: 404 });
      await expect(user.messaging.attachments.download(chat.id, asset.id)).rejects.toMatchObject({ status: 404 });
      expect((await user.request('/api/messaging/conversations/' + chat.id + '/messages/live', { signal: AbortSignal.timeout(4000) })).status).toBe(404);
    }
    socket = await messagingTypingSocket(f.origin, login.accessToken);
    const topic = 'typing:' + messagingTypingRoom(chat.id); socket.send({ type: 'ephemeral.subscribe', topic });
    expect(await socket.wait(message => message.type === 'ephemeral.error' && message.topic === topic)).toMatchObject({ code: 'EPHEMERAL_FORBIDDEN' });
    await socket.close(); socket = undefined;
    // Restoring the original destination restores current admission, not data or receipt reconstruction.
    f.config.messaging = { portal: true, support: { staff, inboxes: { team: { title: 'Private team', staff: { properties: { department: 'billing' } } } } } };
    await f.restart(); await admin.login('origin-private-owner'); await member.login('origin-private-member');
    expect((await admin.messaging.messages.list(chat.id)).items[0]?.text).toBe('SYNTHETIC_PRIVATE_DESTINATION_TEXT');
    expect(await (await member.messaging.attachments.download(chat.id, asset.id)).text()).toBe('SYNTHETIC_PRIVATE_DESTINATION_FILE');
    expect((await member.messaging.support.open({ inboxId: 'team', mode: 'human' }, { requestId: 'origin-private-open' })).id).toBe(chat.id);
  } finally { await socket?.close(); await f.close(); }
}, 90000);

test('replacing a public entry with a same-name private inbox does not grant the old public queue or retained staff membership', async () => {
  const f = await portalFixture(), admin = f.peer(), member = f.peer();
  try {
    await admin.register('origin-public-owner'); await member.register('origin-public-member');
    f.config.messaging = { portal: true, support: { entries: { team: { origin: f.origin, assistant: false } } } };
    await f.restart(); await admin.login('origin-public-owner');
    const response = await fetch(f.origin + '/api/messaging/public/team/session', { method: 'POST', headers: {
      Origin: f.origin, 'X-Zero-Support-Client': '1', 'Content-Type': 'application/json',
    }, body: JSON.stringify({ mode: 'human' }) }); expect(response.status).toBe(200);
    const session = await response.json() as { conversationId: string };
    const claimed = await admin.messaging.support.claim(session.conversationId, 1, { requestId: 'origin-public-claim' });
    f.config.messaging = { portal: true, support: { inboxes: { team: { title: 'Private team' } } } };
    await f.restart(); await admin.login('origin-public-owner'); await member.login('origin-public-member');
    const opened = await member.messaging.support.open({ inboxId: 'team', mode: 'human' }, { requestId: 'origin-new-private' });
    expect((await admin.messaging.support.queue()).items.map(row => row.id)).toEqual([opened.id]);
    expect((await admin.messaging.support.queue({ inboxId: 'team' })).items.map(row => row.id)).toEqual([opened.id]);
    expect((await admin.messaging.conversations.list()).items).toEqual([]);
    await expect(admin.messaging.conversations.get(session.conversationId)).rejects.toMatchObject({ status: 404 });
    await expect(admin.messaging.support.claim(session.conversationId, claimed.ownerEpoch, { requestId: 'origin-public-reclaim' })).rejects.toMatchObject({ status: 404 });
    f.config.messaging = { portal: true, support: { entries: { team: { origin: f.origin, assistant: false } } } };
    await f.restart(); await admin.login('origin-public-owner');
    expect((await admin.messaging.conversations.get(session.conversationId)).ownerEpoch).toBe(claimed.ownerEpoch);
  } finally { await f.close(); }
}, 90000);
