'use client';

/** Immediate input presentation, with one cancelable 90ms query publication. */
import * as React from 'react';
import { DATA_TABLE_MOTION } from './data-table-motion-tokens';

export function useDataTableSearchDraft(value: string, publish: (value: string) => void) {
  const [draft, setDraft] = React.useState({ value, external: value });
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const callback = React.useRef(publish); callback.current = publish;
  if (draft.external !== value) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null; setDraft({ value, external: value });
  }
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const change = React.useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null; setDraft(current => ({ ...current, value: next }));
    if (!next) { callback.current(next); return; }
    timer.current = setTimeout(() => { timer.current = null; callback.current(next); }, DATA_TABLE_MOTION.searchDebounce);
  }, []);
  return { value: draft.external === value ? draft.value : value, change };
}
