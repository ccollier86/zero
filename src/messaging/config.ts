/** Pure opt-in configuration and fixed actor launch; no files are opened or workers started here. */
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAuthorizationKernel, type AccessRequirement } from '../auth/authorization-kernel';
import type { NormalizedAuthBehaviorConfig } from '../auth/types';
import { createSubprocessDatabaseExecutorFactory, type SubprocessDatabaseExecutorFactory, type SubprocessDatabaseExecutorFactoryOptions } from '../databases/subprocess-database-executor-factory';
import { messagingChoice, messagingInteger, messagingRecord } from './validation';
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
}
export interface ResolvedMessagingConfig {
  readonly directory: 'everyone' | 'contacts'; readonly history: 'all' | 'since-join'; readonly rootDirectory: string;
  readonly createExecutor: SubprocessDatabaseExecutorFactory; readonly defaultActorEntrypoint: string | null;
  readonly maxMessageLength: number; readonly maxParticipants: number; readonly maxActiveDatabases: number; readonly maxDatabaseFiles: number; readonly maxUploadBytes: number;
  readonly support: false | { readonly staff: AccessRequirement };
}
/** Explicit auth:false never becomes an unauthenticated messaging service. */
export function resolveMessagingConfig(input: boolean | MessagingConfig | undefined, projectRoot: string, auth: NormalizedAuthBehaviorConfig | null): ResolvedMessagingConfig | false {
  if (input === false || input === undefined) return false;
  if (!auth) throw new Error('[messaging] Guardian must be enabled.');
  const r = input === true ? {} : messagingRecord(input, ['directory', 'history', 'rootDirectory', 'actors', 'maxMessageLength', 'maxParticipants', 'maxActiveDatabases', 'maxDatabaseFiles', 'maxUploadBytes', 'support']);
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
  return Object.freeze({ directory: messagingChoice(r.directory ?? 'everyone', ['everyone', 'contacts']), history: messagingChoice(r.history ?? 'all', ['all', 'since-join']),
    rootDirectory: resolve(projectRoot, r.rootDirectory as string ?? 'data/zero.messaging'),
    createExecutor: createSubprocessDatabaseExecutorFactory({ ...actors, actorFlag: MESSAGING_ACTOR_FLAG } as unknown as SubprocessDatabaseExecutorFactoryOptions), defaultActorEntrypoint: entry,
    maxMessageLength: messagingInteger(r.maxMessageLength ?? 20000, 1, 20000), maxParticipants: messagingInteger(r.maxParticipants ?? 100, 2, 100), maxActiveDatabases, maxDatabaseFiles,
    maxUploadBytes: messagingInteger(r.maxUploadBytes ?? 16 * 1024 * 1024, 1024, 256 * 1024 * 1024), support: staff === null ? false : Object.freeze({ staff: deepFreeze(staff) }) });
}
function packagedMessagingActor(projectRoot: string): string {
  const adjacent = fileURLToPath(new URL('./actor-entry.ts', import.meta.url)); if (existsSync(adjacent)) return adjacent;
  try { const path = join(dirname(Bun.resolveSync('@zero/framework/messaging/server', projectRoot)), 'actor-entry.ts'); if (existsSync(path)) return path; } catch { /* Startup reports a safe not-ready error. */ }
  return adjacent;
}
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }
