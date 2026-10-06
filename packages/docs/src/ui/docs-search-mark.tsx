/** Safe React text highlights: offsets address original UTF-16 strings, never authored HTML. */
import { Fragment } from 'react';
import type { DocsMatchRange } from '../search/text';

export function DocsSearchMark({ text, ranges }: { readonly text: string; readonly ranges: readonly DocsMatchRange[] }) {
  let cursor = 0;
  const parts = ranges.map((range, index) => {
    const before = text.slice(cursor, range.start); cursor = range.end;
    return <Fragment key={index}>{before}<mark>{text.slice(range.start, range.end)}</mark></Fragment>;
  });
  return <>{parts}{text.slice(cursor)}</>;
}
