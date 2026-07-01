/**
 * zero.config.ts
 *
 * App-owned Zero runtime configuration for the package-mode fixture. This file
 * selects platform systems and paths; it does not start the HTTP server.
 */

import { defineZeroConfig } from '@zero/framework/server';
import type { SQLiteStorageConfig, SQLiteStorageMode } from '@zero/framework/server';
import { tables } from './db/schema';

const PORT = Number(Bun.env.PORT ?? 3000);
const hasEmail = Boolean(Bun.env.RESEND_API_KEY);
const hasAI = Boolean(
  Bun.env.OPENAI_API_KEY
    || Bun.env.ANTHROPIC_API_KEY
    || Bun.env.GEMINI_API_KEY
    || Bun.env.GOOGLE_API_KEY
    || Bun.env.GROQ_API_KEY
    || Bun.env.META_LLAMA_API_KEY
    || Bun.env.LLAMA_API_KEY
);
const hasVector = Bun.env.ZERO_VECTOR_ENABLED === 'true';
const kvDurability = Bun.env.ZERO_KV_DURABILITY === 'always' ? 'always' : 'everysec';

export const config = defineZeroConfig({
  app: {
    name: Bun.env.APP_NAME ?? 'Zero Fixture',
    publicUrl: Bun.env.APP_PUBLIC_URL ?? `http://localhost:${PORT}`,
    supportEmail: Bun.env.APP_SUPPORT_EMAIL,
  },
  db: resolveDatabaseConfig(),
  tables,
  auth: {
    registration: { mode: 'admin-only' },
    accountEmails: {
      adminCreatedUser: hasEmail,
      passwordReset: hasEmail,
      manualPasswordReset: Bun.env.AUTH_MANUAL_PASSWORD_RESET !== 'false',
      actionTokenTTL: Bun.env.AUTH_ACTION_TOKEN_TTL ?? '1h',
      requestCooldown: Bun.env.AUTH_ACCOUNT_EMAIL_COOLDOWN ?? '5m',
    },
  },
  routeAuth: 'explicit',
  email: hasEmail
    ? {
        provider: 'resend',
        from: Bun.env.EMAIL_FROM ?? 'Zero Fixture <noreply@example.com>',
        replyTo: Bun.env.EMAIL_REPLY_TO,
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
  kv: {
    baseDir: Bun.env.ZERO_KV_BASE_DIR ?? './data/kv',
    durability: kvDurability,
  },
  stateSync: true,
  appDir: './app',
  serverPluginsDir: './server/plugins',
  serverMiddlewareDir: './server/middleware',
  serverEndpointsDir: './server/endpoints',
  serverRoutesDir: './server/routes',
  generatedDir: './.zero/generated',
  outDir: './.build',
  port: PORT,
});

export default config;

/** Resolve app database config from env while keeping hot mode as the default. */
function resolveDatabaseConfig(): SQLiteStorageConfig {
  const mode = resolveDatabaseMode(Bun.env.DB_MODE);
  const path = Bun.env.DB_PATH ?? './data/app.db';
  const snapshotPath = Bun.env.DB_SNAPSHOT_PATH ?? './data/app.snapshot.db';

  if (mode === 'ephemeral') return { mode };
  if (mode === 'file') return { mode, path };

  return {
    mode,
    path,
    snapshotPath,
  };
}

function resolveDatabaseMode(value: string | undefined): SQLiteStorageMode {
  if (!value) return 'hot';
  if (value === 'hot' || value === 'file' || value === 'ephemeral') return value;
  throw new Error(`DB_MODE must be "hot", "file", or "ephemeral"; received "${value}".`);
}
