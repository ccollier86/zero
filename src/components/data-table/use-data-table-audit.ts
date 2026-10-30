'use client';
/** Commit-owned display audit. Fetched, prefetched, or held arrivals alone never count as displayed. */
import { useRef } from 'react';
import type { Row } from '../../sync/types';
import type { LoggingResultReceipt } from '../../logging/logging-result-contracts';
import { useLoggingRows } from '../../frontend/client/logging-hooks';
import { DataTableAuditResult } from './data-table-audit-result';

export function useDataTableAudit<T extends Row>(identity: string, sourceRows: readonly T[], receipt: LoggingResultReceipt | undefined, displayedRows: readonly T[]): void {
  const owner = useRef<{ identity: string; result: DataTableAuditResult<T> } | null>(null);
  if (!owner.current || owner.current.identity !== identity) owner.current = { identity, result: new DataTableAuditResult<T>() };
  owner.current.result.remember(sourceRows, receipt);
  useLoggingRows(displayedRows, { identity, receipt: owner.current.result.displayed(displayedRows), emptySource: owner.current.result.source });
}
