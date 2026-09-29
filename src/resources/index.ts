export {
  RESOURCE_ACTIONS,
  RESOURCE_EXPOSURES,
  ZERO_RESOURCE_DEFINITION_KIND,
  defineResource,
  globalRealm,
  isResourceDefinition,
  isResourcePolicy,
  tenantRealm,
} from './resource-definition';

export {
  defineResourceFields,
  normalizeResourceFieldAccess,
  projectResourceRow,
  projectResourceRows,
  validateResourceClientWriteFields,
} from './resource-field-access';

export {
  ResourceRegistry,
  ResourceRegistryError,
  clearResourceRegistry,
  configureResourceRegistry,
  createResourceRegistry,
  assertResourceStorageRealms,
  getResourceRegistry,
  registerResourceRegistry,
  validateResourceDefinitions,
  validateResourceStorageRealms,
} from './resource-registry';

export {
  ResourceLoaderError,
  collectResourceFiles,
  loadResourceDefinitions,
} from './resource-loader';

export {
  inferTablePrimaryKey,
  getResourceTableColumns,
  tableColumnIsDeclaredNotNull,
  tableHasColumn,
} from './resource-schema';

export {
  createResourcePolicyAuthorization,
  createResourcePolicyUser,
} from './resource-auth';

export {
  createResourceCrudPlugin,
} from './resource-crud.plugin';

export {
  ResourceCrudService,
} from './resource-crud-service';

export {
  RESOURCE_DEFAULT_RECEIPT_MAX_KEYS,
  RESOURCE_DEFAULT_RECEIPT_MAX_RESULT_BYTES,
  RESOURCE_DEFAULT_RECEIPT_MAX_RETAINED_BYTES,
  RESOURCE_DEFAULT_RECEIPT_RETAINED_LIMIT,
} from './resource-default-receipt-store';

export {
  ResourceSyncPolicyService,
} from './resource-sync-policy';

export {
  buildResourceListFindPlan,
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
  authorizationPolicy,
  authenticatedOnly,
  customPolicy,
  evaluateResourcePolicy,
  allowsPublicAction,
  getPolicyMetadataKeys,
  getPolicyOwnerFields,
  hasCustomPolicyBranch,
  metadataPolicy,
  ownerPolicy,
  publicReadUserWrite,
  readOnly,
  requiresAuthenticatedUser,
  validateResourcePolicy,
  validateAuthorizationPolicy,
} from './resource-policy';

export type {
  ResourceDefinition,
  ResourceDefinitionOptions,
  ResourceExposure,
  ResourceRealm,
  ResourceRealmInput,
  ResourceTableInput,
  GlobalResourceRealm,
  TenantResourceRealm,
  ResourcePolicyInput,
} from './resource-definition';

export type {
  ResourceFieldAccess,
  ResourceFieldAccessInput,
  ResourceFieldWriteError,
} from './resource-field-access';

export type {
  ConfigureResourceRegistryOptions,
  RegisteredResourceDefinition,
  RegisteredResourceExposure,
  RegisteredResourceStorage,
  ResourceTenantIsolation,
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
  ResourceSyncPolicyServiceOptions,
} from './resource-sync-policy';

export type {
  ResourceListFindPlan,
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
  ResourcePolicyAuthorizationContext,
  ResourcePolicyContext,
  ResourcePolicyDecision,
  ResourcePolicyDecisionInput,
  ResourcePolicyDiagnostics,
  ResourcePolicyDenyReason,
  ResourcePolicyKind,
  ResourcePolicyResource,
  ResourcePolicyScalar,
  ResourcePolicyStaticDecision,
  ResourcePolicyUser,
  ResourcePolicyValidationCode,
  ResourcePolicyValidationContext,
  ResourcePolicyValidationIssue,
  ResourceAuthorizationRequirement,
} from './resource-policy';
