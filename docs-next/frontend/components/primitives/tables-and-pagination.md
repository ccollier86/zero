---
id: zero.frontend.components.primitives.tables-pagination
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: semantic-tables-page-links
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Semantic Tables And Pagination Links

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

The `@zero/framework/components/ui/table` module exports Table, TableHeader,
TableBody, TableFooter, TableRow, TableHead, TableCell and TableCaption. Props
follow the corresponding native table/thead/tbody/tfoot/tr/th/td/caption element.
Table places its table inside an overflow wrapper; className applies to the
table itself. The additive `TableProps.containerClassName` customizes that
wrapper, which has `data-slot="table-container"`. Its default remains
`relative w-full overflow-auto`. Use `containerClassName="overflow-visible"`
only when a bounded ancestor deliberately owns scrolling—for example a Studio
grid with sticky headers. The option does not disable accessibility or install
virtualization. Rows support data-state='selected' visual styling.

These components do not sort, search, paginate or maintain selection. Prefer
[DataTable](../../data-controls/data-table/index.md) for those integrated behaviors.
Use Table when you intentionally own a small semantic display.

```tsx
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
  from '@zero/framework/components/ui/table';

export function Counts() {
  return <Table><TableHeader><TableRow><TableHead scope="col">Kind</TableHead>
    <TableHead scope="col">Count</TableHead></TableRow></TableHeader>
    <TableBody><TableRow><TableCell>Examples</TableCell><TableCell>3</TableCell>
    </TableRow></TableBody></Table>;
}
```

## Pagination Family

The `/pagination` UI module exports Pagination (nav), PaginationContent (ul),
PaginationItem (li), PaginationLink (anchor), PaginationPrevious,
PaginationNext and PaginationEllipsis (span). Pagination labels navigation;
PaginationLink accepts native anchor props, isActive and Button size (icon default),
marking an active page with aria-current='page'. Previous/Next use labeled anchors.
Ellipsis is presentation with visually hidden text.

The app supplies href/click behavior and known page numbers. There is no implicit
backend count, next-cursor, pending state or disabled-anchor enforcement. Do not
invent total/last-page links for a cursor result with unknown totals. Use
[DataTablePagination](../../data-controls/data-table/server-sources.md) when the
source already owns that state and its accurate Next/Previous contract.

## Related Guides And Next Steps

- [DataTable sources](../../data-controls/data-table/sources.md) chooses query ownership.
- [DataTable sizing](../../data-controls/data-table/state-and-columns.md) keeps columns stable.
- [Record navigation](./list-detail.md) moves through selected records, not pages.
