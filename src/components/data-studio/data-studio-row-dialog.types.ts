/** Create-record presentation options; the callback owns acknowledged persistence and retry identity. */
import type { DataStudioTable } from '../../frontend/client/data-studio-client';

export interface DataStudioRowDialogProps {
  readonly open: boolean;
  readonly table: DataStudioTable | null;
  readonly busy?: boolean;
  /** Change with the organization/authority partition to retire drafts and pending completions. */
  readonly scopeKey?: string | number;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (values: Readonly<Record<string, unknown>>) => Promise<unknown>;
}
