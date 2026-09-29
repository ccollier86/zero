/** Server-only password credential persistence and security-state lifecycle. */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import type { AuthAuditActor, AuthAuditRequestContext } from './auth-audit-types';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import type { AuthError } from './types';

export interface AuthSecurityAuditContext {
  actor: AuthAuditActor;
  request?: AuthAuditRequestContext;
}

interface CredentialRow {
  user_id: string;
  password_hash: string;
}

interface UserCredentialStoreHooks {
  mutation<T>(operation: () => T): T;
  assertCurrentProfile(): void;
  identityExists(userId: string): boolean;
  setPasswordChangeRequired(userId: string, required: boolean): boolean;
  revokeAllUserTokens(userId: string): void;
  recordSecurityAudit(
    action: string,
    userId: string,
    context?: AuthSecurityAuditContext,
    fallbackActor?: AuthAuditActor,
  ): void;
  invariant(component: string, invariant: string, message: string): AuthError;
}

interface ResetPasswordOptions {
  passwordChangeRequired?: boolean;
  audit?: AuthSecurityAuditContext;
  beforeCommit?: () => void;
}

/**
 * Owns password hashes and the identity/session transitions coupled to them.
 * UserStore supplies narrow identity, transaction, audit, and revocation hooks
 * so this store does not own or reach back into the public facade.
 */
export class UserCredentialStore {
  private readonly stmts: {
    insertCredential: Statement;
    getCredential: Statement;
    updateCredential: Statement;
    updateCredentialIfCurrent: Statement;
  };

  constructor(
    db: ReactiveDB,
    private readonly hooks: UserCredentialStoreHooks,
  ) {
    this.stmts = {
      insertCredential: db.prepare(
        'INSERT INTO _credentials (user_id, password_hash) VALUES (?, ?)',
      ),
      getCredential: db.prepare(
        'SELECT * FROM _credentials WHERE user_id = ?',
      ),
      updateCredential: db.prepare(
        'UPDATE _credentials SET password_hash = ? WHERE user_id = ?',
      ),
      updateCredentialIfCurrent: db.prepare(
        `UPDATE _credentials SET password_hash = ?
         WHERE user_id = ? AND password_hash = ?`,
      ),
    };
  }

  hashPassword(password: string): Promise<string> {
    return Bun.password.hash(password);
  }

  insertCredential(userId: string, passwordHash: string): void {
    this.stmts.insertCredential.run(userId, passwordHash);
  }

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    this.hooks.assertCurrentProfile();
    const credential = this.getCredential(userId);
    if (!credential) return false;
    const valid = await Bun.password.verify(password, credential.password_hash);
    this.hooks.assertCurrentProfile();
    return valid;
  }

  async updatePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    auditContext?: AuthSecurityAuditContext,
  ): Promise<boolean> {
    this.hooks.assertCurrentProfile();
    const credential = this.getCredential(userId);
    if (!credential) return false;
    const valid = await Bun.password.verify(currentPassword, credential.password_hash);
    this.hooks.assertCurrentProfile();
    if (!valid) return false;

    const newHash = await this.hashPassword(newPassword);
    this.hooks.assertCurrentProfile();
    return this.hooks.mutation(() => {
      // Compare-and-swap the exact hash that was verified. Two concurrent
      // changes from one old password cannot both commit after async hashing.
      if (this.stmts.updateCredentialIfCurrent.run(
        newHash,
        userId,
        credential.password_hash,
      ).changes !== 1) return false;
      if (!this.hooks.setPasswordChangeRequired(userId, false)) {
        throw this.hooks.invariant(
          'credentials',
          'password-user-missing',
          '[auth] Password credential lost its user row.',
        );
      }
      this.hooks.revokeAllUserTokens(userId);
      this.hooks.recordSecurityAudit(
        'account.password-changed',
        userId,
        auditContext,
        { userId, provenance: 'authenticated-request' },
      );
      return true;
    });
  }

  async resetPassword(
    userId: string,
    newPassword: string,
    options: ResetPasswordOptions = {},
  ): Promise<boolean> {
    if (!this.hooks.identityExists(userId)) return false;

    const newHash = await this.hashPassword(newPassword);
    return this.hooks.mutation(() => {
      if (options.beforeCommit) {
        invokeSynchronousAuthCallback(options.beforeCommit, {
          component: 'credentials',
          invariant: 'password-reset-before-commit-async',
          message: '[auth] Password reset beforeCommit must be synchronous.',
          createError: () => this.hooks.invariant(
            'credentials',
            'password-reset-before-commit-async',
            '[auth] Password reset beforeCommit must be synchronous.',
          ),
        });
      }
      if (this.stmts.updateCredential.run(newHash, userId).changes !== 1) {
        // The identity may legitimately have been deleted while password
        // hashing yielded. A retained identity without its required
        // credential is instead a corrupt security state, never "not found".
        if (!this.hooks.identityExists(userId)) return false;
        throw this.hooks.invariant(
          'credentials',
          'password-reset-credential-missing',
          '[auth] Password reset credential is unavailable.',
        );
      }
      if (!this.hooks.setPasswordChangeRequired(
        userId,
        options.passwordChangeRequired ?? false,
      )) {
        throw this.hooks.invariant(
          'credentials',
          'password-user-missing',
          '[auth] Password credential lost its user row.',
        );
      }
      this.hooks.revokeAllUserTokens(userId);
      this.hooks.recordSecurityAudit(
        'account.password-reset-by-admin',
        userId,
        options.audit,
      );
      return true;
    });
  }

  async completePasswordAction(
    userId: string,
    newPassword: string,
    consumeActionToken: () => void,
    auditContext?: AuthSecurityAuditContext,
  ): Promise<boolean> {
    const newHash = await this.hashPassword(newPassword);

    return this.hooks.mutation(() => {
      if (!this.hooks.identityExists(userId)) return false;
      invokeSynchronousAuthCallback(consumeActionToken, {
        component: 'credentials',
        invariant: 'password-recovery-token-consumer-async',
        message: '[auth] Password recovery token consumption must be synchronous.',
        createError: () => this.hooks.invariant(
          'credentials',
          'password-recovery-token-consumer-async',
          '[auth] Password recovery token consumption must be synchronous.',
        ),
      });
      if (this.stmts.updateCredential.run(newHash, userId).changes !== 1) {
        throw this.hooks.invariant(
          'credentials',
          'recovery-credential-missing',
          '[auth] Password recovery credential is unavailable.',
        );
      }
      if (!this.hooks.setPasswordChangeRequired(userId, false)) {
        throw this.hooks.invariant(
          'credentials',
          'recovery-user-missing',
          '[auth] Password recovery credential lost its user row.',
        );
      }
      this.hooks.revokeAllUserTokens(userId);
      this.hooks.recordSecurityAudit(
        'account.password-recovered',
        userId,
        auditContext,
        { userId, provenance: 'account-recovery' },
      );
      return true;
    });
  }

  requirePasswordChange(
    userId: string,
    auditContext?: AuthSecurityAuditContext,
  ): boolean {
    return this.setPasswordChangeRequired(
      userId,
      true,
      'account.password-change-required',
      auditContext,
    );
  }

  clearPasswordChangeRequired(
    userId: string,
    auditContext?: AuthSecurityAuditContext,
  ): boolean {
    return this.setPasswordChangeRequired(
      userId,
      false,
      'account.password-change-requirement-cleared',
      auditContext,
    );
  }

  private getCredential(userId: string): CredentialRow | null {
    return this.stmts.getCredential.get(userId) as CredentialRow | null;
  }

  private setPasswordChangeRequired(
    userId: string,
    required: boolean,
    auditAction: string,
    auditContext?: AuthSecurityAuditContext,
  ): boolean {
    return this.hooks.mutation(() => {
      if (!this.hooks.setPasswordChangeRequired(userId, required)) return false;
      this.hooks.revokeAllUserTokens(userId);
      this.hooks.recordSecurityAudit(auditAction, userId, auditContext);
      return true;
    });
  }
}
