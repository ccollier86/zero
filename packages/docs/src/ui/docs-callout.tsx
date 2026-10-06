import { Lightbulb, CircleX, Bell, MessageSquare } from '@zero/framework/icons';
import type { ReactNode } from 'react';

export function DocsCallout({ tone = 'note', title, children, searchId }: {
  readonly tone?: 'note' | 'tip' | 'warning' | 'danger'; readonly title?: string; readonly children: ReactNode; readonly searchId?: string;
}) {
  const Icon = tone === 'danger' ? CircleX : tone === 'tip' ? Lightbulb : tone === 'warning' ? Bell : MessageSquare;
  return <aside className="zero-docs-callout" data-tone={tone} data-docs-passage={searchId} aria-label={title ?? tone}>
    <div className="zero-docs-callout-title"><Icon aria-hidden="true" /><span>{title ?? tone}</span></div>
    <div>{children}</div>
  </aside>;
}
