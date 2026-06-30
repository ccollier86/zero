/**
 * index.ts
 *
 * Public KV/cache barrel for server-side Zero code. Exports the memory-engine
 * slice and contracts only; persistence and Elysia integration are added in
 * later slices.
 */

export { ManualKvClock, systemKvClock } from './kv-clock';
export { KvCheckpointStore } from './kv-checkpoint';
export type { KvCheckpointConfig } from './kv-checkpoint';
export { KvCounterService } from './kv-counter-service';
export { KvError } from './kv-errors';
export type { KvErrorCode } from './kv-errors';
export { KvFileJournal } from './kv-journal';
export type {
  KvJournalConfig,
  KvJournalCorruptRecord,
  KvJournalDurability,
  KvJournalReadResult,
  KvJournalValidRecord,
} from './kv-journal';
export { KvLimiterService } from './kv-limiter-service';
export type {
  KvFixedWindowOptions,
  KvLimiterResult,
  KvSlidingWindowOptions,
  KvTokenBucketOptions,
} from './kv-limiter-service';
export { KvLruIndex } from './kv-lru-index';
export { KvMemoryEngine } from './kv-memory-engine';
export { clearKvService, createKvPlugin, getKvService } from './kv.plugin';
export type { KvPluginConfig } from './kv.plugin';
export { applyKvMutation } from './kv-mutation';
export type { KvMutation, KvMutationApplyContext } from './kv-mutation';
export { recoverKvMemoryEngine } from './kv-recovery';
export type { KvRecoveryConfig, KvRecoveryCorruptRecordPolicy, KvRecoveryResult } from './kv-recovery';
export { KvNamespace } from './kv-namespace';
export {
  KV_PERSISTENCE_FORMAT_VERSION,
  parseKvCheckpoint,
  parseKvJournalRecord,
  serializeKvCheckpoint,
  serializeKvJournalRecord,
} from './kv-serializer';
export type { KvCheckpointPayload, KvJournalRecord } from './kv-serializer';
export { KvService } from './kv-service';
export type { KvServiceConfig, KvServiceStatus } from './kv-service';
export { estimateKvValueSize } from './kv-size';
export { KvTtlIndex } from './kv-ttl-index';
export type {
  KvClock,
  KvCompareAndSetResult,
  KvCounterOptions,
  KvEvictionPolicy,
  KvMemoryEngineOptions,
  KvMemoryEngineStats,
  KvSetOptions,
  ZeroKvEntry,
  ZeroKvKind,
} from './kv-types';
