/** Pure opt-in configuration and fixed actor launch; no files are opened or workers started here. */
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAuthorizationKernel, type AccessRequirement } from '../auth/authorization-kernel';
import type { NormalizedAuthBehaviorConfig } from '../auth/types';
import { createSubprocessDatabaseExecutorFactory, type SubprocessDatabaseExecutorFactory, type SubprocessDatabaseExecutorFactoryOptions } from '../databases/subprocess-database-executor-factory';
import { messagingChoice, messagingHash, messagingInteger, messagingRecord, messagingText } from './validation';
import { MESSAGING_ACTOR_FLAG } from './actor-bootstrap';

export interface MessagingConfig {
  directory?: 'everyone' | 'contacts';
  history?: 'all' | 'since-join';
  rootDirectory?: string;
  actors?: Omit<SubprocessDatabaseExecutorFactoryOptions, 'actorFlag'>;
  maxMessageLength?: number;
  maxParticipants?: number;
  maxActiveDatabases?: number;
  maxDatabaseFiles?: number;
  maxUploadBytes?: number;
  support?: false | { staff?: AccessRequirement };
  assistant?: false | { model?: string; instructions?: string; maxOutputTokens?: number; timeoutMs?: number };
  notifications?: boolean;
  /** Maximum parallel I/O activities by default, not one global serialized AI queue. */
  jobs?: { concurrency?: number | 'max' };
}
export interface ResolvedMessagingConfig {
  readonly directory: 'everyone' | 'contacts'; readonly history: 'all' | 'since-join'; readonly rootDirectory: string;
  readonly createExecutor: SubprocessDatabaseExecutorFactory; readonly defaultActorEntrypoint: string | null;
  readonly maxMessageLength: number; readonly maxParticipants: number; readonly maxActiveDatabases: number; readonly maxDatabaseFiles: number; readonly maxUploadBytes: number;
  readonly support: false | { readonly staff: AccessRequirement };
  readonly assistant: false | { readonly model: string; readonly instructions: string; readonly maxOutputTokens: number; readonly timeoutMs: number; readonly policyHash: string };
  readonly notifications: boolean; readonly jobConcurrency: number;
}
/** Explicit auth:false never becomes an unauthenticated messaging service. */
export function resolveMessagingConfig(input: boolean | MessagingConfig | undefined, projectRoot: string, auth: NormalizedAuthBehaviorConfig | null): ResolvedMessagingConfig | false {
  if (input === false || input === undefined) return false;
  if (!auth) throw new Error('[messaging] Guardian must be enabled.');
  const r = input === true ? {} : messagingRecord(input, ['directory', 'history', 'rootDirectory', 'actors', 'maxMessageLength', 'maxParticipants', 'maxActiveDatabases', 'maxDatabaseFiles', 'maxUploadBytes', 'support', 'assistant', 'notifications', 'jobs']);
  if (r.rootDirectory !== undefined && (typeof r.rootDirectory !== 'string' || !r.rootDirectory.trim() || r.rootDirectory.includes('\0'))) throw new Error('[messaging] Invalid private messaging root.');
  const entry = r.actors === undefined ? packagedMessagingActor(projectRoot) : null;
  const actors = r.actors === undefined ? { launch: { kind: 'source' as const, entrypoint: entry! }, env: {} } : messagingRecord(r.actors, ['launch', 'env', 'executor']);
  const support = r.support === undefined || r.support === false ? false : messagingRecord(r.support, ['staff']);
  const staff = support === false ? null : structuredClone(support.staff ?? (auth.tenancy.mode === 'multi' ? { permission: 'tenant.members:manage' } : 'admin')) as AccessRequirement;
  if (staff !== null) {
    const compiled = createAuthorizationKernel(auth).compile(staff, { user: 'required', credentials: ['session'] });
    if (!compiled.platformRoleGroups.length && !compiled.scopeRoleGroups.length && !compiled.allPermissions.length && !compiled.anyPermissionGroups.length && !compiled.propertyGroups.length) throw new Error('[messaging] Support must require a Guardian role, permission or trusted property.');
  }
  // Each tenant is also a separately scoped durable logging source. Keep the
  // catalog bounded; core Logging still enforces its aggregate source budget.
  const maxActiveDatabases = messagingInteger(r.maxActiveDatabases ?? 4, 1, 64), maxDatabaseFiles = messagingInteger(r.maxDatabaseFiles ?? 1000, maxActiveDatabases, 10000);
  const assistantInput = r.assistant === undefined || r.assistant === false ? false : messagingRecord(r.assistant, ['model', 'instructions', 'maxOutputTokens', 'timeoutMs']);
  if (assistantInput !== false && staff === null) throw new Error('[messaging] An assistant requires configured support admission.');
  const assistantPolicy = assistantInput === false ? false : {
    model: messagingText(assistantInput.model ?? 'smart', 200),
    instructions: messagingText(assistantInput.instructions ?? 'Help the customer using this conversation. Do not claim to have completed external actions. Ask for human assistance when the issue cannot be resolved from the available information.', 20000),
    maxOutputTokens: messagingInteger(assistantInput.maxOutputTokens ?? 1024, 1, 8192), timeoutMs: messagingInteger(assistantInput.timeoutMs ?? 120000, 1000, 300000),
  };
  if (r.notifications !== undefined && typeof r.notifications !== 'boolean') throw new Error('[messaging] notifications must be a boolean.');
  const jobs = r.jobs === undefined ? {} : messagingRecord(r.jobs, ['concurrency']);
  const jobConcurrency = jobs.concurrency === undefined || jobs.concurrency === 'max' ? 100 : messagingInteger(jobs.concurrency, 1, 100);
  return Object.freeze({ directory: messagingChoice(r.directory ?? 'everyone', ['everyone', 'contacts']), history: messagingChoice(r.history ?? 'all', ['all', 'since-join']),
    rootDirectory: resolve(projectRoot, r.rootDirectory as string ?? 'data/zero.messaging'),
    createExecutor: createSubprocessDatabaseExecutorFactory({ ...actors, actorFlag: MESSAGING_ACTOR_FLAG } as unknown as SubprocessDatabaseExecutorFactoryOptions), defaultActorEntrypoint: entry,
    maxMessageLength: messagingInteger(r.maxMessageLength ?? 20000, 1, 20000), maxParticipants: messagingInteger(r.maxParticipants ?? 100, 2, 100), maxActiveDatabases, maxDatabaseFiles,
    maxUploadBytes: messagingInteger(r.maxUploadBytes ?? 16 * 1024 * 1024, 1024, 256 * 1024 * 1024), support: staff === null ? false : Object.freeze({ staff: deepFreeze(staff) }),
    assistant: assistantPolicy === false ? false : Object.freeze({ ...assistantPolicy, policyHash: messagingHash(assistantPolicy) }), notifications: r.notifications === true, jobConcurrency });
}
function packagedMessagingActor(projectRoot: string): string {
  const adjacent = fileURLToPath(new URL('./actor-entry.ts', import.meta.url)); if (existsSync(adjacent)) return adjacent;
  try { const path = join(dirname(Bun.resolveSync('@zero/framework/messaging/server', projectRoot)), 'actor-entry.ts'); if (existsSync(path)) return path; } catch { /* Startup reports a safe not-ready error. */ }
  return adjacent;
}
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }
