import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emailInboxConfigIssues } from './inbox-config';
import { resolveConfig } from '../../frontend/server/types';
import { checkAuthAndEmail } from '../../doctor/platform-doctor-auth-email';
test('inbox startup and Doctor share optional/auth/tenancy/private-path admission without opening sockets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inbox-config-'));
  try {
    const base = { projectRoot: root, db: { mode: 'memory' as const }, tables: {}, appDir: join(root, 'app'), outDir: join(root, 'out'), storageDir: join(root, 'storage') };
    const imap = { host: 'imap.example.test', auth: { user: 'synthetic', pass: 'not-a-real-password' } };
    expect(emailInboxConfigIssues(resolveConfig({ ...base, email: false }))).toEqual([]);
    const invalid = resolveConfig({ ...base, auth: false, email: { provider: 'noop', imap, inbox: { statePath: join(root, 'storage', 'mail.sqlite') } } });
    expect(emailInboxConfigIssues(invalid).join(' ')).toContain('Guardian'); expect(emailInboxConfigIssues(invalid).join(' ')).toContain('public storage');
    await mkdir(join(root, 'storage')); await symlink(join(root, 'storage'), join(root, 'private-alias'));
    const alias = resolveConfig({ ...base, email: { provider: 'noop', imap, inbox: { statePath: join(root, 'private-alias', 'mail.sqlite') } } });
    expect(emailInboxConfigIssues(alias).join(' ')).toContain('symlink');
    const multi = resolveConfig({ ...base, auth: { tenancy: 'multi' }, email: { provider: 'noop', imap, inbox: { statePath: join(root, 'mail.sqlite') } } });
    expect(emailInboxConfigIssues(multi).join(' ')).toContain('resolver');
    const findings: any[] = []; checkAuthAndEmail(invalid, findings, {}, null);
    expect(findings.filter(finding => finding.code === 'email.inbox.config_invalid')).toHaveLength(2);
    expect(JSON.stringify(findings)).not.toContain('not-a-real-password');
  } finally { await rm(root, { recursive: true, force: true }); }
});
