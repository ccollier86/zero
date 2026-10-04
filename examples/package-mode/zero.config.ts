/**
 * zero.config.ts
 *
 * App-owned Zero runtime configuration. This file selects platform systems and
 * paths; it does not start the HTTP server.
 */

import { defineZeroConfig, resolveAIConfig } from '@zero/framework/server';
import type { SQLiteStorageConfig, SQLiteStorageMode } from '@zero/framework/server';
import { tables } from './db/schema';

const PORT = Number(Bun.env.PORT ?? 3000);
const APP_NAME = readEnv('APP_NAME') ?? 'Zero App';
const hasEmail = Boolean(Bun.env.RESEND_API_KEY);
const authEnabled = Bun.env.ZERO_AUTH_ENABLED === 'true';
const aiEnabled = readEnv('ZERO_AI_ENABLED');
const detectedAI = resolveAIConfig(true);
const hasDetectedAIProvider = detectedAI !== false
  && Object.values(detectedAI.providers).some((provider) => provider.active);
const hasAI = aiEnabled === 'true' || (
  aiEnabled !== 'false'
  && hasDetectedAIProvider
);
const hasVector = Bun.env.ZERO_VECTOR_ENABLED === 'true';
const hasPdf = Bun.env.ZERO_PDF_ENABLED === 'true';
const kvDurability = Bun.env.ZERO_KV_DURABILITY === 'always' ? 'always' : 'everysec';

export const config = defineZeroConfig({
  app: {
    name: APP_NAME,
    publicUrl: readEnv('APP_PUBLIC_URL') ?? `http://localhost:${PORT}`,
    supportEmail: readEnv('APP_SUPPORT_EMAIL'),
  },
  db: resolveDatabaseConfig(),
  systemDb: resolveSystemDatabaseConfig(),
  tables,

  // The generated starter stays public until ZERO_AUTH_ENABLED=true. Once
  // enabled, an operator-held secret is required for the one-time first-admin
  // ceremony; ordinary registration follows `mode` after that.
  auth: authEnabled
    ? {
        bootstrap: {
          mode: 'secret',
          secret: readEnv('AUTH_BOOTSTRAP_SECRET'),
        },
        registration: {
          mode: 'public',
        },
        account: {
          requireEmailVerification:
            Bun.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true',
          emailVerificationPath:
            readEnv('AUTH_EMAIL_VERIFICATION_PATH') ?? '/verify-email',
        },
        accountEmails: {
          adminCreatedUser: hasEmail,
          passwordReset: hasEmail,
          manualPasswordReset: Bun.env.AUTH_MANUAL_PASSWORD_RESET !== 'false',
          actionTokenTTL: readEnv('AUTH_ACTION_TOKEN_TTL') ?? '1h',
          requestCooldown: readEnv('AUTH_ACCOUNT_EMAIL_COOLDOWN') ?? '5m',
        },
      }
    : false,
  routeAuth: 'explicit',
  sitemap: {
    enabled: true,
    changefreq: 'weekly',
    priority: 0.7,
    exclude: ['/login', '/forgot-password', '/reset-password'],
  },
  email: hasEmail
    ? {
        provider: 'resend',
        from: readEnv('EMAIL_FROM') ?? `${APP_NAME} <noreply@example.com>`,
        replyTo: readEnv('EMAIL_REPLY_TO'),
        resend: {
          apiKey: Bun.env.RESEND_API_KEY,
        },
      }
    : false,
  ai: hasAI ? true : false,
  vector: hasVector
    ? {
        dataDir: Bun.env.ZERO_VECTOR_DATA_DIR ?? './data/vector',
        defaultDimensions: Number(Bun.env.ZERO_VECTOR_DEFAULT_DIMENSIONS ?? 1536),
      }
    : false,
  pdf: hasPdf
    ? {
        browser: {
          executablePath: readEnv('ZERO_PDF_EXECUTABLE_PATH'),
        },
      }
    : false,
  kv: {
    baseDir: readEnv('ZERO_KV_BASE_DIR') ?? './data/kv',
    durability: kvDurability,
  },
  stateSync: false,
  appDir: './app',
  serverPluginsDir: './server/plugins',
  serverMiddlewareDir: './server/middleware',
  serverEndpointsDir: './server/endpoints',
  serverRoutesDir: './server/routes',
  serverResourcesDir: './server/resources',
  generatedDir: './.zero/generated',
  outDir: './.build',
  port: PORT,
});

export default config;

/** Resolve app database config from env while keeping hot mode as the default. */
function resolveDatabaseConfig(): SQLiteStorageConfig {
  const mode = resolveDatabaseMode(Bun.env.DB_MODE, 'DB_MODE', 'hot');
  const path = readEnv('DB_PATH') ?? './data/app.db';
  const snapshotPath = readEnv('DB_SNAPSHOT_PATH') ?? './data/app.snapshot.db';

  if (mode === 'ephemeral') return { mode };
  if (mode === 'file') return { mode, path };

  return {
    mode,
    path,
    snapshotPath,
  };
}

/** Keep Zero/Guardian authority durable and separate from application data. */
function resolveSystemDatabaseConfig(): SQLiteStorageConfig {
  const mode = resolveDatabaseMode(
    Bun.env.SYSTEM_DB_MODE,
    'SYSTEM_DB_MODE',
    'file',
  );
  const path = readEnv('SYSTEM_DB_PATH') ?? './data/zero.system.db';
  const snapshotPath = readEnv('SYSTEM_DB_SNAPSHOT_PATH')
    ?? './data/zero.system.snapshot.db';

  if (mode === 'ephemeral') return { mode };
  if (mode === 'file') return { mode, path };

  return { mode, path, snapshotPath };
}

function resolveDatabaseMode(
  value: string | undefined,
  variable: string,
  fallback: SQLiteStorageMode,
): SQLiteStorageMode {
  if (!value) return fallback;
  if (value === 'hot' || value === 'file' || value === 'ephemeral') return value;
  throw new Error(`${variable} must be "hot", "file", or "ephemeral"; received "${value}".`);
}

function readEnv(name: string): string | undefined {
  const value = Bun.env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
