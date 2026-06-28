#!/usr/bin/env bash
set -euo pipefail

# ─── Usage ───────────────────────────────────────────────────────────────────
#
#   ./scripts/create-project.sh my-app
#   ./scripts/create-project.sh ~/projects/game
#   ./scripts/create-project.sh my-app --skip-install
#

PLATFORM_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_NAME="${1:?Usage: create-project.sh <project-name> [--skip-install]}"
SKIP_INSTALL=false

for arg in "$@"; do
  [[ "$arg" == "--skip-install" ]] && SKIP_INSTALL=true
done

# Resolve absolute path — if relative, create in cwd
if [[ "$PROJECT_NAME" == /* ]]; then
  PROJECT_DIR="$PROJECT_NAME"
  PROJECT_NAME="$(basename "$PROJECT_DIR")"
else
  PROJECT_DIR="$(pwd)/$PROJECT_NAME"
fi

if [[ -d "$PROJECT_DIR" ]]; then
  echo "Error: $PROJECT_DIR already exists"
  exit 1
fi

echo "Creating project: $PROJECT_NAME"
echo "  Platform: $PLATFORM_DIR"
echo "  Target:   $PROJECT_DIR"
echo ""

# ─── Create project structure ────────────────────────────────────────────────

mkdir -p "$PROJECT_DIR"/{app,app/\(api\)}

# ─── Copy platform source ───────────────────────────────────────────────────

echo "[1/5] Copying platform source..."
cp -r "$PLATFORM_DIR/src" "$PROJECT_DIR/src"
cp -r "$PLATFORM_DIR/docs" "$PROJECT_DIR/docs"

# ─── Create project package.json ─────────────────────────────────────────────

echo "[2/5] Creating package.json..."
cat > "$PROJECT_DIR/package.json" << PKGJSON
{
  "name": "$PROJECT_NAME",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch app/server.ts",
    "build": "bun build --compile app/server.ts --outfile $PROJECT_NAME",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "typescript": "^5.7.0"
  },
  "dependencies": {
    "@elysiajs/cron": "^1.4.1",
    "@radix-ui/react-accordion": "^1.2.12",
    "@radix-ui/react-alert-dialog": "^1.1.15",
    "@radix-ui/react-avatar": "^1.1.11",
    "@radix-ui/react-checkbox": "^1.3.3",
    "@radix-ui/react-collapsible": "^1.1.12",
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-dropdown-menu": "^2.1.16",
    "@radix-ui/react-hover-card": "^1.1.15",
    "@radix-ui/react-label": "^2.1.8",
    "@radix-ui/react-popover": "^1.1.15",
    "@radix-ui/react-progress": "^1.1.8",
    "@radix-ui/react-radio-group": "^1.3.8",
    "@radix-ui/react-scroll-area": "^1.2.10",
    "@radix-ui/react-select": "^2.2.6",
    "@radix-ui/react-separator": "^1.1.8",
    "@radix-ui/react-slot": "^1.2.4",
    "@radix-ui/react-switch": "^1.2.6",
    "@radix-ui/react-tabs": "^1.1.13",
    "@radix-ui/react-toggle": "^1.1.10",
    "@radix-ui/react-toggle-group": "^1.1.11",
    "@radix-ui/react-tooltip": "^1.2.8",
    "@tailwindcss/vite": "^4.2.1",
    "@tanstack/react-table": "^8.21.3",
    "@xstate/store": "^3.16.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "cmdk": "^1.1.1",
    "date-fns": "^4.1.0",
    "elysia": "^1.4.27",
    "embla-carousel": "^8.6.0",
    "embla-carousel-react": "^8.6.0",
    "input-otp": "^1.4.2",
    "jose": "^6.1.3",
    "lucide-react": "^0.577.0",
    "motion": "^12.35.0",
    "next-themes": "^0.4.6",
    "react": "^19.2.4",
    "react-day-picker": "^9.14.0",
    "react-dom": "^19.2.4",
    "react-use-measure": "^2.1.7",
    "recharts": "^3.7.0",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.5.0",
    "tailwindcss": "^4.2.1",
    "valibot": "^1.2.0"
  }
}
PKGJSON

# ─── Create tsconfig.json ───────────────────────────────────────────────────

echo "[3/5] Creating tsconfig.json..."
cat > "$PROJECT_DIR/tsconfig.json" << 'TSCONFIG'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["bun"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": ".",
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "paths": {
      "@platform/sync": ["./src/sync"],
      "@platform/sync/*": ["./src/sync/*"],
      "@platform/auth": ["./src/auth"],
      "@platform/auth/*": ["./src/auth/*"],
      "@platform/server": ["./src/frontend/server"],
      "@platform/server/*": ["./src/frontend/server/*"],
      "@platform/react": ["./src/frontend/client"],
      "@platform/react/*": ["./src/frontend/client/*"],
      "@platform/router": ["./src/frontend/router"],
      "@platform/router/*": ["./src/frontend/router/*"],
      "@/components/*": ["./src/components/*"],
      "@/lib/*": ["./src/lib/*"],
      "@/hooks/*": ["./src/hooks/*"],
      "@platform/schema": ["./src/schema"],
      "@platform/schema/*": ["./src/schema/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "app/**/*.ts", "app/**/*.tsx", "zero.config.ts", "zero/**/*.ts", "config/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
TSCONFIG

# ─── Create starter app files ───────────────────────────────────────────────

echo "[4/5] Creating starter app..."

# Zero config. Keep this file pure; platform doctor loads it without starting the server.
cat > "$PROJECT_DIR/zero.config.ts" << 'CONFIG'
import type { AppConfig } from './src/frontend';

const PORT = Number(process.env.PORT ?? 3000);
const hasEmail = Boolean(process.env.RESEND_API_KEY);

const config = {
  app: {
    name: process.env.APP_NAME ?? 'Zero App',
    publicUrl: process.env.APP_PUBLIC_URL ?? `http://localhost:${PORT}`,
    supportEmail: process.env.APP_SUPPORT_EMAIL,
  },
  db: { mode: process.env.DB_PATH ?? ':memory:' },
  tables: {
    // Define your tables here:
    // todos: {
    //   id: 'text primary key',
    //   title: 'text not null',
    //   done: 'integer default 0',
    //   created_at: 'integer not null',
    // },
  },
  email: hasEmail
    ? {
        from: process.env.EMAIL_FROM ?? 'Zero App <noreply@example.com>',
        replyTo: process.env.EMAIL_REPLY_TO,
        provider: 'resend',
        resend: {
          apiKey: process.env.RESEND_API_KEY,
        },
      }
    : false,
  auth: {
    registration: { mode: 'admin-only' },
    accountEmails: {
      adminCreatedUser: hasEmail,
      passwordReset: hasEmail,
      manualPasswordReset: process.env.AUTH_MANUAL_PASSWORD_RESET !== 'false',
      actionTokenTTL: process.env.AUTH_ACTION_TOKEN_TTL ?? '1h',
      requestCooldown: process.env.AUTH_ACCOUNT_EMAIL_COOLDOWN ?? '5m',
    },
  },
  stateSync: true,
  port: PORT,
} satisfies AppConfig;

export default config;
export { config };
CONFIG

# Server entry point
cat > "$PROJECT_DIR/app/server.ts" << 'SERVER'
import { createApp } from '../src/frontend';
import config from '../zero.config';

const app = await createApp(config);
const port = config.port ?? 3000;

app.listen(port);

console.log(`\n  Server running at http://localhost:${port}\n`);
SERVER

# Environment example
cat > "$PROJECT_DIR/.env.example" << 'ENV'
# Zero app runtime
PORT=3000
DB_PATH=./data/app.db
APP_NAME="Zero App"
APP_PUBLIC_URL=http://localhost:3000
APP_SUPPORT_EMAIL=support@example.com

# Auth token lifetimes
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=7d
AUTH_ACTION_TOKEN_TTL=1h
AUTH_ACCOUNT_EMAIL_COOLDOWN=5m
AUTH_MANUAL_PASSWORD_RESET=true

# Optional managed signing key.
# Leave blank to let Zero generate and store an ES256 keypair in the app DB.
AUTH_SIGNING_KEY=

# System email for auth/account lifecycle.
# Resend is the default provider when email is enabled.
EMAIL_FROM="Zero App <noreply@example.com>"
EMAIL_REPLY_TO=support@example.com
RESEND_API_KEY=
ENV

# Home page
cat > "$PROJECT_DIR/app/page.tsx" << 'PAGE'
export default function Home() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>It works.</h1>
      <p>Edit <code>app/page.tsx</code> to get started.</p>
    </div>
  );
}

export const meta = {
  title: 'Home',
};
PAGE

# Layout
cat > "$PROJECT_DIR/app/layout.tsx" << 'LAYOUT'
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
LAYOUT

# API health route
cat > "$PROJECT_DIR/app/(api)/route.ts" << 'ROUTE'
export const GET = () => new Response(
  JSON.stringify({ status: 'ok', uptime: process.uptime() }),
  { headers: { 'Content-Type': 'application/json' } }
);
ROUTE

# .gitignore
cat > "$PROJECT_DIR/.gitignore" << 'GITIGNORE'
node_modules/
dist/
_build/
*.db
*.db-wal
*.db-shm
.env
GITIGNORE

# ─── Install dependencies ───────────────────────────────────────────────────

if [[ "$SKIP_INSTALL" == true ]]; then
  echo "[5/5] Skipping install (--skip-install)"
else
  echo "[5/5] Installing dependencies..."
  cd "$PROJECT_DIR" && bun install
fi

# ─── Done ────────────────────────────────────────────────────────────────────

echo ""
echo "Done! Project created at $PROJECT_DIR"
echo ""
echo "  cd $PROJECT_DIR"
echo "  bun run dev"
echo ""
