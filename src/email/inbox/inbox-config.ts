/** Shared startup/Doctor admission. No sockets or database writes. */
import { isAbsolute, relative, resolve } from 'node:path';
import { canonicalDatabaseOwnershipPathKey } from '../../databases/database-path-ownership';
import type { ResolvedConfig } from '../../frontend/server/types';

export function emailInboxConfigIssues(config: Pick<ResolvedConfig, 'email' | 'auth' | 'projectRoot' | 'outDir' | 'storageDir' | 'appDir'>): string[] {
  if (!config.email || !config.email.inbox) return [];
  const inbox = config.email.inbox, issues: string[] = [];
  if (config.auth === false) issues.push('Guardian authentication must be enabled.');
  const tenancy = config.auth && config.auth.tenancy;
  if ((tenancy === 'multi' || typeof tenancy === 'object' && tenancy.mode === 'multi') && !inbox.accounts) issues.push('Multi-tenant mail requires an authorized accounts resolver.');
  if (!inbox.accounts && !config.email.imap) issues.push('Configure email.imap or supply an accounts resolver.');
  if (inbox.accounts !== undefined && typeof inbox.accounts !== 'function') issues.push('The accounts resolver must be a server-owned function.');
  if (typeof inbox.statePath !== 'string' || !inbox.statePath.trim()) issues.push('A dedicated private statePath is required.');
  else if (inbox.statePath !== ':memory:') {
    try {
      const path = canonicalDatabaseOwnershipPathKey(resolve(config.projectRoot, inbox.statePath));
      for (const directory of [config.outDir, config.storageDir, config.appDir]) {
        const inside = relative(canonicalDatabaseOwnershipPathKey(directory), path);
        if (inside === '' || !inside.startsWith('..') && !isAbsolute(inside)) { issues.push('State must be outside application assets and public storage, including symlink aliases.'); break; }
      }
    } catch { issues.push('The statePath ownership could not be safely resolved.'); }
  }
  return issues;
}
