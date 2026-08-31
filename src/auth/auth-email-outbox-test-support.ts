import { configureEmail, getEmailRuntime, type EmailMessage,
  type EmailProvider } from '../email';
import { createReactiveDB } from '../sync/reactive-db';
import { AccountEmailService } from './account-email-service';
import { AuthActionTokenService } from './action-token-service';
import { resolveAuthBehaviorConfig } from './auth-config';
import { AuthEmailOutbox } from './auth-email-outbox';
import { defineAuthTables } from './auth-schema';
import { RegistrationIntentStore } from './registration-intent-store';
import { UserStore } from './user-store';

export function fixture(provider: EmailProvider, clock = Date.now) {
  configureEmail({ from: 'Zero <noreply@test.com>', provider },
    { name: 'Zero', publicUrl: 'https://app.test' });
  const db = createReactiveDB({ mode: 'memory' });
  defineAuthTables(db);
  const config = resolveAuthBehaviorConfig();
  const users = new UserStore(db);
  const tokens = new AuthActionTokenService(users, '1h', '5m', null);
  const email = new AccountEmailService(getEmailRuntime, config);
  const outbox = new AuthEmailOutbox(db, {
    store: users, tokens, email, registrationIntents: new RegistrationIntentStore(db),
    config, getNative: () => null,
  }, { baseBackoffMs: 10, maxBackoffMs: 10, pollMs: 10 }, clock);
  return { db, users, tokens, outbox, config };
}

export function user(email: string) {
  return { username: email.split('@')[0]!, email, password: 'password123' };
}

export function activeTokens(db: ReturnType<typeof createReactiveDB>) {
  return (db.prepare(`SELECT COUNT(*) AS count FROM _auth_action_tokens
    WHERE consumed_at IS NULL`).get() as { count: number }).count;
}

export function terminalRecipient(db: ReturnType<typeof createReactiveDB>, status: string) {
  return (db.prepare(`SELECT recipient FROM _auth_email_outbox WHERE status = ?`)
    .get(status) as { recipient: string }).recipient;
}

export function emailToken(message: EmailMessage): string {
  const token = message.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error('Expected auth action token in email');
  return token;
}
