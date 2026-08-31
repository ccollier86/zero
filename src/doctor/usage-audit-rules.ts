/**
 * usage-audit-rules.ts
 *
 * Owns static rule definitions and root-wiring signal helpers for Doctor's
 * source usage audit.
 */

import {
  appOwnedSource,
  backendFile,
  browserSourceFile,
  frontendFile,
} from './usage-audit-scanner';
import type { UsageRule } from './usage-audit-types';

const FRONTEND_RAW_CONTROL_DOCS = './docs/frontend/component-inventory.md#base-primitives';
const BACKEND_SURFACE_DOCS = './docs/framework-developer-surface.md';

export const USAGE_RULES: UsageRule[] = [
  {
    code: 'usage.frontend.raw_button',
    docs: FRONTEND_RAW_CONTROL_DOCS,
    hint: 'Import Button from @zero/framework/components/ui/button unless this native button is deliberate.',
    message: () => 'Native <button> used in app UI where Zero Button is usually preferred.',
    matches: [/<button\b/],
    appliesTo: frontendFile,
  },
  {
    code: 'usage.frontend.raw_input',
    docs: FRONTEND_RAW_CONTROL_DOCS,
    hint: 'Use Zero Input, PasswordInput, or the form renderer so fields keep platform styling and behavior.',
    message: () => 'Native <input> used in app UI where Zero Input is usually preferred.',
    matches: [/<input\b/],
    appliesTo: frontendFile,
  },
  {
    code: 'usage.frontend.raw_textarea',
    docs: FRONTEND_RAW_CONTROL_DOCS,
    hint: 'Use Zero Textarea or the form renderer so multiline fields stay themed.',
    message: () => 'Native <textarea> used in app UI where Zero Textarea is usually preferred.',
    matches: [/<textarea\b/],
    appliesTo: frontendFile,
  },
  {
    code: 'usage.frontend.raw_select',
    docs: FRONTEND_RAW_CONTROL_DOCS,
    hint: 'Use Zero Select so menus support platform styling, icons, and interaction patterns.',
    message: () => 'Native <select> used in app UI where Zero Select is usually preferred.',
    matches: [/<select\b/],
    appliesTo: frontendFile,
  },
  {
    code: 'usage.frontend.raw_table',
    docs: './docs/frontend/data-table.md',
    hint: 'Use DataTableView, DataTable, or MasterDetailView for app data tables unless this is a tiny static table.',
    message: () => 'Native <table> used in app UI where Zero data components may be a better fit.',
    matches: [/<table\b/],
    appliesTo: frontendFile,
  },
  {
    code: 'usage.frontend.custom_modal',
    docs: './docs/frontend/component-inventory.md#overlays-and-feedback',
    hint: 'Use Zero modal manager or Zero dialog components so modal behavior, animations, and close handling stay consistent.',
    message: () => 'Custom modal/dialog infrastructure detected in app UI.',
    matches: [/from\s+['"]@radix-ui\/react-dialog['"]/, /<dialog\b/],
    appliesTo: browserSourceFile,
  },
  {
    code: 'usage.frontend.custom_toast',
    docs: './docs/frontend/component-inventory.md#overlays-and-feedback',
    hint: 'Use Zero-themed toast exports and mount the Zero Toaster at the app root.',
    message: () => 'Direct sonner usage detected where the Zero toast surface is preferred.',
    matches: [/from\s+['"]sonner['"]/, /from\s+['"]sonner\/.*['"]/],
    appliesTo: browserSourceFile,
  },
  {
    code: 'usage.frontend.direct_lucide',
    docs: './docs/frontend/icons.md',
    hint: 'Import icons from @zero/framework/icons so animated icon behavior is available consistently.',
    message: () => 'Direct lucide-react import detected in app UI.',
    matches: [/from\s+['"]lucide-react['"]/],
    appliesTo: browserSourceFile,
  },
  {
    code: 'usage.frontend.internal_animate_ui',
    docs: './docs/frontend/component-inventory.md',
    hint: 'Use promoted Zero component exports instead of importing internal Animate UI files directly.',
    message: () => 'Internal Animate UI import detected in app code.',
    matches: [
      /from\s+['"][^'"]*components\/animate-ui\//,
      /from\s+['"]@zero\/framework\/src\/components\/animate-ui\//,
    ],
    appliesTo: appOwnedSource,
  },
  {
    code: 'usage.frontend.custom_data_fetch',
    docs: './docs/frontend/sdk.md',
    hint: 'Use Zero data hooks, resource clients, or DataTable source contracts instead of hand-fetching /api/data.',
    message: () => 'Direct /api/data fetch detected in React app code.',
    matches: [/fetch\(\s*['"`]\/api\/data\b/],
    appliesTo: browserSourceFile,
  },
  {
    code: 'usage.frontend.custom_sync_socket',
    docs: './docs/frontend/sdk.md',
    hint: 'Use AppProvider, the sync client, and collection hooks instead of opening the sync WebSocket manually.',
    message: () => 'Direct sync WebSocket usage detected in React app code.',
    matches: [/new\s+WebSocket\(\s*['"`](?:wss?:\/\/[^'"`]+)?\/sync\b/],
    appliesTo: browserSourceFile,
  },
  {
    code: 'usage.frontend.local_auth_storage',
    docs: './docs/frontend/sdk.md',
    hint: 'Use Zero AuthClient/AppProvider for token lifecycle instead of direct localStorage/sessionStorage auth handling.',
    message: () => 'Direct browser storage auth/token handling detected.',
    matches: [
      /(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\([^)]*(?:auth|session|token|zero)/i,
    ],
    appliesTo: browserSourceFile,
  },
  {
    code: 'usage.import.legacy_platform_alias',
    docs: './docs/framework-developer-surface.md#canonical-imports',
    hint: 'Use @zero/framework/* public package imports in package-mode apps.',
    message: () => 'Legacy @platform/* import detected.',
    matches: [/from\s+['"]@platform\//, /import\(\s*['"]@platform\//],
    appliesTo: appOwnedSource,
  },
  {
    code: 'usage.import.framework_internal',
    docs: './docs/framework-developer-surface.md#canonical-imports',
    hint: 'Use public @zero/framework exports instead of reaching into framework source files.',
    message: () => 'Internal Zero framework source import detected.',
    matches: [
      /from\s+['"]@zero\/framework\/src\//,
      /import\(\s*['"]@zero\/framework\/src\//,
      /['"][^'"]*node_modules\/@zero\/framework\/src\//,
      /['"][^'"]*zero-platform\/src\//,
    ],
    appliesTo: appOwnedSource,
  },
  {
    code: 'usage.backend.direct_sqlite',
    docs: BACKEND_SURFACE_DOCS,
    hint: 'Use zero.db, zero.sql, resources, or the platform persistence service instead of direct SQLite access.',
    message: () => 'Direct SQLite usage detected in app-owned backend code.',
    matches: [/from\s+['"]bun:sqlite['"]/, /new\s+Database\(/],
    appliesTo: backendFile,
  },
  {
    code: 'usage.backend.direct_resend',
    docs: './docs/auth/README.md',
    hint: 'Use zero.email or the platform email provider boundary so system email remains swappable.',
    message: () => 'Direct email provider usage detected in app-owned backend code.',
    matches: [/from\s+['"]resend['"]/, /from\s+['"]nodemailer['"]/],
    appliesTo: backendFile,
  },
  {
    code: 'usage.backend.direct_ai_sdk',
    docs: './docs/ai.md',
    hint: 'Use zero.ai so provider readiness, aliases, and app configuration stay centralized.',
    message: () => 'Direct AI SDK usage detected in app-owned backend code.',
    matches: [/from\s+['"]ai['"]/, /from\s+['"]@ai-sdk\//],
    appliesTo: backendFile,
  },
  {
    code: 'usage.backend.direct_zvec',
    docs: './docs/vector.md',
    hint: 'Use zero.vector so vector indexes follow platform storage, metadata, and readiness contracts.',
    message: () => 'Direct zvec usage detected in app-owned backend code.',
    matches: [/from\s+['"]@zvec\/zvec['"]/],
    appliesTo: backendFile,
  },
  {
    code: 'usage.backend.direct_jwt',
    docs: './docs/auth/token-service.md',
    hint: 'Use Zero auth/token services for signing, verifying, revocation, and action-token behavior.',
    message: () => 'Direct JWT/token library usage detected in app-owned backend code.',
    matches: [/from\s+['"]jsonwebtoken['"]/, /from\s+['"]jose['"]/],
    appliesTo: backendFile,
  },
  {
    code: 'usage.backend.console',
    docs: './docs/observability.md',
    hint: 'Route backend logs, warnings, errors, and lifecycle events through Zero observability.',
    message: () => 'Direct console logging detected in app-owned backend code.',
    matches: [/console\.(?:log|warn|error)\(/],
    appliesTo: backendFile,
  },
];

export function usesZeroClientHooks(source: string): boolean {
  return /@zero\/framework\/react\/hooks/.test(source) ||
    /\buse(?:Auth|Collection|DataPage|LazyCollection|Resource|ResourceList|ResourceMutation|Storage|Workflow|Notification|StateSync)\b/.test(source);
}

export function usesZeroComponents(source: string): boolean {
  return /@zero\/framework\/components\//.test(source) ||
    /<(?:Button|Input|AppShell|DataTable|DataTableView|MasterDetailView|KanbanBoard)\b/.test(source);
}

export function usesZeroToast(source: string): boolean {
  return /@zero\/framework\/components\/ui\/sonner/.test(source) ||
    /\btoast\.(?:success|error|warning|info|message)\(/.test(source);
}

export function hasRootSymbol(source: string, symbol: string): boolean {
  return new RegExp(`<${symbol}\\b|\\b${symbol}\\b`).test(source);
}
