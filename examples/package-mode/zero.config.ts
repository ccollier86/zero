/**
 * zero.config.ts
 *
 * App-owned Zero runtime configuration. This file selects platform systems and
 * paths; it does not start the HTTP server.
 */

import { defineZeroConfig } from '@zero/framework/server';
import type { SQLiteStorageConfig, SQLiteStorageMode } from '@zero/framework/server';
import { tables } from './db/schema';

const PORT = Number(Bun.env.PORT ?? 3000);
const APP_NAME = readEnv('APP_NAME') ?? 'Zero App';
const hasEmail = Boolean(Bun.env.RESEND_API_KEY);
const hasAI = Boolean(
  Bun.env.OPENAI_API_KEY
    || Bun.env.ANTHROPIC_API_KEY
    || Bun.env.GEMINI_API_KEY
    || Bun.env.GOOGLE_API_KEY
    || Bun.env.GROQ_API_KEY
    || Bun.env.XAI_API_KEY
    || Bun.env.COHERE_API_KEY
    || Bun.env.META_LLAMA_API_KEY
    || Bun.env.LLAMA_API_KEY
    || Bun.env.DEEPSEEK_API_KEY
    || Bun.env.PERPLEXITY_API_KEY
    || Bun.env.VOYAGE_API_KEY
    || Bun.env.DEEPGRAM_API_KEY
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
  tables,

  // Keep the generated starter public. Change this to `true` or an auth
  // object when your app needs accounts, email verification, MFA, or admin
  // user management.
  auth: false,
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
  const mode = resolveDatabaseMode(Bun.env.DB_MODE);
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

function resolveDatabaseMode(value: string | undefined): SQLiteStorageMode {
  if (!value) return 'hot';
  if (value === 'hot' || value === 'file' || value === 'ephemeral') return value;
  throw new Error(`DB_MODE must be "hot", "file", or "ephemeral"; received "${value}".`);
}

function readEnv(name: string): string | undefined {
  const value = Bun.env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
