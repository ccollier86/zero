import { expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { EmailInboxStateStore } from './inbox-state-store';
import { emptyEmailCompose, type EmailInboxSendResult } from './contracts';
import { validateCompose } from './compose-validation';

test('durable revisions, owner isolation, concurrent connections and receipt recovery never resend', async () => {
  const root = await mkdtemp(join(tmpdir(), 'email-inbox-state-')), path = join(root, 'mail.sqlite');
  let a = new EmailInboxStateStore(path), b = new EmailInboxStateStore(path);
  const value = { ...emptyEmailCompose('sender'), to: ['receiver@example.test'], subject: 'Synthetic', text: 'Body' };
  try {
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const draft = a.save('user-a', 'account', { id: 'draft-0001', revision: 0, value });
    expect(() => b.save('user-a', 'account', { ...draft, revision: 0 })).toThrow();
    expect(() => b.get('user-b', 'account', draft.id)).toThrow();
    expect(a.reserveSend('user-a', 'account', 'operation-1', 'digest', draft)).toBeNull();
    expect(b.get('user-a', 'account', draft.id).pendingSend).toEqual({ operationId: 'operation-1', status: 'sending' });
    expect(() => b.save('user-a', 'account', draft)).toThrow();
    expect(() => b.delete('user-a', 'account', draft.id, draft.revision)).toThrow();
    expect(() => b.reserveSend('user-a', 'account', 'different-op', 'digest', draft)).toThrow();
    a.close(); a = new EmailInboxStateStore(path);
    expect(() => a.reserveSend('user-a', 'account', 'operation-1', 'digest', draft)).toThrow();
    const receipt: EmailInboxSendResult = { operationId: 'operation-1', status: 'accepted', accepted: value.to, rejected: [], sentCopy: 'failed' };
    a.finishSend('user-a', 'account', receipt.operationId, 'accepted', receipt);
    expect(() => b.finishSend('user-a', 'account', receipt.operationId, 'unknown')).toThrow();
    a.delete('user-a', 'account', draft.id, draft.revision);
    expect(b.reserveSend('user-a', 'account', receipt.operationId, 'digest', draft)).toEqual(receipt);
    expect(() => b.reserveSend('user-a', 'account', receipt.operationId, 'changed', draft)).toThrow();
    expect(b.reserveSend('user-b', 'account', receipt.operationId, 'other-user')).toBeNull();
  } finally { a.close(); b.close(); await rm(root, { recursive: true, force: true }); }
});
test('draft paging/count/search is complete beyond 200 and private paths cannot overwrite another database', async () => {
  const root = await mkdtemp(join(tmpdir(), 'email-inbox-pages-')), path = join(root, 'mail.sqlite');
  const store = new EmailInboxStateStore(path);
  try {
    for (let index = 0; index < 205; index++) store.save('owner', 'mail', { id: `draft-${String(index).padStart(4, '0')}`, revision: 0, value: { ...emptyEmailCompose(), subject: `Note ${index}` } });
    const ids = new Set<string>(); let cursor: string | undefined;
    do { const page = store.browse('owner', 'mail', { cursor, limit: 40 }); expect(page.total).toBe(205); page.drafts.forEach(draft => ids.add(draft.id)); cursor = page.cursor; } while (cursor);
    expect(ids.size).toBe(205); expect(store.browse('owner', 'mail', { search: 'Note 204' }).total).toBe(1);
    expect(store.browse('owner', 'mail', { search: '%' }).total).toBe(0);
    const unrelated = join(root, 'other.sqlite'), db = new Database(unrelated); db.exec('CREATE TABLE important(id INTEGER)'); db.close(); await chmod(unrelated, 0o600);
    expect(() => new EmailInboxStateStore(unrelated)).toThrow('different database');
    const unchanged = new Database(unrelated); expect(unchanged.query("SELECT name FROM sqlite_master WHERE name='important'").get()).toBeTruthy(); unchanged.close();
    await chmod(path, 0o644); expect(() => new EmailInboxStateStore(path)).toThrow('0600');
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
test('large attachment admission is linear and validates decoded size and header boundaries', () => {
  const value = { ...emptyEmailCompose('sender'), to: ['receiver@example.test'], subject: 'Hello', text: 'Body', attachments: [{ id: 'file', filename: 'sample.bin', contentType: 'application/octet-stream', size: 1024 * 1024, base64: Buffer.alloc(1024 * 1024).toString('base64') }] };
  expect(validateCompose(value, true).attachments[0]?.size).toBe(1024 * 1024);
  expect(() => validateCompose({ ...value, subject: 'Hello\r\nBcc: attacker@example.test' }, true)).toThrow();
  expect(() => validateCompose({ ...value, attachments: [{ ...value.attachments[0], base64: value.attachments[0]!.base64 + '!' }] }, true)).toThrow();
});
