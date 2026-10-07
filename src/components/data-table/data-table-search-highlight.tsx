/** Escaped React text highlighting; never rewrites DOM, parses HTML or exposes hidden custom-cell values. */
import * as React from 'react';

/** Match literal text, including regex metacharacters, without changing case or rendering HTML. */
export function highlightDataTableText(text: string, query: string): React.ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const parts: React.ReactNode[] = [];
  const literal = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  let offset = 0;
  for (const match of text.matchAll(literal)) {
    if (match.index > offset) parts.push(text.slice(offset, match.index));
    parts.push(<mark key={match.index} data-slot="data-table-search-match">{match[0]}</mark>);
    offset = match.index + match[0].length;
  }
  if (offset === 0) return text;
  if (offset < text.length) parts.push(text.slice(offset));
  return <>{parts}</>;
}
