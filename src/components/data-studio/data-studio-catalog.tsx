'use client';

/** Catalog presentation only. Summaries and authority come from the scoped Studio controller. */
import * as React from 'react';
import { ArrowRight, Database, LoaderCircle, Plus, RefreshCw, Search } from 'lucide-react';
import type { DataStudioTableStatus, DataStudioTableSummary } from '../../frontend/client/data-studio-client';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

export function DataStudioCatalog({ tables, tableStatus, canManage, loading, busy, error,
  onSelect, onStatusChange, onCreate, onRefresh }: {
  tables: readonly DataStudioTableSummary[];
  tableStatus: DataStudioTableStatus | 'all';
  canManage: boolean; loading: boolean; busy: boolean; error: Error | null;
  onSelect(id: string): void;
  onStatusChange(status: DataStudioTableStatus | 'all'): void;
  onCreate(event: React.MouseEvent<HTMLButtonElement>): void;
  onRefresh(): void;
}) {
  const [search, setSearch] = React.useState('');
  const query = search.trim().toLocaleLowerCase();
  const visible = tables.filter(table => [table.name, table.key, table.description ?? '']
    .some(value => value.toLocaleLowerCase().includes(query)));
  const emptyTitle = query ? 'No matching tables' : tableStatus === 'all' ? 'No tables yet'
    : tableStatus === 'archived' ? 'No archived tables' : 'No active tables yet';
  return <div data-slot="data-studio-catalog" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/85 bg-background">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-3">
      <div className="relative min-w-0 flex-1 sm:max-w-72">
        <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" aria-label="Search tables" placeholder="Find a table…" value={search}
          maxLength={200} className="h-8 pl-8" onChange={event => setSearch(event.target.value)} />
      </div>
      <Select value={tableStatus} disabled={busy} onValueChange={value => onStatusChange(value as DataStudioTableStatus | 'all')}>
        <SelectTrigger className="h-8 w-36" aria-label="Table status"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="active">Active tables</SelectItem><SelectItem value="archived">Archived tables</SelectItem><SelectItem value="all">All tables</SelectItem></SelectContent>
      </Select>
      <Button size="icon" variant="ghost" aria-label="Refresh tables" disabled={loading || busy} onClick={onRefresh}>
        {loading ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <RefreshCw aria-hidden="true" />}
      </Button>
      {canManage && <Button size="sm" className="sm:ml-auto" aria-haspopup="dialog" disabled={loading || busy} onClick={onCreate}><Plus aria-hidden="true" />New table</Button>}
    </div>
    {error && <p role="alert" className="shrink-0 border-b border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error.message}</p>}
    <ScrollArea className="min-h-0 flex-1" scrollChaining="auto">
      {visible.length > 0 ? <ul aria-label="Workspace tables" className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map(table => <li key={table.tableId} className="min-w-0">
          <Card asChild density="compact" className="group h-full w-full p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
            <button type="button" aria-label={`Open ${table.name} table`} disabled={busy} onClick={() => onSelect(table.tableId)}>
              <span className="mb-3 flex items-center justify-between gap-2"><span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Database aria-hidden="true" className="size-4" /></span>
                <Badge variant="outline">{table.status}</Badge></span>
              <span className="block truncate text-sm font-semibold">{table.name}</span>
              <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">{table.key}</span>
              {table.description && <span className="mt-2 block line-clamp-2 text-sm text-muted-foreground">{table.description}</span>}
              <span className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
                <span className="tabular-nums">{table.rowCount.toLocaleString()} {table.rowCount === 1 ? 'record' : 'records'}</span><ArrowRight aria-hidden="true" className="size-3.5 text-primary" />
              </span>
            </button>
          </Card>
        </li>)}
      </ul> : <div className="flex min-h-64 flex-col items-center justify-center px-5 py-10 text-center">
        <span className="mb-3 grid size-11 place-items-center rounded-xl border border-border/80 bg-muted/30 text-muted-foreground">
          {loading ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <Database className="size-5" aria-hidden="true" />}</span>
        <h2 className="text-sm font-semibold">{loading ? 'Loading your tables' : error ? 'Tables are unavailable' : emptyTitle}</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{loading ? 'Fetching the catalog for this workspace.'
          : error ? 'Refresh the catalog to try again.' : query ? 'Try another name, key or description.'
          : tableStatus === 'archived' ? 'Archived tables will appear here when available.'
          : canManage ? 'Create a table to define fields and start collecting records for your workflows.'
          : 'Tables will appear here once a workspace administrator creates them.'}</p>
        {!loading && !error && <div className="mt-4 flex flex-wrap justify-center gap-2">
          {query ? <Button size="sm" variant="outline" onClick={() => setSearch('')}>Clear search</Button>
            : canManage && tableStatus !== 'archived' && <Button size="sm" aria-haspopup="dialog" disabled={busy} onClick={onCreate}><Plus aria-hidden="true" />Create your first table</Button>}
          {tableStatus !== 'all' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatusChange('all')}>View all tables</Button>}
        </div>}
      </div>}
    </ScrollArea>
  </div>;
}
