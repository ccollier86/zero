/** Public in-package facade for DataTable mutation lifecycle contracts. */

export {
  DataTableMutationController,
  DataTableMutationLifecycleError,
  isDataTableMutationCancellation,
  mutationCancelledError,
} from './data-table-mutation-controller';
export type {
  DataTableMutationContext,
  DataTableMutationControllerOptions,
  DataTableMutationFailure,
  DataTableMutationFailureStage,
  DataTableMutationKind,
  DataTableMutationLifecycleErrorCode,
  DataTableMutationOperation,
} from './data-table-mutation-controller';

export { useDataTableMutationRunner } from './use-data-table-mutation';
export type {
  DataTableMutationRunner,
  UseDataTableMutationRunnerOptions,
} from './use-data-table-mutation';
