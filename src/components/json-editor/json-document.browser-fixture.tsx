/** Synthetic consumer only. No application, service, DB, network or credentials. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentEditor } from './json-document-editor';
import { ModalManager } from '../../modals/modal-manager';
import { modals } from '../../modals/modal-events';
import type { JsonDocumentEditorHandle, JsonDocumentEditorProps, JsonDocumentValue } from './json-document.types';
import type { DocumentFormat } from './document.types';

interface Configuration { mounted: boolean; writer: boolean; disabled: boolean; documentKey: string; scrollMode: 'self' | 'parent'; scrollTreatment: 'arc' | 'native'; maxHeight: number; pageSize: number; format?: DocumentFormat; sourceText?: string }
interface WriterRecord { value: JsonDocumentValue; signal: AbortSignal; format: DocumentFormat; text: string; patches: number; accept: () => void; reject: () => void }
interface Fixture {
  openManaged(): void;
  configure(options: Partial<Configuration>): void;
  replace(value: JsonDocumentValue): void;
  handle(): JsonDocumentEditorHandle | null;
  savedHandle(): JsonDocumentEditorHandle | null;
  value(): JsonDocumentValue;
  writes(): readonly WriterRecord[];
  accept(index: number): void;
  reject(index: number): void;
  preflight(options: 'allow' | 'prevent-remove'): void;
}
declare global { interface Window { __jsonDocument: Fixture } }
let configure!: Fixture['configure'], replace!: Fixture['replace'], preflight!: Fixture['preflight'];
let handle: JsonDocumentEditorHandle | null = null, savedHandle: JsonDocumentEditorHandle | null = null;
let current: JsonDocumentValue;
const writes: WriterRecord[] = [];
function ManagedDocument() {
  const [value, setValue] = React.useState<JsonDocumentValue>({ count: 1 });
  return <DocumentEditor value={value} onChange={setValue} label="Managed document" rootName="settings" />;
}
function FixtureApp() {
  const [options, setOptions] = React.useState<Configuration>({ mounted: true, writer: false, disabled: false, documentKey: 'one', scrollMode: 'self', scrollTreatment: 'arc', maxHeight: 190, pageSize: 50 });
  const [guard, setGuard] = React.useState<'allow' | 'prevent-remove'>('allow');
  const [value, setValue] = React.useState<JsonDocumentValue>({ title: 'Hello', count: 1, enabled: true, nested: { child: 'Child', detail: 'Another' }, list: [1, 2, 3] });
  current = value; configure = next => setOptions(old => ({ ...old, ...next })); replace = setValue; preflight = setGuard;
  const writer: JsonDocumentEditorProps['onSave'] = (value, _patch, context) => new Promise<void>((accept, reject) => {
    writes.push({ value, signal: context.signal, format: context.format, text: context.text, patches: _patch.length, accept, reject: () => reject(new Error('Writer rejected the snapshot.')) });
  });
  return <main data-zero-theme="next" style={{ maxWidth: 680, margin: '24px auto', padding: 12 }} data-testid="json-ready">
    {options.mounted && <DocumentEditor {...options} value={options.sourceText === undefined ? value : undefined} onChange={setValue} label="Settings JSON" rootName="settings"
      onSourceChange={source => { if (options.sourceText !== undefined) setOptions(previous => ({ ...previous, format: source.format, sourceText: source.text })); }}
      editorRef={value => { handle = value; if (value) savedHandle = value; }} onSave={options.writer ? writer : undefined}
      validateEdit={edit => guard === 'prevent-remove' && edit.kind === 'remove' ? 'This field is required.' : null} />}
  </main>;
}
window.__jsonDocument = { openManaged: () => { modals.show({ title: 'Document editing', guard: false, body: <ManagedDocument /> }); }, configure: next => configure(next), replace: value => replace(value), handle: () => handle,
  savedHandle: () => savedHandle, value: () => current, writes: () => writes, accept: index => writes[index]?.accept(), reject: index => writes[index]?.reject(), preflight: option => preflight(option) };
createRoot(document.getElementById('root')!).render(<React.StrictMode><ModalManager><FixtureApp /></ModalManager></React.StrictMode>);
