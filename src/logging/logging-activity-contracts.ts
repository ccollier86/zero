/** Browser-safe, versioned activity facts; never a free-form record/body snapshot. */
import type { LoggingScalar } from './logging-contracts';

export type LoggingFieldPolicy = 'omit' | 'redact' | Readonly<{ values: readonly LoggingScalar[] }>;
export interface LoggingResourcePolicy {
  readonly label?: string;
  readonly fields?: Readonly<Record<string, LoggingFieldPolicy>>;
}
export type LoggingResourcePolicies = Readonly<Record<string, LoggingResourcePolicy>>;

export type LoggingFieldChange = Readonly<{
  field: string;
  beforePresent: boolean;
  afterPresent: boolean;
}> & (Readonly<{ kind: 'redacted' }> | Readonly<{ kind: 'value'; before: LoggingScalar; after: LoggingScalar }>);

export interface LoggingRecordChange {
  readonly kind: 'record-change';
  readonly table: string;
  readonly sequence: number;
  readonly changes: readonly LoggingFieldChange[];
  /** Changed fields omitted by explicit privacy policy or the bounded field budget. */
  readonly omittedFields: number;
}

export type LoggingActivityDetail = LoggingRecordChange | import('./logging-result-contracts').LoggingResultReference;
