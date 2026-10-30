'use client';
/** An app authorizes its own domain destination; audit-read permission alone is never that grant. */
import * as React from 'react';
import { Link } from '../../frontend/client/link';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import type { StoredLoggingEvent } from '../../logging/logging-contracts';
export type LoggingRecordLinkResolver = (target: Readonly<{ type: string; id: string }>, options: Readonly<{ signal: AbortSignal }>) => Promise<Readonly<{ href: string; label?: string }> | null>;
export function LoggingRecordLink({ stored, scopeKey, resolve }: { stored: StoredLoggingEvent; scopeKey: string; resolve: LoggingRecordLinkResolver }) {
  const boundary = useAuthorizationScopeBoundary(), target = stored.event.target;
  const key = JSON.stringify([scopeKey, target]), [value, setValue] = React.useState<{ token: symbol; href: string; label: string } | null>(null);
  const ready = boundary.ready && boundary.stable && boundary.key === scopeKey;
  const token = React.useMemo(() => Symbol('authorized-log-record-link'), [key, ready, resolve]);
  React.useEffect(() => {
    if (!ready || !target || target.type === 'page' || stored.event.metadata.resultKind === 'list') return;
    const abort = new AbortController();
    void resolve(Object.freeze({ ...target }), { signal: abort.signal }).then(link => {
      if (!abort.signal.aborted && link && typeof link.href === 'string' && link.href.startsWith('/') && !link.href.startsWith('//')
        && !/[\\\u0000-\u0020\u007f]/.test(link.href) && link.href.length <= 2048
        && (link.label === undefined || typeof link.label === 'string' && link.label.length > 0 && link.label.length <= 120))
        setValue({ token, href: link.href, label: link.label ?? 'Open current record' });
    }).catch(() => { /* Missing/revoked domain access yields no link; retained evidence remains independently inspectable. */ });
    return () => abort.abort();
  }, [resolve, key, ready, token]);
  if (!ready || value?.token !== token) return null;
  return <Link href={value.href} prefetch="none" className="inline-flex rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{value.label}</Link>;
}
