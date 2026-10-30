'use client';
import { useEffect, useState } from 'react';
import { Link, useClient, useLoggingResultView } from '@zero/framework/react';
import type { LoggingResultReceipt } from '@zero/framework/logging';
export const config = { auth: 'admin' };
export default function Record({ params }: { params: { id: string } }) {
  const client = useClient(), [value, setValue] = useState<{ row: { id: string; title: string }; auditReceipt?: LoggingResultReceipt } | null>(null);
  useEffect(() => { const abort = new AbortController(); void client.fetch<typeof value>('/api/resources/audit_items/' + encodeURIComponent(params.id), { signal: abort.signal }).then(result => {
    if (!abort.signal.aborted) setValue(result);
  }); return () => abort.abort(); }, [client, params.id]);
  useLoggingResultView(value?.auditReceipt, params.id);
  return <main data-testid="native-audit-record"><Link href="/records">Close record</Link>{value ? <><h1>{value.row.title}</h1><p>Record {value.row.id}</p></> : <p role="status">Loading record…</p>}</main>;
}
