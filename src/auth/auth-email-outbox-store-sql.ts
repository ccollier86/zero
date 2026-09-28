import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';

export interface AuthEmailOutboxStatements {
  recent: Statement;
  activeCount: Statement;
  totalCount: Statement;
  insert: Statement;
  insertInvitation?: Statement;
  insertDomainMailbox?: Statement;
  nextDue: Statement;
  claim: Statement;
  complete: Statement;
  release: Statement;
  retry: Statement;
  dead: Statement;
  extendLease: Statement;
  recover: Statement;
  cleanup: Statement;
  statusCount: Statement;
}

export function prepareAuthEmailOutboxStatements(
  db: ReactiveDB,
  invitationCapable = false,
  domainCapable = false,
): AuthEmailOutboxStatements {
  const scrubInvitation = invitationCapable ? ', secret_envelope = NULL' : '';
  const scrubDomain = domainCapable ? `,
          domain_user_id = NULL, domain_email_generation = NULL,
          domain_auth_generation = NULL, domain_identity_kind = NULL,
          domain_identity_continuation_id = NULL` : '';
  return {
    recent: db.prepare(`SELECT 1 FROM _auth_email_outbox
      WHERE recipient_hash = ? AND kind = ? AND created_at >= ? LIMIT 1`),
    activeCount: db.prepare(`SELECT COUNT(*) AS count FROM _auth_email_outbox
      WHERE status IN ('pending', 'processing')`),
    totalCount: db.prepare('SELECT COUNT(*) AS count FROM _auth_email_outbox'),
    insert: db.prepare(`INSERT INTO _auth_email_outbox
      (job_id, kind, recipient, recipient_hash, native_continuation, status,
       attempts, available_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`),
    ...(invitationCapable ? {
      insertInvitation: db.prepare(`INSERT INTO _auth_email_outbox
        (job_id, kind, recipient, recipient_hash, native_continuation,
         invitation_id, secret_envelope, status, attempts, available_at,
         created_at, updated_at)
        VALUES (?, 'tenant_invitation', ?, ?, NULL, ?, ?, 'pending', 0, ?, ?, ?)`),
    } : {}),
    ...(domainCapable ? {
      insertDomainMailbox: db.prepare(`INSERT INTO _auth_email_outbox
        (job_id, kind, recipient, recipient_hash, native_continuation,
         invitation_id, secret_envelope, domain_user_id,
         domain_email_generation, domain_auth_generation, domain_identity_kind,
         domain_identity_continuation_id, status, attempts, available_at,
         created_at, updated_at)
        VALUES (?, 'domain_mailbox_proof', ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?,
          'pending', 0, ?, ?, ?)`),
    } : {}),
    nextDue: db.prepare(`SELECT * FROM _auth_email_outbox
      WHERE (status = 'pending' AND available_at <= ?)
         OR (status = 'processing' AND lease_expires_at <= ?)
      ORDER BY available_at, created_at LIMIT 1`),
    claim: db.prepare(`UPDATE _auth_email_outbox
      SET status = 'processing', attempts = attempts + 1, lease_owner = ?,
          lease_expires_at = ?, updated_at = ?
      WHERE job_id = ? AND ((status = 'pending' AND available_at <= ?)
        OR (status = 'processing' AND lease_expires_at <= ?))`),
    complete: db.prepare(`UPDATE _auth_email_outbox
      SET status = ?, recipient = '', native_continuation = NULL,
          lease_owner = NULL, lease_expires_at = NULL, completed_at = ?, updated_at = ?
          ${scrubInvitation}${scrubDomain}
      WHERE job_id = ? AND status = 'processing' AND lease_owner = ?`),
    release: db.prepare(`UPDATE _auth_email_outbox
      SET status = 'pending', attempts = MAX(0, attempts - 1), available_at = ?,
          lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE job_id = ? AND status = 'processing' AND lease_owner = ?`),
    retry: db.prepare(`UPDATE _auth_email_outbox
      SET status = 'pending', available_at = ?, lease_owner = NULL,
          lease_expires_at = NULL, last_error_code = ?, updated_at = ?
      WHERE job_id = ? AND status = 'processing' AND lease_owner = ?`),
    dead: db.prepare(`UPDATE _auth_email_outbox
      SET status = 'dead', recipient = '', native_continuation = NULL,
          lease_owner = NULL, lease_expires_at = NULL, completed_at = ?,
          last_error_code = ?, updated_at = ? ${scrubInvitation}${scrubDomain}
      WHERE job_id = ? AND status = 'processing' AND lease_owner = ?`),
    extendLease: db.prepare(`UPDATE _auth_email_outbox SET lease_expires_at = ?, updated_at = ?
      WHERE job_id = ? AND status = 'processing' AND lease_owner = ?`),
    recover: db.prepare(`UPDATE _auth_email_outbox SET status = 'pending',
      lease_owner = NULL, lease_expires_at = NULL, available_at = ?, updated_at = ?
      WHERE status = 'processing' AND lease_expires_at <= ?`),
    cleanup: db.prepare(`DELETE FROM _auth_email_outbox
      WHERE completed_at IS NOT NULL AND completed_at < ?`),
    statusCount: db.prepare(`SELECT COUNT(*) AS count FROM _auth_email_outbox WHERE status = ?`),
  };
}
