'use client';

/** React-owned placeholder copy fades independently of the incoming rows' opacity. */
import * as React from 'react';
import { Table, TableBody, TableCell, TableRow } from '#zero/components/ui/table';
import { DataTableSkeletonCell } from './data-table-grid-skeleton';

interface Geometry { top: number; left: number; width: number; rows: { height: number; widths: number[] }[] }
export function DataTableSkeletonReveal({ active, body, frame, types }: {
  active: boolean; body: React.RefObject<HTMLTableSectionElement | null>;
  frame: React.RefObject<HTMLDivElement | null>; types: (string | undefined)[];
}) {
  const [geometry, setGeometry] = React.useState<Geometry | null>(null);
  React.useLayoutEffect(() => {
    // Child layout effects run before the enclosing host ref is attached.
    // The admitted body already has its native parent, including in StrictMode.
    const owner = frame.current ?? body.current?.closest<HTMLDivElement>('[data-slot="data-table-height-frame"]');
    if (!active || !body.current || !owner) { setGeometry(null); return; }
    const bounds = body.current.getBoundingClientRect(), parent = owner.getBoundingClientRect();
    const rows = [...body.current.rows].filter(row => !row.hasAttribute('data-table-leaving'));
    setGeometry({ top: bounds.top - parent.top, left: bounds.left - parent.left, width: bounds.width,
      rows: rows.map(row => ({ height: row.getBoundingClientRect().height, widths: [...row.cells].map(cell => cell.getBoundingClientRect().width) })) });
  }, [active, body, frame]);
  if (!active || !geometry) return null;
  return <div aria-hidden="true" data-slot="data-table-skeleton-crossfade" className="pointer-events-none absolute"
    style={{ top: geometry.top, left: geometry.left, width: geometry.width }}>
    <Table aria-hidden="true" data-slot="data-table-skeleton-copy" className="table-fixed" containerClassName="overflow-visible">
      <colgroup>{geometry.rows[0]?.widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
      <TableBody>{geometry.rows.map((row, index) => <TableRow key={index} style={{ height: row.height }}>
        {row.widths.map((_, column) => <TableCell key={column} className="relative"><DataTableSkeletonCell
          overlay index={index} type={types[column]} /></TableCell>)}
      </TableRow>)}</TableBody>
    </Table>
  </div>;
}
