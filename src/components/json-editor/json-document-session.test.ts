/** Local document lifecycle, draft preservation and accepted-writer tests; no real transport or database. */
import { expect, test } from 'bun:test';
import { JsonDocumentSession } from './json-document-session';
import type { JsonDocumentValue } from './json-document.types';

function session(options: Partial<ConstructorParameters<typeof JsonDocumentSession>[1]> = {}, value: JsonDocumentValue = { count: 1, enabled: true }) {
  const changes: JsonDocumentValue[] = [], raw: Array<string | null> = [];
  return { changes, raw, editor: new JsonDocumentSession(value, { onChange: value => { changes.push(value); }, onRawTextDraftChange: value => { raw.push(value); }, ...options }) };
}

test('inline number validation retains invalid text and type until corrected or explicitly cancelled', () => {
  const { editor, changes } = session(); editor.begin(['count'], 'value'); editor.changeInline('bad');
  expect(editor.finishInline()).toBe(false); expect(editor.getSnapshot().edit?.text).toBe('bad'); expect(changes).toHaveLength(0);
  editor.changeInline('2'); expect(editor.finishInline()).toBe(true); expect(editor.commit()).toEqual({ ok: true, value: { count: 2, enabled: true } });
  editor.begin(['count'], 'value'); editor.changeInline('3'); editor.cancel(); expect(editor.getSnapshot().value).toEqual({ count: 2, enabled: true });
});

test('whole-document validation is independent from local draft changes and retains invalid source', () => {
  const { editor } = session({ validate(value) { if ((value as { count?: unknown }).count !== 2) throw new Error('Count must be two.'); return value as JsonDocumentValue; } });
  editor.setRaw('{"count":'); expect(editor.commit().ok).toBe(false); expect(editor.getSnapshot().raw).toBe('{"count":');
  editor.setRaw('{"count":3}'); expect(editor.commit()).toEqual({ ok: false, error: 'Count must be two.' }); expect(editor.getSnapshot().raw).toBe('{"count":3}');
  editor.setRaw('{"count":2}'); expect(editor.commit()).toEqual({ ok: true, value: { count: 2 } }); expect(editor.getSnapshot().raw).toBeNull();
});

test('edit preflight covers removal, rename and code as well as scalar changes', () => {
  const kinds: string[] = [];
  const { editor } = session({ validateEdit(edit) { kinds.push(edit.kind); if (edit.kind === 'remove') return 'Required field.'; } });
  expect(editor.mutate({ kind: 'remove', path: ['count'] })).toBeNull(); expect(editor.getSnapshot().value).toEqual({ count: 1, enabled: true });
  editor.begin(['count'], 'key'); editor.changeInline('total'); expect(editor.finishInline()).toBe(true);
  editor.setRaw('{"total":2,"enabled":true}'); expect(kinds).toContain('rename'); expect(kinds).toContain('code');
});

test('new-entry rename and value form one cancellable transaction; undo/redo restore exact local snapshots', () => {
  const { editor } = session(); const path = editor.mutate({ kind: 'add', path: [] }); expect(path).toEqual(['key']);
  editor.changeInline('other'); expect(editor.finishInline()).toBe(true); expect(editor.getSnapshot().edit?.kind).toBe('value');
  editor.changeInline('42'); expect(editor.finishInline()).toBe(true); expect(editor.getSnapshot().value).toEqual({ count: 1, enabled: true, other: 42 });
  editor.undo(); expect(editor.getSnapshot().value).toEqual({ count: 1, enabled: true });
  editor.redo(); expect(editor.getSnapshot().value).toEqual({ count: 1, enabled: true, other: 42 });
  editor.mutate({ kind: 'add', path: [] }); editor.cancel(); expect(editor.getSnapshot().value).toEqual({ count: 1, enabled: true, other: 42 });
});

test('a missing writer cannot acknowledge persistence and a rejected writer preserves edits', async () => {
  const local = session(); local.editor.mutate({ kind: 'replace', path: ['count'], value: 2 });
  expect(await local.editor.save()).toBe(false); expect(local.editor.getSnapshot().saved).toBe(false);
  const failed = session({ async onSave() { throw new Error('Rejected.'); } }); failed.editor.mutate({ kind: 'replace', path: ['count'], value: 2 });
  expect(await failed.editor.save()).toBe(false); expect(failed.editor.getSnapshot()).toMatchObject({ saved: false, saving: false, value: { count: 2, enabled: true } });
});

test('only an accepted snapshot advances baseline; changes made while saving remain dirty', async () => {
  let accept!: () => void; const pending = new Promise<void>(resolve => { accept = resolve; });
  const { editor } = session({ onSave: () => pending }); editor.mutate({ kind: 'replace', path: ['count'], value: 2 });
  const saved = editor.save(); editor.mutate({ kind: 'replace', path: ['count'], value: 3 }); accept(); expect(await saved).toBe(true);
  expect(editor.getSnapshot()).toMatchObject({ baseline: { count: 2, enabled: true }, value: { count: 3, enabled: true }, saved: false, saving: false });
});

test('disabled/retired sessions abort pending feedback and reject old handles', async () => {
  for (const stop of ['disabled', 'retired'] as const) {
    let accept!: () => void; const pending = new Promise<void>(resolve => { accept = resolve; }); let signal!: AbortSignal;
    const writer = (_value: JsonDocumentValue, _patch: unknown, context: { signal: AbortSignal }) => { signal = context.signal; return pending; };
    const { editor } = session({ onSave: writer }); editor.mutate({ kind: 'replace', path: ['count'], value: 2 }); const saved = editor.save();
    if (stop === 'disabled') editor.updateOptions({ onChange() {}, disabled: true, onSave: writer }); else editor.dispose();
    expect(signal.aborted).toBe(true); accept(); expect(await saved).toBe(false); expect(editor.getSnapshot().saved).toBe(false); expect(editor.commit().ok).toBe(false);
  }
});

test('external replacement does not silently overwrite dirty/raw drafts; explicit discard adopts it', () => {
  const { editor } = session(); editor.setRaw('{"count":'); editor.receive({ count: 5 });
  expect(editor.getSnapshot()).toMatchObject({ raw: '{"count":', conflict: true }); expect(editor.commit().ok).toBe(false);
  editor.discard(); expect(editor.getSnapshot()).toMatchObject({ value: { count: 5 }, baseline: { count: 5 }, raw: null, conflict: false });
});

test('local callback failure retains valid source and unfinished add/cancel history', () => {
  let fail = false;
  const { editor, raw } = session({ onChange() { if (fail) throw new Error('Private callback detail.'); } });
  fail = true; editor.setRaw('{"count":2}');
  expect(editor.getSnapshot()).toMatchObject({ raw: '{"count":2}', value: { count: 1, enabled: true } });
  expect(raw.at(-1)).toBe('{"count":2}'); expect(editor.getSnapshot().error).not.toContain('Private callback detail.');
  fail = false; editor.cancel(); editor.mutate({ kind: 'add', path: [] }); fail = true; editor.cancel();
  expect(editor.getSnapshot().edit?.fresh).toBe(true); expect(editor.getSnapshot().undoCount).toBe(1);
  fail = false; editor.cancel(); expect(editor.getSnapshot().value).toEqual({ count: 1, enabled: true }); expect(editor.getSnapshot().undoCount).toBe(0);
});

test('mutations cannot bypass total document budgets or interrupt an unfinished new-entry value', () => {
  const { editor } = session({}, { list: Array.from({ length: 49_998 }, () => null) });
  expect(editor.mutate({ kind: 'add', path: ['list'] })).toBeNull(); expect(editor.getSnapshot().error).toContain('structural limit');
  const small = session().editor; small.mutate({ kind: 'add', path: [] }); small.changeInline('other');
  expect(small.mutate({ kind: 'remove', path: ['count'] })).toBeNull(); expect(small.getSnapshot().edit?.path).toEqual(['other']);
});

test('StrictMode-style retirement aborts a writer and reactivation clears busy without accepting late feedback', async () => {
  let accept!: () => void;
  const { editor } = session({ onSave: () => new Promise<void>(resolve => { accept = resolve; }) });
  editor.mutate({ kind: 'replace', path: ['count'], value: 2 }); const result = editor.save(); editor.dispose(); editor.activate();
  expect(editor.getSnapshot().saving).toBe(false); accept(); expect(await result).toBe(false); expect(editor.getSnapshot().saved).toBe(false);
});
