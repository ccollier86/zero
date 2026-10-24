/** Synthetic adapter for component/controller qualification only. Never a production mailbox implementation. */
import { EMAIL_DRAFT_FOLDER, emailMessageKey, type EmailInboxSource, type EmailInboxMessage, type EmailInboxDraft, type EmailInboxLiveEvent } from '../../email/inbox/contracts';

export const FIXTURE_EMAIL_HTML = `<!doctype html><html><head><style>
  body{font-family:Arial,sans-serif;color:#26332e;font-size:14px;line-height:1.7}.eyebrow{font-size:10px;letter-spacing:2px;color:#6c8275}.title{font-size:30px;line-height:1.2;font-weight:500;letter-spacing:-1px}.note{background:#f0f5f1;border-radius:8px;padding:16px}td{padding:12px 0;border-bottom:1px solid #e8eee9}table{width:100%;border-collapse:collapse}.muted{color:#78877d;font-size:12px}@media(max-width:500px){.title{font-size:24px}}
  </style></head><body><div class="eyebrow">NORTHSTAR STUDIO / WEEKLY NOTE</div><p class="title">Good things are<br>coming together.</p><p>Hi Jordan,</p><p>The final pieces are in place. Here’s a quick look at where we are before Monday’s launch.</p>
  <table><tr><td>Brand &amp; design</td><td style="text-align:right;color:#47715a">Ready for launch</td></tr><tr><td>Website &amp; content</td><td style="text-align:right;color:#47715a">Final review</td></tr><tr><td>Customer experience</td><td style="text-align:right;color:#47715a">All set</td></tr></table>
  <p class="note">A small team, doing thoughtful work.<br>Thank you for making room for the details.</p><p>I’ve attached the final handoff notes. Let me know if there’s anything you’d like to go over.</p><p>Talk soon,<br><b>Alex</b></p><p class="muted">Alex Morgan · Northstar Studio</p><img src="https://tracker.invalid/email-open" width="1" height="1" alt=""></body></html>`;

export function createEmailInboxFixture() {
  const accounts = [{ id: 'studio', label: 'Northstar Studio', address: 'hello@example.test', sendAs: [{ id: 'hello', name: 'Jordan Lee', address: 'hello@example.test' }], capabilities: { send: true, flags: true, move: true, drafts: true, live: true } },
    { id: 'personal', label: 'Personal inbox', address: 'jordan@example.test', sendAs: [{ id: 'personal', address: 'jordan@example.test' }], capabilities: { send: true, flags: true, move: true, drafts: true, live: true } }];
  const folders = [{ path: 'INBOX', name: 'Inbox', flags: [], total: 48, unread: 12 }, { path: EMAIL_DRAFT_FOLDER, name: 'Drafts', specialUse: '\\Drafts', flags: [], total: 0 },
    { path: 'Sent', name: 'Sent', specialUse: '\\Sent', flags: [], total: 0 }, { path: 'Archive', name: 'Archive', specialUse: '\\Archive', flags: [], total: 0 },
    { path: 'Trash', name: 'Trash', specialUse: '\\Trash', flags: [], total: 0 }, { path: 'Projects', name: 'Projects', flags: [] }];
  const people = ['Alex Morgan', 'Sam Rivera', 'Taylor Brooks', 'Jamie Park', 'Casey Hart', 'Morgan Ellis'];
  const subjects = ['Everything is ready for Monday', 'A few thoughts on the new direction', 'Your workspace, all in one place', 'Notes from our conversation', 'The little details that matter', 'Looking ahead to next week'];
  const previews = ['The final pieces are in place. Here’s a quick look…', 'I had some time to think about what you shared.', 'A simpler way to keep the team moving.', 'Thanks again for making the time today.', 'Thought you might appreciate this update.', 'Let’s make a little room for the next chapter.'];
  let uid = 48, sent = 0;
  const messages = new Map<string, EmailInboxMessage>();
  for (let i = 0; i < 48; i++) {
    const ref = { folder: 'INBOX', uidValidity: '100', uid: 48 - i }, id = emailMessageKey(ref), person = people[i % 6]!;
    messages.set(id, { id, ref, subject: subjects[i % 6]!, from: [{ name: person, address: person.toLowerCase().replace(' ', '.') + '@example.test' }],
      to: [{ name: 'Jordan Lee', address: 'hello@example.test' }], cc: [], bcc: [], replyTo: [], date: new Date(Date.UTC(2026, 9, 23, 14, 30) - i * 3_600_000).toISOString(),
      text: i === 0 ? 'Hi Jordan, The final pieces are in place. Talk soon, Alex.' : previews[i % 6]!, html: i === 0 ? FIXTURE_EMAIL_HTML : `<p>Hi Jordan,</p><p>${previews[i % 6]}</p><p>Best,<br>${person}</p>`,
      preview: previews[i % 6]!, flags: i < 4 || i % 7 === 0 ? [] : ['\\Seen'], size: 2048, attachmentCount: i === 0 ? 1 : 0,
      messageId: `<synthetic-${48 - i}@example.test>`, attachments: i === 0 ? [{ id: '0', filename: 'Launch handoff.pdf', contentType: 'application/pdf', size: 24576 }] : [] });
  }
  const drafts = new Map<string, EmailInboxDraft>(), listeners = new Set<(event: EmailInboxLiveEvent) => void>();
  const notify = () => { for (const listener of listeners) listener({ type: 'connected' }); };
  const source: EmailInboxSource = {
    async accounts() { return structuredClone(accounts); }, async folders() { return structuredClone(folders.map(folder => folder.path === EMAIL_DRAFT_FOLDER ? { ...folder, total: drafts.size } : folder)); },
    async list(account, query) {
      if (query.folder === EMAIL_DRAFT_FOLDER) return { folder: query.folder, uidValidity: 'drafts', total: drafts.size, messages: [...drafts.values()].map(draft => ({ id: 'draft:' + draft.id, draftId: draft.id, from: [], to: draft.value.to.map(address => ({ address })), subject: draft.value.subject, date: draft.updatedAt, size: 0, flags: ['\\Draft'], preview: draft.value.text })) };
      const rows = account === 'personal' ? [] : [...messages.values()].filter(value => value.ref.folder === query.folder && (!query.search || `${value.subject} ${value.text}`.toLowerCase().includes(query.search.toLowerCase())) && (query.filter !== 'unread' || !value.flags.includes('\\Seen')) && (query.filter !== 'starred' || value.flags.includes('\\Flagged'))).sort((a, b) => b.ref.uid - a.ref.uid);
      const start = Number(query.cursor ?? 0), limit = query.limit ?? 40;
      return structuredClone({ folder: query.folder, uidValidity: '100', total: rows.length, messages: rows.slice(start, start + limit).map(({ html: _, text: __, attachments: ___, ...row }) => row), ...(rows.length > start + limit ? { cursor: String(start + limit) } : {}) });
    },
    async read(_account, ref) { const value = messages.get(emailMessageKey(ref)); if (!value) throw new Error('Message was removed.'); return structuredClone(value); },
    async attachment() { return new Blob(['Synthetic email attachment.'], { type: 'application/octet-stream' }); },
    async setFlags(_account, ref, flags) { const value = messages.get(emailMessageKey(ref)); if (!value) return; const next = new Set(value.flags); for (const [key, on] of Object.entries(flags)) { const flag = key === 'seen' ? '\\Seen' : '\\Flagged'; if (on) next.add(flag); else next.delete(flag); } value.flags = [...next]; notify(); },
    async move(_account, ref, destination) { const value = messages.get(emailMessageKey(ref))!; messages.delete(value.id); value.ref = { ...ref, folder: destination }; value.id = emailMessageKey(value.ref); messages.set(value.id, value); notify(); return value.ref; },
    async getDraft(_account, id) { if (!drafts.has(id)) throw new Error('Draft not found.'); return structuredClone(drafts.get(id)!); },
    async saveDraft(_account, input) { const previous = drafts.get(input.id); if ((previous?.revision ?? 0) !== input.revision) throw Object.assign(new Error('Draft revision conflict.'), { code: 'EMAIL_DRAFT_CONFLICT' }); const next = { ...input, revision: input.revision + 1, updatedAt: new Date().toISOString() }; drafts.set(input.id, structuredClone(next)); return structuredClone(next); },
    async deleteDraft(_account, input) { drafts.delete(input.id); notify(); },
    async send(_account, input) { sent++; if (input.draft) drafts.delete(input.draft.id); notify(); return { operationId: input.operationId, status: 'accepted', accepted: input.value.to, rejected: [], sentCopy: 'saved' }; },
    async *watch(_account, _folder, options) {
      const queue: EmailInboxLiveEvent[] = [{ type: 'connected' }]; let wake: (() => void) | undefined;
      const listener = (event: EmailInboxLiveEvent) => { queue.push(event); wake?.(); wake = undefined; };
      const abort = () => { wake?.(); wake = undefined; };
      listeners.add(listener); options?.signal?.addEventListener('abort', abort, { once: true });
      try { while (!options?.signal?.aborted) { const next = queue.shift(); if (next) yield next; else await new Promise<void>(resolve => { wake = resolve; }); } }
      finally { listeners.delete(listener); options?.signal?.removeEventListener('abort', abort); }
    },
  };
  return { source, messages, drafts, get sent() { return sent; }, get watchers() { return listeners.size; },
    arrive() { const first = [...messages.values()][0]!; const ref = { folder: 'INBOX', uidValidity: '100', uid: ++uid }, id = emailMessageKey(ref);
      messages.set(id, { ...structuredClone(first), id, ref, subject: 'A new message just arrived', date: new Date().toISOString(), flags: [], preview: 'Inserted live, without resetting the list.' }); notify(); return id; } };
}
