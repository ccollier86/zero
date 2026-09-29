/** Bounded retention cleanup for transient verified-domain onboarding evidence. */

import type { ReactiveDB } from '../sync/reactive-db';

export interface VerifiedDomainEvidenceCleanupResult {
  mailboxTokens: number;
  transactions: number;
  mailboxProofs: number;
}

export function cleanupVerifiedDomainEvidence(input: {
  db: ReactiveDB;
  now: number;
  limit: number;
  assertCurrentProfile: () => void;
}): VerifiedDomainEvidenceCleanupResult {
  const requested = Number.isSafeInteger(input.limit) ? input.limit : 100;
  const bounded = Math.max(1, Math.min(requested, 1_000));
  return input.db.transaction(() => {
    input.assertCurrentProfile();
    const transactions = input.db.prepare(`
      DELETE FROM _auth_domain_onboarding_transactions
      WHERE transaction_id IN (
        SELECT transaction_id FROM _auth_domain_onboarding_transactions
        WHERE expires_at <= ? OR consumed_at IS NOT NULL
        ORDER BY COALESCE(consumed_at, expires_at) ASC, transaction_id ASC
        LIMIT ?
      )
      RETURNING transaction_id
    `).all(input.now, bounded).length;
    const mailboxTokens = input.db.prepare(`
      DELETE FROM _auth_domain_mailbox_tokens
      WHERE token_id IN (
        SELECT token_id FROM _auth_domain_mailbox_tokens
        WHERE expires_at <= ? OR (
          consumed_at IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM _auth_email_outbox outbox
            WHERE outbox.job_id = _auth_domain_mailbox_tokens.outbox_job_id
              AND outbox.status IN ('pending', 'processing')
          )
        )
        ORDER BY COALESCE(consumed_at, expires_at) ASC, token_id ASC
        LIMIT ?
      )
      RETURNING token_id
    `).all(input.now, bounded).length;
    const mailboxProofs = input.db.prepare(`
      DELETE FROM _auth_mailbox_proofs
      WHERE proof_id IN (
        SELECT proof_id FROM _auth_mailbox_proofs
        WHERE expires_at <= ? OR revoked_at IS NOT NULL
        ORDER BY COALESCE(revoked_at, expires_at) ASC, proof_id ASC
        LIMIT ?
      )
      RETURNING proof_id
    `).all(input.now, bounded).length;
    return { mailboxTokens, transactions, mailboxProofs };
  });
}
