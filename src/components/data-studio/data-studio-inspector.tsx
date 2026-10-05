'use client';

import * as React from 'react';
import { Archive, Braces, Database, FileJson2, Pencil, RotateCcw } from 'lucide-react';
import type {
  DataStudioRow,
  DataStudioTable,
} from '../../frontend/client/data-studio-client';
import { dataStudioCellValue } from '../../frontend/client/data-studio-client';
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from '../animate-ui/components/radix/tabs';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { CodeBlock } from '../code-block';
import { cn } from '../../lib/utils';
import { dataStudioCodeExample, formatDataStudioValue } from './data-studio-value';

export interface DataStudioInspectorProps {
  readonly table: DataStudioTable | null;
  readonly row: DataStudioRow | null;
  readonly canManage: boolean;
  readonly busy?: boolean;
  readonly onEditSchema: () => void;
  readonly onChangeStatus: () => void;
  readonly className?: string;
}

/** Full record values, compact table metadata, and browser API examples in one bounded inspector. */
export function DataStudioInspector({
  table,
  row,
  canManage,
  busy = false,
  onEditSchema,
  onChangeStatus,
  className,
}: DataStudioInspectorProps) {
  const [tab, setTab] = React.useState(row ? 'record' : 'table');
  React.useEffect(() => {
    setTab(row ? 'record' : 'table');
  }, [row?.rowId, table?.tableId]);

  if (!table) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Select a table to inspect its schema and records.
      </div>
    );
  }

  return (
    <div data-slot="data-studio-inspector" className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="shrink-0 border-b px-3 py-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold">{table.name}</h2>
              <Badge variant={table.status === 'active' ? 'secondary' : 'outline'}>{table.status}</Badge>
            </div>
            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{table.key}</p>
          </div>
          {canManage && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 px-2"
              disabled={busy || table.status !== 'active'}
              aria-haspopup="dialog"
              onClick={onEditSchema}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">Edit schema</span>
            </Button>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
        <div className="shrink-0 border-b px-3 py-2">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="record" disabled={!row}>
              <FileJson2 aria-hidden="true" /> Record
            </TabsTrigger>
            <TabsTrigger value="table">
              <Database aria-hidden="true" /> Table
            </TabsTrigger>
            <TabsTrigger value="code">
              <Braces aria-hidden="true" /> Code
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContents mode="layout" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <TabsContent value="record" className="h-full">
            <ScrollArea className="h-full">
              {row ? <RecordInspector table={table} row={row} /> : null}
            </ScrollArea>
          </TabsContent>
          <TabsContent value="table" className="h-full">
            <ScrollArea className="h-full">
              <TableInspector table={table} />
            </ScrollArea>
          </TabsContent>
          <TabsContent value="code" className="h-full">
            <ScrollArea className="h-full">
              <div className="p-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  Typed browser SDK example for this logical table.
                </p>
                <CodeBlock
                  code={dataStudioCodeExample(table)}
                  language="ts"
                  filename={`${table.key}.ts`}
                  minLines={8}
                  className="shadow-none"
                />
              </div>
            </ScrollArea>
          </TabsContent>
        </TabsContents>
      </Tabs>

      {canManage && (
        <div className="shrink-0 border-t p-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="w-full justify-start"
            disabled={busy}
            onClick={onChangeStatus}
          >
            {table.status === 'active'
              ? <Archive className="size-3.5" aria-hidden="true" />
              : <RotateCcw className="size-3.5" aria-hidden="true" />}
            {table.status === 'active' ? 'Archive table' : 'Restore table'}
          </Button>
        </div>
      )}
    </div>
  );
}

function RecordInspector({ table, row }: { table: DataStudioTable; row: DataStudioRow }) {
  return (
    <div className="space-y-4 p-3">
      <dl className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/20 p-3 text-xs">
        <Metadata label="Row ID" value={row.rowId} mono />
        <Metadata label="Revision" value={String(row.revision)} />
        <Metadata label="Schema" value={`v${row.schemaRevision}`} />
        <Metadata label="Updated" value={formatTimestamp(row.updatedAt)} />
      </dl>
      <div className="space-y-1">
        {table.schema.columns.map((column) => {
          const value = dataStudioCellValue(row, column.columnId);
          return (
            <div key={column.columnId} className="grid grid-cols-[minmax(6rem,0.8fr)_minmax(0,1.2fr)] gap-3 border-b py-2 text-sm last:border-0">
              <div className="min-w-0">
                <p className="truncate font-medium">{column.label}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{column.key}</p>
              </div>
              <p className={cn(
                'min-w-0 whitespace-pre-wrap break-words text-right font-mono text-xs [overflow-wrap:anywhere]',
                value == null && 'italic text-muted-foreground',
              )}>
                {value === undefined ? 'Not set' : formatDataStudioValue(value, column)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TableInspector({ table }: { table: DataStudioTable }) {
  return (
    <div className="space-y-3 p-3">
      {table.description && <p className="text-sm text-muted-foreground">{table.description}</p>}
      <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/20 p-3 text-xs">
        <Metadata label="Table ID" value={table.tableId} mono />
        <Metadata label="Table key" value={table.key} mono />
        <Metadata label="Table revision" value={String(table.revision)} />
        <Metadata label="Schema revision" value={String(table.schemaRevision)} />
        <Metadata label="Columns" value={String(table.schema.columns.length)} />
        <Metadata label="Rows" value={String(table.rowCount)} />
        <Metadata label="Lifecycle" value={table.status} />
        <Metadata label="Created" value={formatTimestamp(table.createdAt)} />
        <Metadata label="Updated" value={formatTimestamp(table.updatedAt)} />
      </dl>
      <p className="text-xs leading-relaxed text-muted-foreground">Edit individual columns from their grid headers. Use Edit schema to work on the full table definition.</p>
    </div>
  );
}

function Metadata({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('truncate font-medium', mono && 'font-mono text-[11px]')} title={value}>{value}</dd>
    </div>
  );
}

function formatTimestamp(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}
