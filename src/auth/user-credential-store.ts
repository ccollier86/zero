/** Server-only password credential persistence and security-state lifecycle. */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import type { AuthAuditActor, AuthAuditRequestContext } from './auth-audit-types';
import {
  captureAuthAuditActor,
  captureAuthAuditRequestContext,
} from './auth-audit-service';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import { AuthError } from './types';

export interface AuthSecurityAuditContext {
  actor: AuthAuditActor;
  request?: AuthAuditRequestContext;
}

interface CredentialRow {
  user_id: string;
  password_hash: string;
}

interface AuthenticationCredentialRow extends CredentialRow {
  auth_generation: number;
}

/** Secret-free continuity proof produced by a current password verification. */
export interface PasswordAuthenticationProof {
  readonly userId: string;
  readonly authGeneration: number;
}

/** Post-commit generation authorized to replace a changed-password session. */
export interface PasswordChangeAuthenticationReceipt {
  readonly userId: string;
  readonly authGeneration: number;
}

/** Exact live-session proof required by authenticated password changes. */
export interface PasswordChangeAuthenticationAdmission {
  readonly expectedAuthGeneration: number;
  readonly admit: () => boolean;
}

interface UserCredentialStoreHooks {
  mutation<T>(operation: () => T): T;
  assertCurrentProfile(): void;
  identityExists(userId: string): boolean;
  setPasswordChangeRequired(userId: string, required: boolean): boolean;
  revokeAllUserTokens(userId: string): void;
  getAuthGeneration(userId: string): number;
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
    getAuthenticationCredential: Statement;
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
      getAuthenticationCredential: db.prepare(`
        SELECT credential.user_id, credential.password_hash,
          COALESCE(generation.generation, 0) AS auth_generation
        FROM _credentials credential
        LEFT JOIN _auth_user_generations generation
          ON generation.user_id = credential.user_id
        WHERE credential.user_id = ?
      `),
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

  verifyPasswordHash(password: string, passwordHash: string): Promise<boolean> {
    return Bun.password.verify(password, passwordHash);
  }

  insertCredential(userId: string, passwordHash: string): void {
    this.stmts.insertCredential.run(userId, passwordHash);
  }

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    return (await this.verifyPasswordForAuthentication(userId, password)) !== null;
  }

  /**
   * Verify a password and bind the result to the exact security generation.
   * Session/transition admission must carry this proof so a later reset cannot
   * bless the old password with a new generation.
   */
  async verifyPasswordForAuthentication(
    userId: string,
    password: string,
  ): Promise<PasswordAuthenticationProof | null> {
    this.hooks.assertCurrentProfile();
    const credential = this.getAuthenticationCredential(userId);
    if (!credential) return null;
    const valid = await this.verifyPasswordHash(password, credential.password_hash);
    this.hooks.assertCurrentProfile();
    if (!valid) return null;
    // A password verification may overlap an administrator reset or another
    // credential transition. Never let a result for the old hash authenticate
    // against the new security generation.
    const current = this.getAuthenticationCredential(userId);
    if (current?.password_hash !== credential.password_hash
      || current.auth_generation !== credential.auth_generation) return null;
    return Object.freeze({
      userId: credential.user_id,
      authGeneration: credential.auth_generation,
    });
  }

  async updatePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    auditContext?: AuthSecurityAuditContext,
  ): Promise<boolean> {
    return (await this.updatePasswordForAuthentication(
      userId,
      currentPassword,
      newPassword,
      auditContext,
    )) !== null;
  }

  /** Change a password and return the exact generation committed with it. */
  async updatePasswordForAuthentication(
    userId: string,
    currentPassword: string,
    newPassword: string,
    auditContext?: AuthSecurityAuditContext,
    admission?: PasswordChangeAuthenticationAdmission,
  ): Promise<PasswordChangeAuthenticationReceipt | null> {
    const capturedAuditContext = captureSecurityAuditContext(auditContext);
    const capturedAdmission = capturePasswordChangeAdmission(admission);
    this.hooks.assertCurrentProfile();
    const credential = this.getAuthenticationCredential(userId);
    if (!credential) return null;
    const valid = await this.verifyPasswordHash(currentPassword, credential.password_hash);
    this.hooks.assertCurrentProfile();
    if (!valid) return null;

    const newHash = await this.hashPassword(newPassword);
    this.hooks.assertCurrentProfile();
    return this.hooks.mutation(() => {
      if (this.hooks.getAuthGeneration(userId) !== credential.auth_generation) {
        if (capturedAdmission) throw authenticationStateChanged();
        return null;
      }
      if (capturedAdmission) {
        if (capturedAdmission.expectedAuthGeneration !== credential.auth_generation) {
          throw authenticationStateChanged();
        }
        const admitted = invokeSynchronousAuthCallback(capturedAdmission.admit, {
          component: 'credentials',
          invariant: 'password-change-session-admission-async',
          message: '[auth] Password change session admission must be synchronous.',
          createError: () => this.hooks.invariant(
            'credentials',
            'password-change-session-admission-async',
            '[auth] Password change session admission must be synchronous.',
          ),
        });
        if (!admitted) throw authenticationStateChanged();
      }
      // Compare-and-swap the exact hash that was verified. Two concurrent
      // changes from one old password cannot both commit after async hashing.
      if (this.stmts.updateCredentialIfCurrent.run(
        newHash,
        userId,
        credential.password_hash,
      ).changes !== 1) return null;
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
        capturedAuditContext,
        { userId, provenance: 'authenticated-request' },
      );
      return Object.freeze({
        userId,
        authGeneration: this.hooks.getAuthGeneration(userId),
      });
    });
  }

  async resetPassword(
    userId: string,
    newPassword: string,
    options: ResetPasswordOptions = {},
  ): Promise<boolean> {
    const capturedOptions = captureResetPasswordOptions(options);
    if (!this.hooks.identityExists(userId)) return false;

    const newHash = await this.hashPassword(newPassword);
    return this.hooks.mutation(() => {
      if (capturedOptions.beforeCommit) {
        invokeSynchronousAuthCallback(capturedOptions.beforeCommit, {
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
        capturedOptions.passwordChangeRequired ?? false,
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
        capturedOptions.audit,
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
    const capturedConsumeActionToken = consumeActionToken;
    const capturedAuditContext = captureSecurityAuditContext(auditContext);
    const newHash = await this.hashPassword(newPassword);

    return this.hooks.mutation(() => {
      if (!this.hooks.identityExists(userId)) return false;
      invokeSynchronousAuthCallback(capturedConsumeActionToken, {
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
        capturedAuditContext,
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

  private getAuthenticationCredential(userId: string): AuthenticationCredentialRow | null {
    return this.stmts.getAuthenticationCredential.get(
      userId,
    ) as AuthenticationCredentialRow | null;
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

/** Detach caller-owned audit attribution before an async password hash yields. */
function captureSecurityAuditContext(
  input: AuthSecurityAuditContext | undefined,
): AuthSecurityAuditContext | undefined {
  if (input === undefined) return undefined;
  const actor = captureAuthAuditActor(input.actor);
  if (!actor) return undefined;
  const request = captureAuthAuditRequestContext(input.request);
  return Object.freeze({
    actor,
    ...(request === undefined ? {} : { request }),
  });
}

/** Snapshot reset controls and audit attribution before an async password hash yields. */
function captureResetPasswordOptions(
  input: ResetPasswordOptions,
): Readonly<ResetPasswordOptions> {
  const passwordChangeRequired = input.passwordChangeRequired;
  const beforeCommit = input.beforeCommit;
  const audit = captureSecurityAuditContext(input.audit);
  return Object.freeze({ passwordChangeRequired, beforeCommit, audit });
}

function capturePasswordChangeAdmission(
  input: PasswordChangeAuthenticationAdmission | undefined,
): Readonly<PasswordChangeAuthenticationAdmission> | null {
  if (!input) return null;
  return Object.freeze({
    expectedAuthGeneration: input.expectedAuthGeneration,
    admit: input.admit,
  });
}

function authenticationStateChanged(): AuthError {
  return new AuthError(
    'Authentication state changed; sign in again',
    'AUTH_STATE_CHANGED',
    409,
  );
}
