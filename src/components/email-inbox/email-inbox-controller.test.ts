import { expect, test } from 'bun:test';
import { EmailInboxController } from './email-inbox-controller';
import { createEmailInboxFixture } from './email-inbox.test-support';

test('controller scopes ownership, preserves rows during refresh and ignores late reads', async () => {
  const fixture = createEmailInboxFixture(), original = fixture.source.read;
  let release: (() => void) | undefined;
  fixture.source.read = async (...args) => { await new Promise<void>(resolve => { release = resolve; }); return original(...args); };
  const controller = new EmailInboxController(fixture.source, 'owner');
  try {
    await controller.start(); expect(controller.getSnapshot().rows).toHaveLength(40);
    const row = controller.getSnapshot().rows[0]!; const reading = controller.selectRow(row);
    await Bun.sleep(0); await controller.selectAccount('personal'); release?.(); await reading;
    expect(controller.getSnapshot().message).toBeNull(); expect(controller.getSnapshot().rows).toEqual([]);
    await controller.selectAccount('studio'); const before = controller.getSnapshot().rows;
    const refreshing = controller.refresh(); expect(controller.getSnapshot().rows).toBe(before); await refreshing;
  } finally { controller.dispose(); }
});
test('drafts autosave with revisions, survive navigation and send exactly once', async () => {
  const fixture = createEmailInboxFixture(), controller = new EmailInboxController(fixture.source, 'owner');
  try {
    await controller.start(); await controller.compose();
    const draft = controller.getSnapshot().draft!;
    controller.updateDraft({ ...draft.value, to: ['recipient@example.test'], subject: 'Hello', text: 'A real draft', html: '<p>A real draft</p>' });
    await controller.saveDraft(); expect(controller.getSnapshot().draft?.status).toBe('saved'); expect(controller.getSnapshot().draft?.revision).toBe(1);
    await controller.closeDraft(); await controller.openDraft(draft.id); expect(controller.getSnapshot().draft?.value.text).toBe('A real draft');
    await Promise.all([controller.sendDraft(), controller.sendDraft()]); expect(fixture.sent).toBe(1); expect(controller.getSnapshot().draft).toBeNull();
    expect(controller.getSnapshot().notice).toBe('Message accepted for sending.');
  } finally { controller.dispose(); }
});
test('unknown sends keep the operation ID across reopen and allow inspecting Sent without creating another attempt', async () => {
  const fixture = createEmailInboxFixture(), controller = new EmailInboxController(fixture.source, 'owner');
  let operationId: string | undefined;
  fixture.source.send = async (_account, input) => { expect(operationId === undefined || input.operationId === operationId).toBe(true); operationId = input.operationId;
    fixture.drafts.get(input.draft!.id)!.pendingSend = { operationId, status: 'unknown' };
    throw Object.assign(new Error('Unconfirmed outcome'), { code: 'EMAIL_SEND_OUTCOME_UNKNOWN' }); };
  try {
    await controller.start(); await controller.compose(); const draft = controller.getSnapshot().draft!;
    controller.updateDraft({ ...draft.value, to: ['recipient@example.test'], subject: 'Hello', text: 'Body' });
    await expect(controller.sendDraft()).rejects.toThrow(); expect(controller.getSnapshot().draft?.status).toBe('unknown');
    await controller.closeDraft(); await controller.selectFolder('Sent'); await controller.openDraft(draft.id);
    expect(controller.getSnapshot().draft?.operationId).toBe(operationId); expect(controller.getSnapshot().draft?.status).toBe('unknown');
    await expect(controller.sendDraft()).rejects.toThrow(); expect(fixture.sent).toBe(0);
  } finally { controller.dispose(); }
});
test('conflicting drafts pause writes and require an explicit new copy', async () => {
  const fixture = createEmailInboxFixture(), controller = new EmailInboxController(fixture.source, 'owner');
  try {
    await controller.start(); await controller.compose(); await controller.saveDraft();
    const current = controller.getSnapshot().draft!; fixture.drafts.get(current.id)!.revision++;
    controller.updateDraft({ ...current.value, subject: 'Unsaved local edit' });
    await expect(controller.saveDraft()).rejects.toThrow(); expect(controller.getSnapshot().draft?.status).toBe('conflict');
    await expect(controller.closeDraft()).rejects.toThrow();
    controller.copyConflictedDraft(); expect(controller.getSnapshot().draft?.id).not.toBe(current.id);
    await controller.saveDraft(); expect(fixture.drafts.size).toBe(2);
  } finally { controller.dispose(); }
});
test('replies to owned sent mail target the original recipients and quote HTML-only bodies safely', async () => {
  const fixture = createEmailInboxFixture(), controller = new EmailInboxController(fixture.source, 'owner');
  const mail = [...fixture.messages.values()][0]!; mail.from = [{ address: 'hello@example.test' }]; mail.to = [{ address: 'recipient@example.test' }]; mail.cc = [{ address: 'RECIPIENT@example.test' }, { address: 'other@example.test' }]; mail.text = ''; mail.html = '<p>Do not lose this HTML-only message.</p>'; mail.attachments = [];
  try { await controller.start(); await controller.selectRow(controller.getSnapshot().rows[0]!); await controller.compose('reply-all');
    const draft = controller.getSnapshot().draft!; expect(draft.value.to).toEqual(['recipient@example.test']); expect(draft.value.cc).toEqual(['other@example.test']); expect(draft.value.text).toContain('Do not lose this HTML-only message.');
  } finally { controller.dispose(); }
});
test('live insertions preserve older scroll and leave existing rows visible until accepted', async () => {
  const fixture = createEmailInboxFixture(), controller = new EmailInboxController(fixture.source, 'owner');
  try {
    await controller.start(); const rows = controller.getSnapshot().rows; controller.setNearTop(false); const id = fixture.arrive(); await controller.refresh();
    expect(controller.getSnapshot().newMail).toBe(true); expect(controller.getSnapshot().rows).toBe(rows);
    await controller.showLatest(); expect(controller.getSnapshot().rows[0]?.id).toBe(id);
    await controller.nextPage(); expect(controller.getSnapshot().page).toBe(1); expect(controller.getSnapshot().rows.length).toBeGreaterThan(0);
    await controller.previousPage(); expect(controller.getSnapshot().page).toBe(0);
  } finally { controller.dispose(); }
});

test('an untyped adapter failure retains the send ID and freezes the draft for recovery', async () => {
  const fixture = createEmailInboxFixture(), controller = new EmailInboxController(fixture.source, 'owner'); let original: string | undefined;
  fixture.source.send = async (_account, input) => { expect(original === undefined || original === input.operationId).toBe(true); original = input.operationId; throw new Error('Synthetic lost response'); };
  try {
    await controller.start(); await controller.compose(); const draft = controller.getSnapshot().draft!;
    controller.updateDraft({ ...draft.value, to: ['recipient@example.test'], subject: 'Hello', text: 'Body' });
    await expect(controller.sendDraft()).rejects.toThrow(); expect(controller.getSnapshot().draft?.status).toBe('unknown');
    await expect(controller.sendDraft()).rejects.toThrow(); expect(controller.getSnapshot().draft?.operationId).toBe(original);
  } finally { controller.dispose(); }
});
