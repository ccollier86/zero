/** Public, transport-independent contracts for the scope-closed Data Studio service. */

import type { AsyncDatabaseClient } from '../databases/database-operations';
import type {
  DataStudioSchema,
} from './data-studio-contracts';
import type {
  DataStudioFilterOperator,
} from './data-studio-operation-contracts';

export interface DataStudioServiceActor {
  readonly userId: string;
  readonly membershipId: string;
}

export interface DataStudioServiceOptions {
  readonly data: AsyncDatabaseClient;
  readonly actor: DataStudioServiceActor;
}

export interface DataStudioMutationOptions {
  /** Stable client operation id. Reuse it after an ambiguous outcome. */
  readonly operationId: string;
  readonly signal?: AbortSignal;
}

/** Durable command receipt details used by observability-aware integrations. */
export interface DataStudioMutationReceipt<T> {
  readonly value: T;
  /** True when Fabric returned the prior durable result without re-execution. */
  readonly replayed: boolean;
}

export interface DataStudioTableCreateRequest {
  readonly name: string;
  readonly key?: string;
  readonly description?: string | null;
  readonly schema: DataStudioSchema;
}

export interface DataStudioTableUpdateRequest {
  readonly expectedRevision: number;
  readonly name?: string;
  readonly description?: string | null;
  readonly schema?: DataStudioSchema;
}

export interface DataStudioServiceRowFilter {
  readonly columnKey: string;
  readonly operator: DataStudioFilterOperator;
  readonly value: string | number | boolean | null;
}

export interface DataStudioRowsRequest {
  readonly tableId: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly search?: string;
  readonly filters?: readonly DataStudioServiceRowFilter[];
  readonly sortColumnId?: string;
  readonly sortDirection?: 'asc' | 'desc';
  readonly signal?: AbortSignal;
}
