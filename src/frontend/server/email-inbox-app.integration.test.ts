/** Managed createApp, real Guardian and loopback SMTP/IMAP. No external email is sent. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PostalMime from 'postal-mime';
import { smtpFixture } from '../../email/test-support/smtp-fixture';
import { imapFixture } from '../../email/test-support/imap-fixture';
import { EMAIL_INBOX_API as API, emptyEmailCompose } from '../../email/inbox/contracts';
import { createApp } from './app-factory';
import { ImapMailbox } from '../../email/imap-mailbox';

test('managed inbox authenticates, reads/pages/filters, downloads, saves drafts and deduplicates real sends', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zero-inbox-app-')), smtp = await smtpFixture(), imap = await imapFixture();
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    await mkdir(join(root, 'app'));
    app = await createApp({ db: { mode: 'memory' }, systemDb: { mode: 'memory' }, tables: {}, app: { name: 'Mail', publicUrl: 'https://app.example.test' },
      auth: { bootstrap: 'public', registration: { mode: 'admin-only' } },
      email: { provider: 'smtp', smtp: smtp.config, imap: { ...imap.config, sentFolder: 'Sent' }, from: 'Studio <sender@example.test>', inbox: { statePath: join(root, 'private', 'mail.sqlite') } },
      appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
      serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false,
      workflows: false, stateSync: false, ai: false, vector: false, pdf: false, kv: false, observability: { console: false, endpoint: false } });
    app.listen({ hostname: '127.0.0.1', port: 0 }); const origin = `http://127.0.0.1:${app.server!.port}`;
    const request = async (path: string, value?: object, bearer?: string) => {
      const response = await fetch(origin + path, { method: value ? 'POST' : 'GET', headers: { ...(value ? { 'Content-Type': 'application/json' } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, ...(value ? { body: JSON.stringify(value) } : {}) });
      return { status: response.status, data: await response.json() as any, headers: response.headers };
    };
    expect((await request(API + '/accounts')).status).toBe(401);
    const registered = await request('/auth/register', { username: 'mail-owner', email: 'owner@example.test', password: 'Synthetic-only-password-123' }); expect(registered.status).toBe(200);
    const token = registered.data.accessToken;
    const member = await request('/auth/admin/users', { username: 'mail-member', email: 'member@example.test', password: 'Synthetic-only-password-456' }, token); expect(member.status).toBe(200);
    const memberSession = await request('/auth/login', { username: 'mail-member', password: 'Synthetic-only-password-456' }); expect(memberSession.status).toBe(200);
    expect((await request(API + '/accounts', undefined, memberSession.data.accessToken)).status).toBe(403);
    const catalog = await request(API + '/accounts', undefined, token); expect(catalog.status).toBe(200); expect(catalog.headers.get('cache-control')).toBe('private, no-store');
    expect(catalog.data).toMatchObject([{ id: 'default', address: 'sender@example.test', capabilities: { send: true, live: true } }]);
    expect(JSON.stringify(catalog.data)).not.toContain('test-password');
    expect((await request(API + '/messages', { account: 'unadmitted', query: { folder: 'INBOX' } }, token)).status).toBe(403);
    const folders = await request(API + '/folders?account=default', undefined, token); expect(folders.status).toBe(200);
    expect(folders.data.find((folder: any) => folder.path === 'INBOX')).toMatchObject({ total: 2, unread: 2 });
    const first = await request(API + '/messages', { account: 'default', query: { folder: 'INBOX', limit: 1 } }, token);
    expect(first.status).toBe(200); expect(first.data.total).toBe(2); expect(first.data.messages.map((row: any) => row.ref.uid)).toEqual([3]);
    const next = await request(API + '/messages', { account: 'default', query: { folder: 'INBOX', cursor: first.data.cursor, limit: 1 } }, token);
    expect(next.data.messages.map((row: any) => row.ref.uid)).toEqual([1]);
    const filtered = await request(API + '/messages', { account: 'default', query: { folder: 'INBOX', search: 'Message 1' } }, token);
    expect(filtered.data.total).toBe(1);
    const ref = first.data.messages[0].ref;
    const detail = await request(API + '/message', { account: 'default', ref }, token); expect(detail.status).toBe(200); expect(detail.data.text.trim()).toBe('Body 3');
    expect(detail.data.attachments[0]).toMatchObject({ id: '0', filename: 'sample.txt', size: 16 }); expect(detail.data.attachments[0].content).toBeUndefined();
    expect(detail.data.flags).not.toContain('\\Seen');
    const download = await fetch(origin + API + '/attachment', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ account: 'default', ref, id: '0' }) });
    expect(download.status).toBe(200); expect(download.headers.get('x-content-type-options')).toBe('nosniff'); expect(download.headers.get('content-type')).toBe('application/octet-stream'); expect(await download.text()).toBe('attachment bytes');
    expect((await request(API + '/flags', { account: 'default', ref, flags: { seen: true, flagged: true } }, token)).status).toBe(200);
    const unread = await request(API + '/messages', { account: 'default', query: { folder: 'INBOX', filter: 'unread' } }, token); expect(unread.data.total).toBe(1);
    const value = { ...emptyEmailCompose('default'), to: ['receiver@example.test'], subject: 'A synthetic message', text: 'Testing delivery.', html: '<p>Testing delivery.</p>' };
    const unfinished = { ...value, recipientDrafts: { to: 'unfinished@' } };
    expect((await request(API + '/draft/save', { account: 'default', id: 'draft-pending', revision: 0, value: unfinished }, token)).status).toBe(200);
    const pending = await request(API + '/draft/read', { account: 'default', id: 'draft-pending' }, token); expect(pending.data.value.recipientDrafts.to).toBe('unfinished@');
    expect((await request(API + '/send', { account: 'default', operationId: 'pending-operation', value: unfinished, draft: { id: 'draft-pending', revision: 1 } }, token)).status).toBe(400);
    expect(smtp.messages).toHaveLength(0);
    const draft = await request(API + '/draft/save', { account: 'default', id: 'draft-0001', revision: 0, value }, token); expect(draft.status).toBe(200); expect(draft.data.revision).toBe(1);
    expect((await request(API + '/draft/save', { account: 'default', id: 'draft-0001', revision: 0, value }, token)).status).toBe(409);
    const send = { account: 'default', operationId: 'operation-0001', value, draft: { id: 'draft-0001', revision: 1 } };
    const receipt = await request(API + '/send', send, token); expect(receipt.status).toBe(200); expect(receipt.data).toMatchObject({ status: 'accepted', sentCopy: 'saved' });
    expect((await request(API + '/send', send, token)).data).toEqual(receipt.data); expect(smtp.messages).toHaveLength(1);
    expect((await PostalMime.parse(smtp.messages[0]!)).text?.trim()).toBe('Testing delivery.');
    expect((await request(API + '/send', { ...send, value: { ...value, text: 'Changed' } }, token)).status).toBe(409); expect(smtp.messages).toHaveLength(1);
    expect((await request(API + '/draft/read', { account: 'default', id: 'draft-0001' }, token)).status).toBe(404);
    expect((await request(API + '/move', { account: 'default', ref, destination: 'Trash' }, token)).status).toBe(200);
    expect((await request(API + '/message', { account: 'default', ref }, token)).status).toBe(404);
    const abortA = new AbortController(), abortB = new AbortController();
    const headers = { Authorization: `Bearer ${token}` }, url = origin + API + '/live?account=default&folder=INBOX';
    const streamA = await fetch(url, { headers, signal: abortA.signal }), streamB = await fetch(url, { headers, signal: abortB.signal });
    expect(streamA.headers.get('content-type')).toBe('text/event-stream'); const readerA = streamA.body!.getReader(), readerB = streamB.body!.getReader();
    expect(new TextDecoder().decode((await readerA.read()).value)).toContain('connected'); await readerB.read(); await imap.ready();
    expect(imap.openConnections).toBe(1); // Two browser subscriptions share one provider IDLE connection.
    imap.arrive(); const chunks: string[] = [];
    for (let index = 0; index < 4 && !chunks.some(chunk => chunk.includes('arrival')); index++) chunks.push(new TextDecoder().decode((await readerA.read()).value));
    expect(chunks.join('')).toContain('arrival'); abortA.abort(); abortB.abort(); await readerA.cancel().catch(() => {}); await readerB.cancel().catch(() => {});
  } finally { try { await app?.stop(true); } finally { await smtp.close(); await imap.close(); await rm(root, { recursive: true, force: true }); } }
}, 60_000);

test('resolver revocation fences late mail reads and cannot erase an accepted send receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zero-inbox-revocation-')), imap = await imapFixture(), mailbox = new ImapMailbox(imap.config);
  let app: Awaited<ReturnType<typeof createApp>> | undefined, allowed = true, sendCount = 0;
  let releaseRead!: () => void, startedRead!: () => void, releaseSend!: () => void, startedSend!: () => void;
  const reading = new Promise<void>(resolve => { startedRead = resolve; }), readGate = new Promise<void>(resolve => { releaseRead = resolve; });
  const sending = new Promise<void>(resolve => { startedSend = resolve; }), sendGate = new Promise<void>(resolve => { releaseSend = resolve; });
  const original = mailbox.read.bind(mailbox); mailbox.read = async (...args) => { startedRead(); await readGate; return original(...args); };
  const sender = { name: 'capture', async send() { sendCount++; startedSend(); await sendGate; return { provider: 'capture', accepted: ['receiver@example.test'] }; } };
  try {
    await mkdir(join(root, 'app'));
    app = await createApp({ db: { mode: 'memory' }, systemDb: { mode: 'memory' }, tables: {}, auth: { bootstrap: 'public' },
      email: { provider: sender, from: 'sender@example.test', inbox: { statePath: join(root, 'mail.sqlite'), accounts: () => allowed ? [{ id: 'owned', label: 'Owned mailbox', address: 'sender@example.test', mailbox, sender, sendAs: [{ id: 'from', address: 'sender@example.test' }] }] : [] } },
      appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
      serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false,
      workflows: false, stateSync: false, ai: false, vector: false, pdf: false, kv: false, observability: { console: false, endpoint: false } });
    app.listen({ hostname: '127.0.0.1', port: 0 }); const origin = `http://127.0.0.1:${app.server!.port}`;
    const post = async (path: string, body: object, token?: string) => { const result = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); return { status: result.status, data: await result.json() as any }; };
    const registered = await post('/auth/register', { username: 'mail-owner', email: 'owner@example.test', password: 'Synthetic-only-password-123' }); expect(registered.status).toBe(200); const token = registered.data.accessToken;
    const pendingRead = post(API + '/message', { account: 'owned', ref: { folder: 'INBOX', uidValidity: '123', uid: 3 } }, token);
    await reading; allowed = false; releaseRead(); const read = await pendingRead; expect(read.status).toBe(403); expect(JSON.stringify(read.data)).not.toContain('Body 3');
    allowed = true;
    const value = { ...emptyEmailCompose('from'), to: ['receiver@example.test'], subject: 'One send', text: 'Synthetic body' };
    const draft = await post(API + '/draft/save', { account: 'owned', id: 'draft-0001', revision: 0, value }, token); expect(draft.status).toBe(200);
    const input = { account: 'owned', operationId: 'operation-0001', value, draft: { id: 'draft-0001', revision: 1 } };
    const pendingSend = post(API + '/send', input, token); await sending; allowed = false; releaseSend(); const retired = await pendingSend;
    expect(retired.status).toBe(403); expect(retired.data.code).toBe('EMAIL_SEND_OUTCOME_UNKNOWN');
    allowed = true; const replay = await post(API + '/send', input, token); expect(replay.status).toBe(200); expect(replay.data.status).toBe('accepted'); expect(sendCount).toBe(1);
  } finally { releaseRead(); releaseSend(); try { await app?.stop(true); } finally { await mailbox.close(); await imap.close(); await rm(root, { recursive: true, force: true }); } }
}, 60_000);
