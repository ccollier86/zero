import type { AccessRequirement } from '../../auth/authorization-kernel';
import type { ZeroLifecycleContext } from '../../frontend/server/server-extensions';
import type { ImapMailbox } from '../imap-mailbox';
import type { EmailServiceLike } from '../types';
import type { EmailInboxIdentity } from './contracts';

export interface EmailInboxServerAccount {
  /** Stable, opaque account ID. Reusing an ID must never change its owner. */
  id: string; label: string; address: string;
  mailbox: Pick<ImapMailbox, 'folders' | 'browse' | 'read' | 'setFlags' | 'move' | 'watch'>;
  /** Omit for a read-only mailbox. Every From identity must be explicitly admitted. */
  sender?: EmailServiceLike;
  sendAs?: EmailInboxIdentity[];
  readOnly?: boolean;
  live?: boolean;
}

export interface EmailInboxConfig {
  /** Dedicated private SQLite file, not the app/Guardian DB or a publicly served directory. ':memory:' is test-only. */
  statePath: string;
  /** Defaults to platform admin. Cannot make the inbox anonymous. */
  access?: AccessRequirement;
  label?: string;
  /** Required in multi-tenant apps. Return only the accounts admitted for this server-derived context. */
  accounts?: (context: ZeroLifecycleContext) => readonly EmailInboxServerAccount[] | Promise<readonly EmailInboxServerAccount[]>;
}
