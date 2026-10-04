/** Public ReactiveDB automation definition and validation API. */

export {
  AUTOMATION_ERROR_CODES,
  AutomationError,
  isAutomationError,
  isAutomationErrorCode,
  type AutomationErrorCode,
  type AutomationErrorDetails,
  type AutomationErrorDetailValue,
  type AutomationErrorOptions,
} from './automation-error';
export {
  DATABASE_FUNCTION_DEFINITION_KIND,
  defineDatabaseFunction,
  isDatabaseFunctionDefinition,
  type DatabaseAutomationValue,
  type DatabaseDurableFunctionContext,
  type DatabaseDurableFunctionHandler,
  type DatabaseFunctionDefinition,
  type DatabaseFunctionInvocation,
  type DatabaseFunctionMode,
  type DatabaseTransactionFunctionContext,
  type DatabaseTransactionFunctionHandler,
  type DurableDatabaseFunctionDefinition,
  type DurableDatabaseFunctionOptions,
  type TransactionDatabaseFunctionDefinition,
  type TransactionDatabaseFunctionOptions,
} from './database-function';
export {
  DATABASE_TRIGGER_DEFINITION_KIND,
  databaseFunctionReference,
  defineDatabaseTrigger,
  isDatabaseTriggerDefinition,
  type DatabaseFunctionReference,
  type DatabaseFunctionTarget,
  type DatabaseTriggerAfterEvent,
  type DatabaseTriggerAfterInput,
  type DatabaseTriggerDefinition,
  type DatabaseTriggerOperation,
  type DatabaseTriggerOptions,
  type DatabaseTriggerUpdateOptions,
} from './database-trigger';
export {
  deriveChangedColumns,
  matchesDatabaseTrigger,
  type DatabaseTriggerChange,
} from './database-trigger-matcher';
export {
  DATABASE_AUTOMATION_MANIFEST_VERSION,
  createDatabaseAutomationManifest,
  type CanonicalDatabaseAutomationManifest,
  type DatabaseAutomationManifest,
  type DatabaseFunctionManifestEntry,
  type DatabaseTriggerManifestEntry,
} from './automation-manifest';
export {
  validateDatabaseAutomations,
  type DatabaseAutomationValidationHooks,
  type DatabaseAutomationValidationInput,
  type DatabaseAutomationValidationIssue,
  type DatabaseAutomationValidationIssueCode,
} from './automation-validation';
export {
  DatabaseAutomationRegistry,
  defineDatabaseAutomations,
  type DatabaseAutomationDefinitions,
  type DefineDatabaseAutomationsOptions,
} from './database-automations';
export type {
  DatabaseTriggerChangeInput,
  DatabaseTriggerFunctionInput,
} from './database-trigger-input';
export type {
  DatabaseTransactionFunctionCapability,
} from './database-transaction-function-capability';
