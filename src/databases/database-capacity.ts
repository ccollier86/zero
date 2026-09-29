/** Highest executor slot representable by Fabric IPC and observability. */
export const DATABASE_EXECUTOR_SLOT_MAX = 65_535;

/** Hard coordinator actor-pool bound; slots are zero based. */
export const DATABASE_COORDINATOR_MAX_DATABASES = DATABASE_EXECUTOR_SLOT_MAX + 1;

/** Highest count/configured limit representable by Fabric observability. */
export const DATABASE_OBSERVABILITY_COUNT_MAX = 2_147_483_647;
