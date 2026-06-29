export {
  RESOURCE_ACTIONS,
  ZERO_RESOURCE_DEFINITION_KIND,
  defineResource,
  isResourceDefinition,
  isResourcePolicy,
} from './resource-definition';

export {
  ResourceRegistry,
  ResourceRegistryError,
  configureResourceRegistry,
  getResourceRegistry,
  validateResourceDefinitions,
} from './resource-registry';

export {
  ResourceLoaderError,
  collectResourceFiles,
  loadResourceDefinitions,
} from './resource-loader';

export {
  inferTablePrimaryKey,
  getResourceTableColumns,
  tableHasColumn,
} from './resource-schema';

export {
  createResourcePolicyUser,
} from './resource-auth';

export {
  createResourceCrudPlugin,
} from './resource-crud.plugin';

export {
  ResourceCrudService,
} from './resource-crud-service';

export {
  buildResourceListQueryPlan,
  quoteResourceIdentifier,
} from './resource-query';

export {
  isResourceInputError,
  sanitizeResourceCreateInput,
  sanitizeResourceUpdateInput,
} from './resource-input';

export {
  adminOnly,
  allOf,
  anyOf,
  authenticatedOnly,
  customPolicy,
  evaluateResourcePolicy,
  metadataPolicy,
  ownerPolicy,
  publicReadUserWrite,
  readOnly,
  validateResourcePolicy,
} from './resource-policy';

export type {
  ResourceDefinition,
  ResourceDefinitionOptions,
  ResourcePolicyInput,
} from './resource-definition';

export type {
  ConfigureResourceRegistryOptions,
  RegisteredResourceDefinition,
  ResourceRegistryIssue,
  ResourceRegistryIssueCode,
  ResourceRegistryValidationContext,
} from './resource-registry';

export type {
  ResourceLoaderOptions,
} from './resource-loader';

export type {
  ResourceCrudPluginConfig,
  ResourceCrudRoutesConfig,
} from './resource-crud.plugin';

export type {
  ResourceCrudFailure,
  ResourceCrudRequestContext,
  ResourceCrudResult,
  ResourceCrudServiceOptions,
  ResourceCrudSuccess,
} from './resource-crud-service';

export type {
  ResourceListQueryInput,
  ResourceListQueryPlan,
  ResourceListQueryPlanOptions,
  ResourceQueryError,
} from './resource-query';

export type {
  ResourceInputError,
  ResourceInputValue,
} from './resource-input';

export type {
  CustomResourcePolicyCallback,
  CustomResourcePolicyOptions,
  OwnerPolicyCreateMode,
  OwnerPolicyOptions,
  ResourceAction,
  ResourceDataConstraint,
  ResourceFieldConstraint,
  ResourceMetadataRequirement,
  ResourceMetadataRequirementOperators,
  ResourceMetadataRequirements,
  ResourceMaybePromise,
  ResourcePolicy,
  ResourcePolicyAuthConfig,
  ResourcePolicyContext,
  ResourcePolicyDecision,
  ResourcePolicyDecisionInput,
  ResourcePolicyDenyReason,
  ResourcePolicyKind,
  ResourcePolicyResource,
  ResourcePolicyScalar,
  ResourcePolicyUser,
  ResourcePolicyValidationCode,
  ResourcePolicyValidationContext,
  ResourcePolicyValidationIssue,
} from './resource-policy';
