'use client';
/** Scope-fenced native DataTable drill-down. Never queries the application's current record as historical evidence. */
import * as React from 'react';
import { useClientMaybe } from '../../frontend/client/client-context';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import type { LoggingQuery } from '../../logging/logging-contracts';
import { createLoggingTableSource } from './logging-table-source';
import { loggingTableSchema } from './logging-table-schema';
import { loggingColumns } from './logging-columns';
import { DataTable } from '../data-table';
import { modals } from '../../modals';
import { LoggingEventDetail } from './logging-event-detail';

export function LoggingHistory({ query, scopeKey, platform = false }: { query: LoggingQuery; scopeKey: string; platform?: boolean }) {
  const client = useClientMaybe(), boundary = useAuthorizationScopeBoundary(client), key = JSON.stringify([scopeKey, platform, query]);
  const source = React.useMemo(() => client ? createLoggingTableSource({ page: platform ? client.logging.platformPage : client.logging.page, watch: client.logging.watch }, 'audit', query, { platform }) : null, [client, key]);
  const columns = React.useMemo(() => loggingColumns((row, trigger) => modals.show({ title: 'Supporting event', trigger, size: 'lg',
    body: <LoggingEventDetail stored={row.stored} scopeKey={scopeKey} person={row.person} initiator={row.initiator} platform={platform} /> })), [scopeKey, platform]);
  if (!source || !boundary.ready || !boundary.stable || boundary.key !== scopeKey) return <p role="status" className="text-sm text-muted-foreground">Evidence is hidden while access is revalidated.</p>;
  return <DataTable key={key} schema={loggingTableSchema} source={source} columns={['time', 'actor', 'action', 'details', 'outcome', 'inspect']} columnOverrides={columns}
    paginated={{ pageSize: 20 }} sortable={false} searchable={false} filterable={false} selectable={false} showExport={false} cellMotion={false}
    emptyState={<p className="p-6 text-center text-sm text-muted-foreground">No retained supporting evidence is available in this scope.</p>} />;
}
