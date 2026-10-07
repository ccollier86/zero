'use client';

/** Compact settings organism composed from Zero controls; callbacks own persistence. */

import * as React from 'react';
import { Checkbox } from '../ui/checkbox';
import { Switch } from '../animate-ui/components/radix/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { cn } from '../../lib/utils';
import { validateSettingsMatrixDescriptors } from './settings-matrix-model';
import type { SettingsMatrixProps } from './settings-matrix-types';
import { useSettingsMatrix } from './use-settings-matrix';

/** Display controlled choices with safe asynchronous interaction and per-cell capability hints. */
export function SettingsMatrix({ title = 'Preferences', control = 'checkbox', ...props }: SettingsMatrixProps) {
  validateSettingsMatrixDescriptors(props);
  const matrix = useSettingsMatrix(props);
  const id = React.useId();
  const titleId = `${id}-title`;
  return (
    <section id={props.id} aria-labelledby={titleId} data-slot="settings-matrix"
      className={cn('min-w-0 overflow-hidden rounded-xl border border-border bg-card text-card-foreground', props.className)}>
      <header className="space-y-1 border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-sm font-semibold tracking-tight">{title}</h2>
        {props.description && <div className="text-xs leading-relaxed text-muted-foreground">{props.description}</div>}
      </header>
      <Table className="table-fixed" containerClassName="max-w-full">
        <colgroup>
          <col />
          {props.columns.map((column) => <col key={column.id} className="w-14 sm:w-20" />)}
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className="h-10 px-4 text-xs">Setting</TableHead>
            {props.columns.map((column) => (
              <TableHead key={column.id} scope="col" className="h-10 px-2 text-center text-xs">
                <div className="flex min-w-0 flex-col items-center gap-1 py-2">
                  {column.icon && <span aria-hidden="true" className="text-muted-foreground [&_svg]:size-3.5">{column.icon}</span>}
                  {column.description ? <Tooltip><TooltipTrigger asChild>
                    <span tabIndex={0} className="max-w-full break-words rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">{column.label}</span>
                  </TooltipTrigger><TooltipContent>{column.description}</TooltipContent></Tooltip> : <span className="max-w-full break-words">{column.label}</span>}
                </div>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {!matrix.ready && <TableRow className="hover:bg-transparent"><TableCell colSpan={props.columns.length + 1}
            className="px-4 py-5 text-xs text-muted-foreground" role="status">Refreshing settings…</TableCell></TableRow>}
          {matrix.ready && props.rows.length === 0 && <TableRow className="hover:bg-transparent"><TableCell colSpan={props.columns.length + 1}
            className="px-4 py-5 text-xs text-muted-foreground">{props.emptyMessage ?? 'No settings available.'}</TableCell></TableRow>}
          {matrix.ready && props.rows.map((row, rowIndex) => (
            <TableRow key={row.id} className="hover:bg-muted/25">
              <TableHead scope="row" className="h-auto px-4 py-3 align-top font-normal">
                <div className="text-sm font-medium leading-5 text-foreground [overflow-wrap:anywhere]">{row.label}</div>
                {row.description && <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{row.description}</div>}
              </TableHead>
              {props.columns.map((column, columnIndex) => {
                const cell = matrix.cells[rowIndex * props.columns.length + columnIndex]!;
                const pending = matrix.isPending(cell.key);
                const error = matrix.getError(cell.key);
                const errorId = `${id}-${rowIndex}-${columnIndex}-error`;
                const unavailable = cell.checked === null;
                const label = `${row.label}: ${column.label}`;
                const reason = pending ? 'Saving this setting…' : cell.reason;
                const disabled = cell.readOnly || cell.disabled || pending;
                const common = { checked: cell.checked ?? false, disabled, 'aria-label': label,
                  'aria-readonly': cell.readOnly || undefined, 'aria-invalid': Boolean(error) || undefined,
                  'aria-describedby': error ? errorId : undefined,
                  onCheckedChange: (checked: boolean | 'indeterminate') => {
                    if (typeof checked === 'boolean') matrix.change(cell.key, { rowId: row.id, columnId: column.id, checked });
                  } };
                const choice = unavailable ? <span aria-label={`${label}: not available`} className="text-muted-foreground">—</span>
                  : control === 'switch' ? <Switch {...common} /> : <Checkbox {...common} size="sm" />;
                return <TableCell key={column.id} className="px-2 py-3 text-center align-top" aria-busy={pending || undefined}>
                  <div className="flex min-h-5 items-center justify-center">
                    {reason ? <Tooltip><TooltipTrigger asChild><span tabIndex={disabled || unavailable ? 0 : undefined}
                      aria-label={disabled || unavailable ? `${label}: ${reason}` : undefined}
                      className="inline-flex items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">{choice}</span></TooltipTrigger>
                      <TooltipContent>{reason}</TooltipContent></Tooltip> : choice}
                  </div>
                  {pending && <span role="status" className="sr-only">Saving {label}.</span>}
                  {error && <p id={errorId} role="alert" className="mt-1.5 text-xs leading-snug text-destructive [overflow-wrap:anywhere]">{error}</p>}
                </TableCell>;
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <footer className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
        <span aria-live="polite">{matrix.enabledCount} enabled · {matrix.editableCount} editable</span>
        {props.help && <div className="min-w-0 [overflow-wrap:anywhere]">{props.help}</div>}
      </footer>
    </section>
  );
}
