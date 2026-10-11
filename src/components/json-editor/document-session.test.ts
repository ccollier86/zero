/** Source-aware local history, conflicts and exact accepted-save snapshots. No real writer, files or services. */
import { expect, test } from 'bun:test';
import { JsonDocumentSession } from './json-document-session';
import type { JsonDocumentSaveContext, JsonDocumentValue } from './json-document.types';

const file = '# settings\nname: Zero # shown\nretries: 3\n';
const make = (format: 'yaml' | 'toml' | 'env' = 'yaml', text = file) => new JsonDocumentSession(undefined, { onChange: () => {} }, null, { format, text });

test('source-only initialization retains exact comments; semantic echoes cannot rewrite them', () => {
  const session = make(); expect(session.getSnapshot().value).toEqual({ name: 'Zero', retries: 3 }); expect(session.dirty).toBe(false);
  session.receive({ name: 'Zero', retries: 3 }); expect(session.getSnapshot().text).toBe(file); expect(session.getSnapshot().conflict).toBe(false);
  expect(() => new JsonDocumentSession({ name: 'Wrong' }, { onChange: () => {} }, null, { format: 'yaml', text: file })).toThrow('agree');
  session.receive({ name: 'Zero', retries: 5 }); expect(session.getSnapshot().text).toContain('# shown'); expect(session.getSnapshot().text).toContain('retries: 5'); expect(session.dirty).toBe(false);
});

test('Revert Code clears an invalid buffer without dropping undo for already-admitted comment changes', () => {
  const session = make(); session.setRaw(file.replace('# shown', '# changed')); session.setRaw('name: [unfinished'); session.cancel();
  expect(session.getSnapshot().text).toContain('# changed'); session.undo(); expect(session.getSnapshot().text).toBe(file);
});

test('YAML local edits, comment-only Code changes and format conversions have exact source history', () => {
  const session = make(); session.begin(['retries'], 'value'); session.changeInline('4'); expect(session.finishInline()).toBe(true);
  const edited = session.getSnapshot().text; expect(edited).toContain('# shown'); expect(edited).toContain('retries: 4');
  session.undo(); expect(session.getSnapshot().text).toBe(file); expect(session.dirty).toBe(false);
  session.redo(); expect(session.getSnapshot().text).toBe(edited);
  session.setRaw(edited.replace('# shown', '# renamed comment')); session.commit(); const commented = session.getSnapshot().text;
  session.undo(); expect(session.getSnapshot().text).toBe(edited); session.redo(); expect(session.getSnapshot().text).toBe(commented);
  expect(session.setFormat('json')).toBe(true); expect(session.getSnapshot().format).toBe('json');
  expect(session.setFormat('yaml')).toBe(true); expect(session.getSnapshot().text).toBe(commented);
  session.undo(); expect(session.getSnapshot().format).toBe('json'); session.undo(); expect(session.getSnapshot().text).toBe(commented);
});

test('incompatible .env/TOML conversions and invalid Code keep the current format and unfinished draft', () => {
  const session = new JsonDocumentSession({ missing: null, nested: { a: 1 } }, { onChange: () => {} });
  expect(session.setFormat('toml')).toBe(false); expect(session.getSnapshot().format).toBe('json');
  expect(session.setFormat('env')).toBe(false); expect(session.getSnapshot().format).toBe('json');
  session.setRaw('{"unfinished":'); expect(session.setFormat('yaml')).toBe(false); expect(session.getSnapshot().raw).toBe('{"unfinished":');
  expect(session.begin(['missing'], 'value')).toBe(false);
});

test('TOML native scalars remain source-native and protected, but Code can change their exact representation', () => {
  const session = make('toml', 'date = 2026-10-11\nlarge = 9223372036854775807\nactive = true\n');
  expect(session.begin(['date'], 'value')).toBe(false); expect(session.begin(['large'], 'value')).toBe(false);
  expect(session.setFormat('json')).toBe(false);
  session.setRaw('date = 2026-10-12\nlarge = 9223372036854775807\nactive = true\n'); expect(session.commit().ok).toBe(true);
  expect(session.getSnapshot().text).toContain('date = 2026-10-12'); expect(session.getSnapshot().value).toMatchObject({ date: '2026-10-12' });
});

test('.env editing starts with strings and rejects accidental type changes without coercion', () => {
  const session = make('env', '# env\nPORT=8080\n'); session.begin(['PORT'], 'value'); session.changeInline('9090'); expect(session.finishInline()).toBe(true);
  expect(session.getSnapshot().value).toEqual({ PORT: '9090' }); expect(session.getSnapshot().text).toContain('PORT=9090');
  session.begin(['PORT'], 'value'); session.changeInline('1000', 'number'); expect(session.finishInline()).toBe(false); expect(session.getSnapshot().edit?.text).toBe('1000'); session.cancel();
  const path = session.mutate({ kind: 'add', path: [] }); expect(path).toEqual(['key']); session.changeInline('NEW_VALUE'); expect(session.finishInline()).toBe(true);
  expect(session.getSnapshot().edit?.type).toBe('string'); session.changeInline('$literal'); expect(session.finishInline()).toBe(true);
  expect(session.getSnapshot().value).toEqual({ PORT: '9090', NEW_VALUE: '$literal' }); expect(session.getSnapshot().text).toContain('NEW_VALUE="\\$literal"');
  session.undo(); expect(session.getSnapshot().value).toEqual({ PORT: '9090' });
});

test('a rejected syntactically valid Code preflight freezes tree edits until corrected or reverted', () => {
  const session = new JsonDocumentSession({ a: 1 }, { onChange: () => {}, validateEdit: edit => (edit.next as Record<string, JsonDocumentValue>).a === 2 ? 'Not allowed.' : null });
  session.setRaw('{"a":2}'); expect(session.getSnapshot().draftValid).toBe(false); expect(session.begin(['a'], 'value')).toBe(false);
  expect(session.mutate({ kind: 'remove', path: ['a'] })).toBeNull(); session.cancel(); expect(session.getSnapshot().value).toEqual({ a: 1 });
});

test('comment-only changes save with an empty JSON patch and exact format/source metadata', async () => {
  let context: JsonDocumentSaveContext | undefined;
  const session = new JsonDocumentSession(undefined, { onChange: () => {}, onSave: async (_value, patch, meta) => { expect(patch).toEqual([]); context = meta; } }, null, { format: 'yaml', text: file });
  session.setRaw(file.replace('# settings', '# reviewed settings')); expect(session.dirty).toBe(true); expect(await session.save()).toBe(true);
  expect(context?.format).toBe('yaml'); expect(context?.text).toContain('# reviewed settings'); expect(session.getSnapshot().saved).toBe(true); expect(session.dirty).toBe(false);
});

test('comments edited while a snapshot is saving remain unsaved after the exact older source is accepted', async () => {
  let accept!: () => void;
  const session = new JsonDocumentSession(undefined, { onChange: () => {}, onSave: () => new Promise<void>(resolve => { accept = resolve; }) }, null, { format: 'yaml', text: file });
  session.setRaw(file.replace('# shown', '# first')); const saving = session.save();
  session.setRaw(file.replace('# shown', '# newer')); session.commit(); accept(); expect(await saving).toBe(true);
  expect(session.getSnapshot().baselineText).toContain('# first'); expect(session.getSnapshot().text).toContain('# newer'); expect(session.dirty).toBe(true); expect(session.getSnapshot().saved).toBe(false);
});

test('external source-only revisions are conflicts when dirty and discard loads the new comments exactly', () => {
  const session = make(); session.setRaw(file.replace('# shown', '# local')); session.commit();
  const external = file.replace('# shown', '# external'); session.receiveSource('yaml', external);
  expect(session.getSnapshot().conflict).toBe(true); expect(session.commit().ok).toBe(false); expect(session.getSnapshot().text).toContain('# local');
  session.discard(); expect(session.getSnapshot().text).toBe(external); expect(session.getSnapshot().baselineText).toBe(external); expect(session.dirty).toBe(false);
});

test('invalid initial and externally supplied files stay visible and cannot be saved or converted', () => {
  const session = make('yaml', 'name: [open'); expect(session.getSnapshot().raw).toBe('name: [open'); expect(session.getSnapshot().draftValid).toBe(false);
  expect(session.setFormat('json')).toBe(false); session.setRaw('name: fixed\n'); expect(session.commit().ok).toBe(true); expect(session.dirty).toBe(true);
  session.receiveSource('toml', 'name = [open'); expect(session.getSnapshot().conflict).toBe(true);
  session.discard(); expect(session.getSnapshot().format).toBe('toml'); expect(session.getSnapshot().raw).toBe('name = [open'); expect(session.getSnapshot().draftValid).toBe(false);
});

test('a clean external malformed replacement adopts its actual format and remains repairable without losing the last valid tree', () => {
  const session = make(); session.receiveSource('toml', 'name = [open');
  expect(session.getSnapshot().format).toBe('toml'); expect(session.getSnapshot().raw).toBe('name = [open');
  expect(session.getSnapshot().value).toEqual({ name: 'Zero', retries: 3 }); expect(session.document.format).toBe('toml');
  expect(session.getSnapshot().baselineText).toBe('name = [open'); expect(session.commit().ok).toBe(false);
  session.setRaw('name = "Repaired"\n'); expect(session.commit().ok).toBe(true); expect(session.getSnapshot().text).toBe('name = "Repaired"\n');
  session.discard(); expect(session.getSnapshot().format).toBe('toml'); expect(session.getSnapshot().raw).toBe('name = [open'); expect(session.getSnapshot().draftValid).toBe(false);
  const scalar = new JsonDocumentSession(1, { onChange: () => {} }); scalar.receiveSource('env', 'INVALID KEY=value');
  expect(scalar.getSnapshot().value).toBe(1); expect(scalar.getSnapshot().format).toBe('env'); expect(scalar.document.format).toBe('env');
  scalar.setRaw('KEY=repaired\n'); expect(scalar.commit().ok).toBe(true); expect(scalar.getSnapshot().value).toEqual({ KEY: 'repaired' });
});

test('synchronous commit callbacks cannot start a writer after retirement or write permission removal', async () => {
  let writes = 0;
  const retired = new JsonDocumentSession({ a: 1 }, { onChange: () => retired.dispose(), validate: () => ({ a: 2 }), onSave: async () => { writes++; } });
  expect(await retired.save()).toBe(false); expect(writes).toBe(0);
  const options = { onChange: () => {}, onSave: async () => { writes++; }, onSourceChange: () => revoked.updateOptions({ onChange: () => {} }) };
  const revoked = new JsonDocumentSession(undefined, options, null, { format: 'yaml', text: file });
  revoked.setRaw(file.replace('retries: 3', 'retries: 4')); revoked.updateOptions(options);
  expect(await revoked.save()).toBe(false); expect(writes).toBe(0);
});

test('inline numbers cannot silently round; exact-number JSON remains editable and saveable through source', async () => {
  const inline = new JsonDocumentSession({ n: 1 }, { onChange: () => {} }); inline.begin(['n'], 'value'); inline.changeInline('9007199254740993');
  expect(inline.finishInline()).toBe(false); expect(inline.getSnapshot().edit?.text).toBe('9007199254740993');
  let sent = '';
  const source = new JsonDocumentSession(undefined, { onChange: () => {}, onSave: async (_value, _patch, meta) => { sent = meta.text; } }, null, { format: 'json', text: '{"n":9007199254740993}' });
  expect(source.setFormat('yaml')).toBe(false); source.setRaw('{"n":9007199254740995}'); expect(await source.save()).toBe(true); expect(sent).toContain('9007199254740995');
});

test('exact YAML numbers keep their source through Code saves and reject projection-based conversion or tree writes', async () => {
  let sent = '';
  const session = new JsonDocumentSession(undefined, { onChange: () => {}, onSave: async (_value, _patch, context) => { sent = context.text; } }, null,
    { format: 'yaml', text: 'id: 9007199254740993\nflag: true\n' });
  expect(session.document.native.get('')).toContain('Exact YAML'); expect(session.setFormat('json')).toBe(false);
  expect(session.begin(['id'], 'value')).toBe(false); expect(session.mutate({ kind: 'replace', path: ['flag'], value: false })).toBeNull();
  session.setRaw('id: 9007199254740995\nflag: false\n'); expect(await session.save()).toBe(true); expect(sent).toBe('id: 9007199254740995\nflag: false\n');
});
