/** Backward-compatible dialog callbacks with additive opening-revision preconditions. */
import type { DataStudioSchema, DataStudioTable, DataStudioTableCreate } from '../../frontend/client/data-studio-client';

export interface DataStudioTableDialogProps {
  readonly open: boolean;
  readonly table?: DataStudioTable | null;
  readonly busy?: boolean;
  readonly startWithNewColumn?: boolean;
  /** Optional application quota, narrowed to the structural maximum of 128. */
  readonly maxColumns?: number;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate?: (input: DataStudioTableCreate) => Promise<unknown>;
  readonly onUpdate?: (input: {
    readonly name: string;
    readonly description: string | null;
    readonly schema: DataStudioSchema;
  }, options?: { readonly expectedRevision: number }) => Promise<unknown>;
}
