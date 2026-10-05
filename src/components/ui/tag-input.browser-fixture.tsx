/** Controlled synthetic tags; no API, account, filesystem or persistence. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TagInput } from './tag-input';

const changes: Record<string, string[][]> = {};
function Case({ name, maxTags, allowDuplicates = false }: { name: string; maxTags?: number; allowDuplicates?: boolean }) {
  const [tags, setTags] = useState(['seed']);
  return <section data-case={name}><TagInput value={tags} maxTags={maxTags}
    allowDuplicates={allowDuplicates} onChange={next => {
      (changes[name] ??= []).push([...next]); setTags(next);
    }} /></section>;
}
createRoot(document.getElementById('root')!).render(<>
  <Case name="batch" />
  <Case name="bounded" maxTags={3} />
  <Case name="duplicates" allowDuplicates />
</>);
Object.assign(window, { tagInputTest: { changes: () => structuredClone(changes) } });
