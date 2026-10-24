/** Private durable draft revisions and send receipts. Never uses Guardian's account-action outbox. */
import { Database } from 'bun:sqlite';
import { existsSync, lstatSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { EmailComposeValue, EmailInboxDraft, EmailInboxSendResult } from './contracts';
import { EmailError } from '../email-error';

const APPLICATION_ID = 0x5a454d4c;
export class EmailInboxStateStore {
  private readonly db: Database;
  constructor(path: string) {
    if (!path || typeof path !== 'string') throw new Error('[email.inbox] A private statePath is required for durable drafts and send receipts.');
    if (path !== ':memory:') {
      path = resolve(path); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      if (existsSync(path)) {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('[email.inbox] State must be a regular private SQLite file (mode 0600).');
      } else closeSync(openSync(path, 'wx', 0o600));
    }
    this.db = new Database(path);
    const id = this.db.query('PRAGMA application_id').get() as { application_id: number };
    const tables = this.db.query("SELECT name FROM sqlite_master WHERE type='table'").all();
    if (id.application_id !== APPLICATION_ID && (id.application_id !== 0 || tables.length)) {
      this.db.close(); throw new Error('[email.inbox] statePath points to a different database. Use a dedicated email state file.');
    }
    this.db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS email_drafts(owner TEXT NOT NULL, account TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, updated TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(owner,account,id));
      CREATE TABLE IF NOT EXISTS email_sends(owner TEXT NOT NULL, account TEXT NOT NULL, id TEXT NOT NULL, digest TEXT NOT NULL, status TEXT NOT NULL, result TEXT, created TEXT NOT NULL, draft_id TEXT, PRIMARY KEY(owner,account,id));`);
    if (!(this.db.query('PRAGMA table_info(email_sends)').all() as { name: string }[]).some(column => column.name === 'draft_id')) this.db.exec('ALTER TABLE email_sends ADD COLUMN draft_id TEXT');
    this.db.exec('CREATE INDEX IF NOT EXISTS email_sends_draft ON email_sends(owner,account,draft_id,status)');
  }
  count(owner: string, account: string): number { return (this.db.query('SELECT count(*) AS count FROM email_drafts WHERE owner=? AND account=?').get(owner, account) as { count: number }).count; }
  browse(owner: string, account: string, options: { search?: string; cursor?: string; limit?: number } = {}) {
    const limit = Math.max(1, Math.min(100, options.limit ?? 40));
    let after: [string, string] | undefined;
    if (options.cursor) {
      try { const parsed = JSON.parse(Buffer.from(options.cursor, 'base64url').toString());
        if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some(value => typeof value !== 'string' || value.length > 128)) throw new Error(); after = parsed as [string, string];
      } catch { throw new EmailError('Invalid draft cursor.', 'EMAIL_INBOX_INPUT_INVALID', 400); }
    }
    const needle = '%' + (options.search ?? '').replace(/[\\%_]/g, '\\$&') + '%';
    const predicate = "owner=? AND account=?" + (options.search ? " AND (json_extract(value,'$.subject') || ' ' || json_extract(value,'$.text') || ' ' || json_extract(value,'$.to')) LIKE ? ESCAPE '\\'" : '');
    const params = options.search ? [owner, account, needle] : [owner, account];
    const total = (this.db.query(`SELECT count(*) AS count FROM email_drafts WHERE ${predicate}`).get(...params) as { count: number }).count;
    // List summaries never deserialize attachment base64 or full HTML into the server/browser heap.
    const columns = "id,updated,json_extract(value,'$.subject') AS subject,json_extract(value,'$.to') AS recipients,substr(json_extract(value,'$.text'),1,200) AS preview,json_array_length(value,'$.attachments') AS attachmentCount";
    const rows = (after ? this.db.query(`SELECT ${columns} FROM email_drafts WHERE ${predicate} AND (updated,id)<(?,?) ORDER BY updated DESC,id DESC LIMIT ?`).all(...params, ...after, limit + 1)
      : this.db.query(`SELECT ${columns} FROM email_drafts WHERE ${predicate} ORDER BY updated DESC,id DESC LIMIT ?`).all(...params, limit + 1)) as DraftSummaryRow[];
    const next = rows.length > limit; rows.length = Math.min(rows.length, limit); const last = rows.at(-1);
    return { drafts: rows.map(row => ({ id: row.id, updatedAt: row.updated, subject: row.subject, to: JSON.parse(row.recipients) as string[], preview: row.preview, attachmentCount: row.attachmentCount })), total,
      cursor: next && last ? Buffer.from(JSON.stringify([last.updated, last.id])).toString('base64url') : undefined };
  }
  get(owner: string, account: string, id: string): EmailInboxDraft {
    const row = this.db.query('SELECT id,revision,updated,value FROM email_drafts WHERE owner=? AND account=? AND id=?').get(owner, account, id) as DraftRow | null;
    if (!row) throw new EmailError('Draft was not found.', 'EMAIL_DRAFT_NOT_FOUND', 404);
    const draft = readDraft(row);
    const pending = this.db.query("SELECT id,status FROM email_sends WHERE owner=? AND account=? AND draft_id=? AND status IN ('sending','unknown') ORDER BY created DESC LIMIT 1").get(owner, account, id) as { id: string; status: 'sending' | 'unknown' } | null;
    if (pending) draft.pendingSend = { operationId: pending.id, status: pending.status };
    return draft;
  }
  save(owner: string, account: string, input: { id: string; revision: number; value: EmailComposeValue }): EmailInboxDraft {
    const updatedAt = new Date().toISOString();
    this.db.transaction(() => {
      this.assertDraftNotSending(owner, account, input.id);
      const value = JSON.stringify(input.value);
      if (input.revision === 0) {
        const result = this.db.query('INSERT OR IGNORE INTO email_drafts(owner,account,id,revision,updated,value) VALUES(?,?,?,1,?,?)').run(owner, account, input.id, updatedAt, value);
        if (!result.changes) throw conflict();
      } else {
        const result = this.db.query('UPDATE email_drafts SET revision=revision+1,updated=?,value=? WHERE owner=? AND account=? AND id=? AND revision=?').run(updatedAt, value, owner, account, input.id, input.revision);
        if (!result.changes) throw conflict();
      }
    }).immediate();
    return { id: input.id, revision: input.revision + 1, updatedAt, value: input.value };
  }
  delete(owner: string, account: string, id: string, revision: number): void {
    this.db.transaction(() => {
      this.assertDraftNotSending(owner, account, id);
      if (!this.db.query('DELETE FROM email_drafts WHERE owner=? AND account=? AND id=? AND revision=?').run(owner, account, id, revision).changes) throw conflict();
    }).immediate();
  }
  reserveSend(owner: string, account: string, id: string, digest: string, draft?: { id: string; revision: number }, expectedValue?: EmailComposeValue): EmailInboxSendResult | null {
    return this.db.transaction(() => {
      const previous = this.db.query('SELECT digest,status,result FROM email_sends WHERE owner=? AND account=? AND id=?').get(owner, account, id) as { digest: string; status: string; result: string | null } | null;
      if (previous) {
        if (previous.digest !== digest) throw new EmailError('Send identifier was already used for different content.', 'EMAIL_SEND_ID_CONFLICT', 409);
        if (previous.status === 'accepted' && previous.result) return JSON.parse(previous.result) as EmailInboxSendResult;
        throw new EmailError(previous.status === 'rejected' ? 'This send was rejected. Review the message before trying a new send.'
          : 'The result of this send is not confirmed. Check Sent before sending another copy.', previous.status === 'rejected' ? 'EMAIL_SEND_REJECTED' : 'EMAIL_SEND_OUTCOME_UNKNOWN', previous.status === 'rejected' ? 422 : 409);
      }
      if (draft) {
        const saved = this.get(owner, account, draft.id);
        if (saved.revision !== draft.revision || expectedValue && JSON.stringify(saved.value) !== JSON.stringify(expectedValue)) throw conflict();
      }
      if (draft) this.assertDraftNotSending(owner, account, draft.id);
      this.db.query("INSERT INTO email_sends(owner,account,id,digest,status,created,draft_id) VALUES(?,?,?,?,'sending',?,?)").run(owner, account, id, digest, new Date().toISOString(), draft?.id ?? null);
      return null;
    }).immediate();
  }
  finishSend(owner: string, account: string, id: string, status: 'accepted' | 'rejected' | 'unknown', result?: EmailInboxSendResult): void {
    const updated = this.db.query("UPDATE email_sends SET status=?,result=? WHERE owner=? AND account=? AND id=? AND status='sending'").run(status, result ? JSON.stringify(result) : null, owner, account, id);
    if (!updated.changes) throw new EmailError('The send receipt is no longer writable. Reconcile the original send.', 'EMAIL_SEND_OUTCOME_UNKNOWN', 409);
  }
  close(): void { this.db.close(); }
  private assertDraftNotSending(owner: string, account: string, id: string): void {
    if (this.db.query("SELECT 1 FROM email_sends WHERE owner=? AND account=? AND draft_id=? AND status IN ('sending','unknown') LIMIT 1").get(owner, account, id)) {
      throw new EmailError('This draft has an unconfirmed send. Check Sent before creating another copy.', 'EMAIL_SEND_OUTCOME_UNKNOWN', 409);
    }
  }
}
interface DraftRow { id: string; revision: number; updated: string; value: string }
interface DraftSummaryRow { id: string; updated: string; subject: string; recipients: string; preview: string; attachmentCount: number }
function readDraft(row: DraftRow): EmailInboxDraft { return { id: row.id, revision: row.revision, updatedAt: row.updated, value: JSON.parse(row.value) }; }
function conflict() { return new EmailError('This draft changed in another editor. Reopen it before saving.', 'EMAIL_DRAFT_CONFLICT', 409); }
