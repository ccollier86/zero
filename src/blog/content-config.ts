/** Server-only content ownership configuration. Validation creates launch factories, never opens files or starts workers. */
import { resolve, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSubprocessDatabaseExecutorFactory, type SubprocessDatabaseExecutorFactoryOptions, type SubprocessDatabaseExecutorFactory } from '../databases/subprocess-database-executor-factory';
import { blogRecord } from './validation';
import { BLOG_ACTOR_FLAG } from './content-actor-bootstrap';

export interface BlogContentConfig {
  rootDirectory?: string;
  actors?: Omit<SubprocessDatabaseExecutorFactoryOptions, 'actorFlag'>;
  media?: { maxUploadBytes?: number; maxImagePixels?: number };
  metrics?: { enabled?: boolean; retentionDays?: number };
}
export interface ResolvedBlogContentConfig {
  readonly rootDirectory: string;
  readonly createExecutor: SubprocessDatabaseExecutorFactory;
  readonly defaultActorEntrypoint: string | null;
  readonly maxUploadBytes: number;
  readonly maxImagePixels: number;
  readonly metrics: { readonly enabled: boolean; readonly retentionDays: number };
}
/** All policy is trusted startup configuration; request bodies cannot choose a physical database or actor. */
export function resolveBlogContentConfig(input: boolean | BlogContentConfig, projectRoot: string): ResolvedBlogContentConfig | false {
  if (input === false) return false;
  const r = input === true ? {} : blogRecord(input, ['rootDirectory', 'actors', 'media', 'metrics']);
  if (r.rootDirectory !== undefined && (typeof r.rootDirectory !== 'string' || !r.rootDirectory.trim() || r.rootDirectory.includes('\0'))) throw new Error('[blog] Invalid private content root.');
  const media = r.media === undefined ? {} : blogRecord(r.media, ['maxUploadBytes', 'maxImagePixels']);
  const metrics = r.metrics === undefined ? {} : blogRecord(r.metrics, ['enabled', 'retentionDays']);
  const maxUploadBytes = media.maxUploadBytes ?? 256 * 1024 * 1024, maxImagePixels = media.maxImagePixels ?? 16000000, retentionDays = metrics.retentionDays ?? 90;
  if (!Number.isSafeInteger(maxUploadBytes) || Number(maxUploadBytes) < 1024 || Number(maxUploadBytes) > 1024 * 1024 * 1024
    || !Number.isSafeInteger(maxImagePixels) || Number(maxImagePixels) < 1 || Number(maxImagePixels) > 100000000
    || !Number.isSafeInteger(retentionDays) || Number(retentionDays) < 1 || Number(retentionDays) > 3660
    || metrics.enabled !== undefined && typeof metrics.enabled !== 'boolean') throw new Error('[blog] Invalid media or metrics limits.');
  const entry = r.actors === undefined ? resolvePackagedBlogActor(projectRoot) : null;
  const actors = r.actors === undefined ? { launch: { kind: 'source' as const, entrypoint: entry! }, env: {} } : blogRecord(r.actors, ['launch', 'env', 'executor']);
  const createExecutor = createSubprocessDatabaseExecutorFactory({ ...actors, actorFlag: BLOG_ACTOR_FLAG } as unknown as SubprocessDatabaseExecutorFactoryOptions);
  return Object.freeze({ rootDirectory: resolve(projectRoot, r.rootDirectory as string ?? 'data/zero.blog'), createExecutor, defaultActorEntrypoint: entry,
    maxUploadBytes: Number(maxUploadBytes), maxImagePixels: Number(maxImagePixels), metrics: Object.freeze({ enabled: metrics.enabled === true, retentionDays: Number(retentionDays) }) });
}
/** Bundled apps resolve their matching retained package, not a nonexistent sibling of dist/server.js or the app's main entry. */
function resolvePackagedBlogActor(projectRoot: string): string {
  const adjacent = fileURLToPath(new URL('./content-actor-entry.ts', import.meta.url));
  if (existsSync(adjacent)) return adjacent;
  try {
    const server = Bun.resolveSync('@zero/framework/blog/server', projectRoot);
    const packaged = join(dirname(server), 'content-actor-entry.ts');
    if (existsSync(packaged)) return packaged;
  } catch { /* Runtime startup reports the safe missing-entry classification if retained source was omitted. */ }
  return adjacent;
}
