/** Read-only publishing ownership diagnostics. Never opens the content actor, repairs state or reads posts. */
import { existsSync } from 'node:fs';
import type { ReactiveDB } from '../sync/reactive-db';
import type { ResolvedBlogContentConfig } from '../blog/content-config';
import { inspectBlogContentOwnerSchema } from '../blog/content-owner-schema';
import { blogContentRealm } from '../blog/content-realm';
import { contentHash } from '../blog/content-rows';
import { canonicalDatabaseRootIdentity, resolveDatabaseFile } from '../databases/database-file';
import { addPlatformDoctorFinding, type PlatformDoctorFindingSink } from './platform-doctor-contracts';

/** Inspect only private SYSTEM receipts and the declared file's existence; schema readiness is not runtime qualification. */
export function checkBlogContentState(db: Pick<ReactiveDB, 'prepare'>, config: ResolvedBlogContentConfig,
  findings: PlatformDoctorFindingSink): void {
  const docs = './docs-next/backend/blog/publishing-api.md';
  const state = inspectBlogContentOwnerSchema(db);
  const add = (code: string, message: string, hint: string, severity: 'error' | 'warning' | 'info') =>
    addPlatformDoctorFinding(findings, { code: `blog.content.${code}`, message, hint, severity, path: 'blog.content', docs });
  if (state !== 'ready') {
    add(`schema_${state}`, 'Publishing ownership metadata is missing or incompatible.',
      'Apply the reviewed additive SYSTEM migration 048. Doctor never creates tables or adopts retained content.', 'error');
    return;
  }
  const row = db.prepare('SELECT owner_id,root_hash,realm_fingerprint,established FROM _blog_content_owner WHERE id=?')
    .get('blog:content') as { owner_id: string; root_hash: string; realm_fingerprint: string; established: number } | null;
  const fileExists = existsSync(resolveDatabaseFile(config.rootDirectory, 'blog:content').path);
  if (!row) {
    add(fileExists ? 'owner_missing' : 'provision_pending', fileExists ? 'Retained content has no SYSTEM ownership receipt.' : 'Publishing awaits normal managed provisioning.',
      fileExists ? 'Recover the matching SYSTEM receipt; do not relabel or overwrite an existing content file.' : 'Start normally with reviewed migration/provisioning enabled, then rerun Doctor.', fileExists ? 'error' : 'warning');
    return;
  }
  if (!/^bln_[0-9a-f-]{36}$/.test(row.owner_id) || !/^[a-f0-9]{64}$/.test(row.root_hash)
    || !/^[a-f0-9]{64}$/.test(row.realm_fingerprint) || ![0, 1].includes(row.established)) {
    add('owner_invalid', 'The retained publishing ownership receipt is malformed.', 'Investigate retained state through reviewed recovery; do not reset the owner.', 'error');
  } else if (row.root_hash !== contentHash(canonicalDatabaseRootIdentity(config.rootDirectory))) {
    add('root_changed', 'The configured publishing root differs from its retained ownership receipt.', 'Restore the declared root or use an explicit reviewed recovery; no filesystem paths are emitted here.', 'error');
  } else if (row.established === 1 && !fileExists) {
    add('file_missing', 'Established publishing content is missing.', 'Restore its matching retained file; never provision an empty replacement.', 'error');
  } else if (row.realm_fingerprint !== blogContentRealm.fingerprint || row.established !== 1) {
    add('migration_pending', 'Publishing awaits realm reconciliation by managed startup.', 'Use reviewed migration admission; Doctor does not start actors or change fingerprints.', 'warning');
  } else add('ownership_ready', 'Publishing file ownership matches the declared private realm.', 'This does not qualify current authority, media delivery, workers or browser publishing flows.', 'info');
}
