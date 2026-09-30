/**
 * zero.config.ts
 *
 * LaunchBoard's app-owned Zero runtime configuration. This file selects
 * platform systems and paths; it does not start the HTTP server.
 */

import { defineZeroConfig } from '@zero/framework/server';
import type { EmailConfig, SQLiteStorageConfig, SQLiteStorageMode } from '@zero/framework/server';
import { launchBoardResources } from './app/launchboard/resources';
import { tables } from './app/launchboard/schema';

const port = Number(Bun.env.PORT ?? 3000);
const appName = Bun.env.APP_NAME ?? 'LaunchBoard';
const emailConfig = resolveLaunchBoardEmailConfig();
const hasEmailProvider = Boolean(emailConfig);

export const config = defineZeroConfig({
  app: {
    name: appName,
    publicUrl: Bun.env.APP_PUBLIC_URL ?? `http://localhost:${port}`,
    supportEmail: Bun.env.APP_SUPPORT_EMAIL,
  },
  db: resolveLaunchBoardDatabaseConfig(),
  email: emailConfig,
  tables,
  resources: launchBoardResources,
  auth: {
    registration: {
      mode: 'public',
    },
    account: {
      requireEmailVerification: Bun.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true',
      emailVerificationPath: Bun.env.AUTH_EMAIL_VERIFICATION_PATH ?? '/verify-email',
    },
    mfa: {
      enabled: Bun.env.AUTH_MFA_ENABLED !== 'false',
      policy: resolveMfaPolicy(Bun.env.AUTH_MFA_POLICY),
      methods: parseMfaMethods(Bun.env.AUTH_MFA_METHODS, hasEmailProvider),
      allowUserChoice: true,
      allowMultipleMethods: false,
      recoveryCodes: false,
      totp: {
        issuer: appName,
        encryptionKey: Bun.env.AUTH_TOTP_ENCRYPTION_KEY,
      },
    },
    branding: {
      appName,
      logoUrl: Bun.env.APP_LOGO_URL,
      supportEmail: Bun.env.APP_SUPPORT_EMAIL,
      brandColor: Bun.env.AUTH_EMAIL_BRAND_COLOR,
    },
  },
  postLoginPath: '/',
  sitemap: true,
  doctor: {
    indexedFields: {
      launch_categories: ['owner_id'],
      launch_boards: ['owner_id'],
      launch_columns: ['owner_id'],
      launch_cards: ['owner_id'],
    },
  },
  appDir: './app',
  port,
});

export default config;

/** Resolve the LaunchBoard dev database to Zero's hot in-memory runtime by default. */
function resolveLaunchBoardDatabaseConfig(): SQLiteStorageConfig {
  const mode = resolveDatabaseMode(Bun.env.DB_MODE);
  const path = Bun.env.DB_PATH ?? './data/launchboard.db';
  const snapshotPath = Bun.env.DB_SNAPSHOT_PATH ?? './data/launchboard.snapshot.db';

  if (mode === 'ephemeral') return { mode };
  if (mode === 'file') return { mode, path };

  return {
    mode,
    path,
    snapshotPath,
  };
}

function parseMfaMethods(value: string | undefined, canUseEmail: boolean): Array<'email' | 'totp'> {
  const raw = value?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
  const methods = raw.length > 0 ? raw : canUseEmail ? ['email', 'totp'] : ['totp'];
  return methods.filter((method): method is 'email' | 'totp' => method === 'email' || method === 'totp');
}

function resolveMfaPolicy(value: string | undefined): 'optional' | 'required' | 'admin-required' {
  if (value === 'required' || value === 'admin-required') return value;
  return 'optional';
}

/** Enable LaunchBoard account email when a Resend key is configured. */
function resolveLaunchBoardEmailConfig(): false | EmailConfig {
  const apiKey = Bun.env.RESEND_API_KEY;
  if (!apiKey) return false;

  return {
    provider: 'resend',
    from: Bun.env.EMAIL_FROM ?? 'LaunchBoard <noreply@mail.shadowboy.app>',
    replyTo: Bun.env.EMAIL_REPLY_TO ?? Bun.env.APP_SUPPORT_EMAIL,
    resend: { apiKey },
  };
}

function resolveDatabaseMode(value: string | undefined): SQLiteStorageMode {
  if (!value) return 'hot';
  if (value === 'hot' || value === 'file' || value === 'ephemeral') return value;
  throw new Error(`[launchboard] DB_MODE must be "hot", "file", or "ephemeral"; received "${value}".`);
}
