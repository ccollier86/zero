/** Real native portal routing through Zero AI/Torrent. Only a held loopback provider and synthetic accounts are used. */
import { expect, test } from 'bun:test';
import { portalFixture } from './test-support/portal-fixture';

async function until(ready: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 15000;
  while (!await ready()) { if (Date.now() >= deadline) throw new Error('Synthetic portal assistant deadline.'); await Bun.sleep(30); }
}

test('an inbox selects its own assistant without a default bot and current customer revocation fences a held reply', async () => {
  let entered = 0, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json(); expect(JSON.stringify(body)).toContain('SYNTHETIC_INBOX_HELPER');
    const call = ++entered; if (call === 2) await held;
    return Response.json({ id: 'synthetic-portal-result-' + call, object: 'chat.completion', created: 1, model: 'chat',
      choices: [{ index: 0, message: { role: 'assistant', content: call === 2 ? 'MUST_NOT_PUBLISH_REVOKED_PORTAL_REPLY' : 'SYNTHETIC_INBOX_ANSWER' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
  } });
  const f = await portalFixture({
    auth: { bootstrap: 'public', userProperties: { portalAccess: { editableBy: 'admin', useInPolicies: true } } }, workflows: {},
    ai: { autoDetect: false, providers: { synthetic: { type: 'openai-compatible', apiKey: 'synthetic-loopback-key', baseURL: 'http://127.0.0.1:' + provider.port + '/v1' } } },
    messaging: { portal: true, assistants: { help: { name: 'Helper', model: 'synthetic/chat', instructions: 'SYNTHETIC_INBOX_HELPER', timeoutMs: 30000 } },
      support: { inboxes: { help: { title: 'Help', assistant: 'help', access: { properties: { portalAccess: 'yes' } } } } }, jobs: { concurrency: 2 } },
  }), admin = f.peer(), member = f.peer();
  const setAccess = (value: string) => admin.json('/auth/admin/users/' + member.id + '/properties/portalAccess', { method: 'PUT', body: { value } });
  try {
    await admin.register('portal-bot-owner'); await member.register('portal-bot-member'); await setAccess('yes'); await member.login('portal-bot-member');
    expect((await member.messaging.assistants.list()).items).toEqual([]);
    expect((await member.messaging.support.inboxes()).items).toMatchObject([{ id: 'help', assistant: true }]);
    const chat = await member.messaging.support.open({ inboxId: 'help', mode: 'assistant' }, { requestId: 'portal-helper-open' });
    expect(chat).toMatchObject({ owner: 'assistant', assistantId: 'help', inboxId: 'help' });
    await member.messaging.messages.send(chat.id, { text: 'SYNTHETIC_FIRST_QUESTION' }, { requestId: 'portal-helper-first' });
    await until(async () => (await member.messaging.messages.list(chat.id)).items.some(row => row.text === 'SYNTHETIC_INBOX_ANSWER'));
    await member.messaging.messages.send(chat.id, { text: 'SYNTHETIC_HELD_QUESTION' }, { requestId: 'portal-helper-held' });
    await until(() => entered === 2); await setAccess('no'); release();
    await until(async () => (await admin.messaging.support.queue({ inboxId: 'help', owner: 'triage' })).items.some(row => row.id === chat.id));
    const queue = await admin.messaging.support.queue({ inboxId: 'help', owner: 'triage' });
    await admin.messaging.support.claim(chat.id, queue.items[0]!.ownerEpoch, { requestId: 'portal-helper-review-claim' });
    expect(JSON.stringify(await admin.messaging.messages.list(chat.id))).not.toContain('MUST_NOT_PUBLISH_REVOKED_PORTAL_REPLY');
    expect((await admin.messaging.review.list(chat.id)).items).toHaveLength(1);
    await member.login('portal-bot-member'); await expect(member.messaging.messages.list(chat.id)).rejects.toMatchObject({ status: 404 });
    await f.restart(); await admin.login('portal-bot-owner');
    expect(JSON.stringify(await admin.messaging.messages.list(chat.id))).not.toContain('MUST_NOT_PUBLISH_REVOKED_PORTAL_REPLY'); expect(entered).toBe(2);
  } finally { release(); await f.close(); await provider.stop(true); }
}, 90000);
