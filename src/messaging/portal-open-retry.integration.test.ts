/** Native request identity survives display-only changes; caller intent and current admission remain enforced. */
import { expect, test } from 'bun:test';
import { portalFixture } from './test-support/portal-fixture';

test('opening retries retain their original conversation after inbox renaming, without accepting changed caller intent', async () => {
  const f = await portalFixture({ messaging: { portal: true, support: { inboxes: { team: { title: 'Original label' }, other: { title: 'Other' } }, defaultInbox: 'team' } } });
  const admin = f.peer(), member = f.peer();
  try {
    await admin.register('open-retry-owner'); await member.register('open-retry-member');
    const inputs = [{ inboxId: 'team', mode: 'human' as const }, { inboxId: 'team' }, { inboxId: 'team', title: 'Explicit title', mode: 'human' as const }];
    const chats = [];
    for (const [index, input] of inputs.entries()) chats.push(await member.messaging.support.open(input, { requestId: 'open-retry-' + index }));
    await admin.messaging.support.claim(chats[0]!.id, 1, { requestId: 'open-retry-claim' });
    f.config.messaging = { portal: true, support: { inboxes: { team: { title: 'Renamed label' }, other: { title: 'Other' } }, defaultInbox: 'team' } };
    await f.restart(); await member.login('open-retry-member');
    for (const [index, input] of inputs.entries()) {
      expect((await member.messaging.support.open(input, { requestId: 'open-retry-' + index })).id).toBe(chats[index]!.id);
      expect(await member.messaging.receipt('open-retry-' + index)).toMatchObject({ operation: 'support.open', resourceId: chats[index]!.id });
    }
    for (const input of [{ ...inputs[0], title: 'Changed caller title' }, { ...inputs[0], inboxId: 'other' }]) {
      await expect(member.messaging.support.open(input, { requestId: 'open-retry-0' })).rejects.toMatchObject({ code: 'MESSAGING_INTENT_CONFLICT' });
    }
    expect((await member.messaging.conversations.list()).items).toHaveLength(3);
    const forged = await member.request('/api/messaging/support', { method: 'POST', headers: { 'Idempotency-Key': 'forged-open-intent' },
      body: { inboxId: 'team', mode: 'human', openIntent: { title: null, mode: 'human' } } }); expect(forged.status).toBe(422);
  } finally { await f.close(); }
}, 90000);
