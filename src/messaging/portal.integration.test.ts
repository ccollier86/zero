/** Real native portal admission/routing/revocation and private file flows. Only isolated synthetic accounts are created. */
import { expect, test } from 'bun:test';
import { portalFixture } from './test-support/portal-fixture';
import type { MessagingPage, DurableMessage } from './contracts';

const until = async (ready: () => boolean) => {
  const deadline = Date.now() + 10000;
  while (!ready()) { if (Date.now() >= deadline) throw new Error('Synthetic portal live-state deadline.'); await Bun.sleep(25); }
};
test('portal members cannot discover/add peers and reach the owner through their own private support conversation', async () => {
  const f = await portalFixture(), owner = f.peer(), member = f.peer(), other = f.peer();
  let stop: (() => void) | undefined;
  try {
    await owner.register('portal-owner'); await member.register('portal-member'); await other.register('portal-other');
    expect(await owner.messaging.capabilities()).toMatchObject({ portal: false, canSupport: true, support: true });
    expect(await member.messaging.capabilities()).toMatchObject({ portal: true, canSupport: false, support: true });
    await expect(member.messaging.directory()).rejects.toMatchObject({ status: 403 });
    await expect(member.messaging.contacts.list()).rejects.toMatchObject({ status: 403 });
    await expect(member.messaging.contacts.request(owner.id, { requestId: 'portal-contact' })).rejects.toMatchObject({ status: 403 });
    for (const kind of ['direct', 'group'] as const) await expect(member.messaging.conversations.create({ kind, userIds: [owner.id] }, { requestId: 'portal-' + kind })).rejects.toMatchObject({ status: 403 });
    await expect(owner.messaging.conversations.create({ userIds: [member.id] }, { requestId: 'operator-peer-to-portal' })).rejects.toMatchObject({ status: 404 });
    expect((await member.messaging.assistants.list()).items).toEqual([]);
    await expect(member.messaging.assistants.open('guessed', {}, { requestId: 'portal-internal-bot' })).rejects.toMatchObject({ status: 403 });
    expect((await member.request('/api/messaging/contacts/live')).status).toBe(403);
    await expect(member.messaging.support.queue()).rejects.toMatchObject({ status: 403 });
    const opened = await member.messaging.support.open({ mode: 'human' }, { requestId: 'portal-open' });
    await expect(other.messaging.conversations.get(opened.id)).rejects.toMatchObject({ status: 404 });
    await expect(owner.messaging.messages.list(opened.id)).rejects.toMatchObject({ status: 404 });
    const queue = await owner.messaging.support.queue(); expect(queue.items.map(item => item.id)).toEqual([opened.id]);
    const claimed = await owner.messaging.support.claim(opened.id, opened.ownerEpoch, { requestId: 'owner-claim' });
    const received: MessagingPage<DurableMessage>[] = [];
    stop = member.messaging.watchMessages(opened.id, page => received.push(page)); await until(() => received.length > 0);
    await owner.messaging.messages.send(opened.id, { text: 'SYNTHETIC_INTERNAL_NOTE', visibility: 'staff' }, { requestId: 'owner-note' });
    await owner.messaging.messages.send(opened.id, { text: 'SYNTHETIC_PORTAL_REPLY', expectedOwnerEpoch: claimed.ownerEpoch }, { requestId: 'owner-reply' });
    await until(() => received.some(page => page.items.some(item => item.text === 'SYNTHETIC_PORTAL_REPLY')));
    expect(JSON.stringify(received)).not.toContain('SYNTHETIC_INTERNAL_NOTE');
    await expect(member.messaging.messages.send(opened.id, { text: 'PRIVATE_NOTE_FORGERY', visibility: 'staff' }, { requestId: 'member-note' })).rejects.toMatchObject({ status: 422 });
    const upload = new TextEncoder().encode('SYNTHETIC_PORTAL_ATTACHMENT');
    const allocated = await member.messaging.attachments.allocate(opened.id, { fileName: 'portal.txt', mimeType: 'text/plain', sizeBytes: upload.byteLength,
      checksum: new Bun.CryptoHasher('sha256').update(upload).digest('hex') }, { requestId: 'portal-allocation' });
    const asset = await member.messaging.attachments.upload(opened.id, allocated.id, upload, { requestId: 'portal-upload' });
    await member.messaging.messages.send(opened.id, { text: '', attachmentIds: [asset.id] }, { requestId: 'portal-attach' });
    expect(await (await owner.messaging.attachments.download(opened.id, asset.id)).text()).toBe('SYNTHETIC_PORTAL_ATTACHMENT');
    await expect(other.messaging.attachments.download(opened.id, asset.id)).rejects.toMatchObject({ status: 404 });
    const before = opened.id; stop(); stop = undefined; await f.restart();
    await owner.login('portal-owner'); await member.login('portal-member');
    expect((await member.messaging.support.open({ mode: 'human' }, { requestId: 'portal-open' })).id).toBe(before);
    expect((await member.messaging.conversations.list()).items.map(item => item.id)).toEqual([before]);
    expect(await (await member.messaging.attachments.download(before, asset.id)).text()).toBe('SYNTHETIC_PORTAL_ATTACHMENT');
  } finally { stop?.(); await f.close(); }
}, 90000);

test('named inboxes route to current authorized operators and revoke member/staff reads, files, queue filters and streams', async () => {
  const f = await portalFixture({ auth: { bootstrap: 'public', userProperties: {
    operator: { editableBy: 'admin', useInPolicies: true }, department: { editableBy: 'admin', useInPolicies: true }, billingAccess: { editableBy: 'admin', useInPolicies: true },
  } }, messaging: { portal: true, support: { staff: { properties: { operator: 'yes' } }, defaultInbox: 'frontdesk', inboxes: {
    frontdesk: { title: 'Front desk' }, billing: { title: 'Billing', access: { properties: { billingAccess: 'yes' } }, staff: { properties: { department: 'billing' } } },
  } } } }), admin = f.peer(), agent = f.peer(), member = f.peer(), other = f.peer();
  const set = (id: string, key: string, value: string) => admin.json('/auth/admin/users/' + id + '/properties/' + key, { method: 'PUT', body: { value } });
  let stop: (() => void) | undefined;
  try {
    await admin.register('inbox-owner'); await agent.register('inbox-agent'); await member.register('inbox-member'); await other.register('inbox-other');
    await set(admin.id, 'operator', 'yes'); await admin.login('inbox-owner');
    await set(agent.id, 'operator', 'yes'); await set(agent.id, 'department', 'billing'); await agent.login('inbox-agent');
    await set(member.id, 'billingAccess', 'yes'); await member.login('inbox-member');
    expect((await member.messaging.support.inboxes()).items.map(item => item.id)).toEqual(['frontdesk', 'billing']);
    expect((await other.messaging.support.inboxes()).items.map(item => item.id)).toEqual(['frontdesk']);
    const privateMemberData = JSON.stringify(await member.messaging.support.inboxes());
    expect(privateMemberData).not.toContain('operator'); expect(privateMemberData).not.toContain('department'); expect(privateMemberData).not.toContain(agent.id);
    const opened = await member.messaging.support.open({ inboxId: 'billing', mode: 'human' }, { requestId: 'billing-open' });
    expect(opened).toMatchObject({ inboxId: 'billing', inboxTitle: 'Billing', title: 'Billing' });
    await expect(other.messaging.support.open({ inboxId: 'billing' }, { requestId: 'guessed-inbox' })).rejects.toMatchObject({ status: 404 });
    const forged = await member.request('/api/messaging/support', { method: 'POST', headers: { 'Idempotency-Key': 'forged-staff' }, body: { inboxId: 'billing', userIds: [agent.id], staff: true, tenantId: 'forged' } }); expect(forged.status).toBe(422);
    expect((await admin.messaging.support.queue()).items).toEqual([]);
    await expect(admin.messaging.support.claim(opened.id, 1, { requestId: 'wrong-inbox-operator' })).rejects.toMatchObject({ status: 404 });
    expect((await agent.messaging.support.queue({ inboxId: 'billing' })).items.map(item => item.id)).toEqual([opened.id]);
    const claimed = await agent.messaging.support.claim(opened.id, 1, { requestId: 'billing-claim' });
    const upload = new TextEncoder().encode('SYNTHETIC_BILLING_ATTACHMENT');
    const file = await member.messaging.attachments.allocate(opened.id, { fileName: 'billing.txt', mimeType: 'text/plain', sizeBytes: upload.byteLength,
      checksum: new Bun.CryptoHasher('sha256').update(upload).digest('hex') }, { requestId: 'billing-file' });
    await member.messaging.attachments.upload(opened.id, file.id, upload, { requestId: 'billing-upload' });
    await member.messaging.messages.send(opened.id, { text: '', attachmentIds: [file.id] }, { requestId: 'billing-attachment' });
    expect(await (await agent.messaging.attachments.download(opened.id, file.id)).text()).toBe('SYNTHETIC_BILLING_ATTACHMENT');
    const rows: MessagingPage<DurableMessage>[] = [], errors: unknown[] = [];
    stop = agent.messaging.watchMessages(opened.id, page => rows.push(page), { onError: error => errors.push(error) }); await until(() => rows.length > 0);
    await agent.messaging.messages.send(opened.id, { text: 'SYNTHETIC_BILLING_REPLY', expectedOwnerEpoch: claimed.ownerEpoch }, { requestId: 'billing-reply' });
    expect((await member.messaging.messages.list(opened.id)).items.some(row => row.text === 'SYNTHETIC_BILLING_REPLY')).toBe(true);
    await set(agent.id, 'department', 'other'); await until(() => errors.length > 0);
    await expect(agent.messaging.conversations.get(opened.id)).rejects.toMatchObject({ status: 401 }); await agent.login('inbox-agent');
    await expect(agent.messaging.conversations.get(opened.id)).rejects.toMatchObject({ status: 404 });
    await expect(agent.messaging.attachments.download(opened.id, file.id)).rejects.toMatchObject({ status: 404 });
    await expect(agent.messaging.support.queue({ inboxId: 'billing' })).rejects.toMatchObject({ status: 404 });
    await set(member.id, 'billingAccess', 'no');
    await expect(member.messaging.messages.list(opened.id)).rejects.toMatchObject({ status: 401 }); await member.login('inbox-member');
    await expect(member.messaging.messages.list(opened.id)).rejects.toMatchObject({ status: 404 });
    await expect(member.messaging.attachments.download(opened.id, file.id)).rejects.toMatchObject({ status: 404 });
    await expect(member.messaging.support.open({ inboxId: 'billing', mode: 'human' }, { requestId: 'billing-open' })).rejects.toMatchObject({ status: 404 });
    expect((await member.messaging.conversations.list()).items).toEqual([]);
    expect((await member.messaging.support.inboxes()).items.map(item => item.id)).toEqual(['frontdesk']);
    await set(agent.id, 'operator', 'no'); await agent.login('inbox-agent'); expect(await agent.messaging.capabilities()).toMatchObject({ portal: true, canSupport: false });
    await expect(agent.messaging.directory()).rejects.toMatchObject({ status: 403 });
  } finally { stop?.(); await f.close(); }
}, 90000);

test('identical portal inbox names are scoped to the current organization with no caller-selected cross-tenant destination', async () => {
  const f = await portalFixture({ auth: { tenancy: 'multi', bootstrap: 'public', registration: { mode: 'public' } },
    messaging: { portal: true, support: { inboxes: { team: { title: 'Team' } } } } }), first = f.peer(), second = f.peer(), memberA = f.peer(), memberB = f.peer();
  try {
    await first.register('portal-org-one', { organizationName: 'Synthetic one' }); await second.register('portal-org-two', { organizationName: 'Synthetic two' });
    const invitationA = await first.json('/auth/tenant/invitations', { method: 'POST', body: { email: 'portal-member-one@example.test' } });
    const invitationB = await second.json('/auth/tenant/invitations', { method: 'POST', body: { email: 'portal-member-two@example.test' } });
    await memberA.acceptInvitation('portal-member-one', invitationA.token); await memberB.acceptInvitation('portal-member-two', invitationB.token);
    expect(await memberA.messaging.capabilities()).toMatchObject({ portal: true, canSupport: false });
    expect(await memberB.messaging.capabilities()).toMatchObject({ portal: true, canSupport: false });
    await expect(memberA.messaging.directory()).rejects.toMatchObject({ status: 403 }); await expect(memberB.messaging.support.queue()).rejects.toMatchObject({ status: 403 });
    const a = await memberA.messaging.support.open({ inboxId: 'team', mode: 'human' }, { requestId: 'same-request' });
    const b = await memberB.messaging.support.open({ inboxId: 'team', mode: 'human' }, { requestId: 'same-request' }); expect(a.id).not.toBe(b.id);
    expect((await first.messaging.support.queue({ inboxId: 'team' })).items.map(item => item.id)).toEqual([a.id]);
    expect((await second.messaging.support.queue({ inboxId: 'team' })).items.map(item => item.id)).toEqual([b.id]);
    await expect(first.messaging.conversations.get(b.id)).rejects.toMatchObject({ status: 404 });
    await expect(memberA.messaging.messages.list(b.id)).rejects.toMatchObject({ status: 404 });
    await expect(second.messaging.support.claim(a.id, 1, { requestId: 'cross-tenant' })).rejects.toMatchObject({ status: 404 });
    const forged = await first.request('/api/messaging/support', { method: 'POST', headers: { 'Idempotency-Key': 'forged-tenant' }, body: { inboxId: 'team', tenantId: 'other' } }); expect(forged.status).toBe(422);
  } finally { await f.close(); }
}, 90000);

test('enabling portal on an existing installation retains peer history but does not retain a member peer-read or replay grant', async () => {
  const f = await portalFixture({ messaging: { support: {} } }), admin = f.peer(), member = f.peer(), other = f.peer();
  try {
    await admin.register('retained-owner'); await member.register('retained-member'); await other.register('retained-other');
    const input = { kind: 'group' as const, userIds: [admin.id, other.id] }, request = { requestId: 'retained-peer-create' };
    const prior = await member.messaging.conversations.create(input, request);
    await member.messaging.messages.send(prior.id, { text: 'SYNTHETIC_RETAINED_HISTORY' }, { requestId: 'retained-peer-turn' });
    f.config.messaging = { support: {}, portal: true }; await f.restart();
    await admin.login('retained-owner'); await member.login('retained-member'); await other.login('retained-other');
    expect(await member.messaging.capabilities()).toMatchObject({ portal: true });
    expect((await member.messaging.receipt(request.requestId))?.resourceId).toBe(prior.id);
    await expect(member.messaging.conversations.create(input, request)).rejects.toMatchObject({ status: 403 });
    await expect(member.messaging.messages.list(prior.id)).rejects.toMatchObject({ status: 404 });
    await expect(other.messaging.conversations.get(prior.id)).rejects.toMatchObject({ status: 404 });
    expect((await member.messaging.conversations.list()).items).toEqual([]);
    expect((await admin.messaging.messages.list(prior.id)).items[0]?.text).toBe('SYNTHETIC_RETAINED_HISTORY');
    const routed = await member.messaging.support.open({ mode: 'human' }, { requestId: 'retained-portal-new' });
    expect((await admin.messaging.support.queue()).items.map(row => row.id)).toEqual([routed.id]);
  } finally { await f.close(); }
}, 90000);
