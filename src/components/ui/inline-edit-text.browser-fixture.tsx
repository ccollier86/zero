/** Deferred synthetic edits; no API/storage/account or persistence. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { InlineEditText } from './inline-edit-text';

const state = { commits: [] as string[], navigated: 0, reloaded: 0, failNavigation: false };
let resolve!: () => void, reject!: (error: Error) => void;
let setDisabled!: (value: boolean) => void;
const root = createRoot(document.getElementById('root')!);
function Editor() {
  const [disabled, changeDisabled] = React.useState(false);
  setDisabled = changeDisabled;
  return <InlineEditText value="Original" revision={1} label="Name" disabled={disabled}
  onCommit={async value => {
    state.commits.push(value);
    await new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  }}
  onReload={() => { state.reloaded++; }}
  onNavigate={() => {
    state.navigated++;
    if (state.failNavigation) throw new Error('synthetic-private-navigation');
  }} />;
}
root.render(<Editor />);
Object.assign(window, { inlineTextTest: {
  snapshot: () => structuredClone(state),
  resolve: () => resolve(),
  reject: () => reject(new Error('Synthetic write rejection')),
  failNavigation: () => { state.failNavigation = true; },
  disable: () => setDisabled(true),
  unmount: () => root.unmount(),
} });
