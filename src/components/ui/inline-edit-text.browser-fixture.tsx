/** Deferred synthetic edits; no API/storage/account or persistence. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { InlineEditText } from './inline-edit-text';

const state = { commits: [] as string[], navigated: 0, reloaded: 0, failNavigation: false };
let resolve!: () => void, reject!: (error: Error) => void;
let setDisabled!: (value: boolean) => void;
let setExplicit!: (value: boolean) => void;
let replaceValue!: () => void;
let replaceScope!: () => void;
let lastSignal: AbortSignal | undefined;
let lastRevision: string | number | undefined;
const root = createRoot(document.getElementById('root')!);
function Editor() {
  const [disabled, changeDisabled] = React.useState(false);
  const [explicit, changeExplicit] = React.useState(false);
  const [value, changeValue] = React.useState('Original');
  const [revision, changeRevision] = React.useState(1);
  const [scope, changeScope] = React.useState(0);
  setDisabled = changeDisabled;
  setExplicit = changeExplicit;
  replaceValue = () => { changeValue('Latest'); changeRevision(current => current + 1); };
  replaceScope = () => changeScope(current => current + 1);
  return <main style={{ width: 280 }}><InlineEditText value={value} revision={revision} label="Name" disabled={disabled}
  commitMode={explicit ? 'explicit' : 'blur'} scopeKey={scope}
  onCommit={async (value, context) => {
    lastSignal = context.signal; lastRevision = context.expectedRevision;
    state.commits.push(value);
    await new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
    if (!context.signal.aborted) { changeValue(value); changeRevision(current => current + 1); }
  }}
  onReload={() => { state.reloaded++; }}
  onNavigate={() => {
    state.navigated++;
    if (state.failNavigation) throw new Error('synthetic-private-navigation');
  }} /><button type="button">Outside field</button></main>;
}
root.render(<Editor />);
Object.assign(window, { inlineTextTest: {
  snapshot: () => structuredClone(state),
  resolve: () => resolve(),
  reject: () => reject(new Error('Synthetic write rejection')),
  failNavigation: () => { state.failNavigation = true; },
  disable: () => setDisabled(true),
  explicit: () => setExplicit(true),
  replaceValue: () => replaceValue(),
  replaceScope: () => replaceScope(),
  saveContext: () => ({ revision: lastRevision, aborted: lastSignal?.aborted }),
  unmount: () => root.unmount(),
} });
