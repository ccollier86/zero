/**
 * usage-audit.test.ts
 *
 * Verifies app-owned source scanning for Zero API/component usage warnings.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, test } from 'bun:test';

import { resolveConfig, type AppConfig } from '../frontend/server/types';
import { runPlatformDoctor } from './platform-doctor';
import { runUsageAudit } from './usage-audit';

describe('runUsageAudit', () => {
  test('excludes nested test/generated source and applies recursive allow entries', async () => {
    await withTempProject(async (projectRoot) => {
      await writeSource(projectRoot, 'app/deep/deeper/widget.test.tsx', 'export const widget = <button />;');
      await writeSource(projectRoot, 'app/deep/generated/deeper/widget.tsx', 'export const widget = <button />;');
      await writeSource(projectRoot, 'app/allowed/deep/page.tsx', 'export const page = <button />;');
      await writeSource(projectRoot, 'app/ordinary/deep/page.tsx', 'export const page = <button />;');
      const findings = runUsageAudit({ projectRoot, resolvedConfig: resolveConfig(baseConfig()),
        options: { allow: [{ code: 'usage.frontend.raw_button', path: 'app/allowed/**' }] } });
      expect(findings.filter(finding => finding.code === 'usage.frontend.raw_button').map(finding => finding.path))
        .toEqual(['app/ordinary/deep/page.tsx:1']);
    });
  });

  test('reports frontend raw controls, custom UI, imports, and large files', async () => {
    await withTempProject(async (projectRoot) => {
      await writeSource(projectRoot, 'app/page.tsx', [
        "import { Bell } from 'lucide-react';",
        "import { toast } from 'sonner';",
        "import * as Dialog from '@radix-ui/react-dialog';",
        "import { Legacy } from '@platform/ui';",
        "import { Internal } from '@zero/framework/src/components/ui/internal';",
        "import { Sidebar } from '@zero/framework/src/components/animate-ui/components/radix/sidebar';",
        'export default function Page() {',
        '  return <main>',
        '    <button>Save</button>',
        '    <input name="title" />',
        '    <textarea />',
        '    <select><option>One</option></select>',
        '    <table><tbody /></table>',
        '    <dialog />',
        '    {fetch("/api/data?table=todos")}',
        '    {new WebSocket("/sync")}',
        '    {localStorage.getItem("zero_access_token")}',
        '  </main>;',
        '}',
      ]);

      const findings = runUsageAudit({
        projectRoot,
        resolvedConfig: resolveConfig(baseConfig()),
        options: { maxFileLines: 5 },
      });

      expect(codes(findings)).toEqual(expect.arrayContaining([
        'usage.structure.large_file',
        'usage.frontend.raw_button',
        'usage.frontend.raw_input',
        'usage.frontend.raw_textarea',
        'usage.frontend.raw_select',
        'usage.frontend.raw_table',
        'usage.frontend.custom_modal',
        'usage.frontend.custom_toast',
        'usage.frontend.direct_lucide',
        'usage.frontend.internal_animate_ui',
        'usage.frontend.custom_data_fetch',
        'usage.frontend.custom_sync_socket',
        'usage.frontend.local_auth_storage',
        'usage.import.legacy_platform_alias',
        'usage.import.framework_internal',
      ]));
      expect(findings.find((finding) => finding.code === 'usage.frontend.raw_button')?.path)
        .toBe('app/page.tsx:9');
      expect(findings.find((finding) => finding.code === 'usage.structure.large_file')?.message)
        .toContain('above the 5-line responsibility threshold');
    });
  });

  test('reports backend service bypasses and console logging', async () => {
    await withTempProject(async (projectRoot) => {
      await writeSource(projectRoot, 'server/routes/report.ts', [
        "import { Database } from 'bun:sqlite';",
        "import { Resend } from 'resend';",
        "import { generateText } from 'ai';",
        "import { OpenAIProvider } from '@ai-sdk/openai';",
        "import { createIndex } from '@zvec/zvec';",
        "import { jwtVerify } from 'jose';",
        'export async function run() {',
        '  console.log("started");',
        '  return new Database(":memory:");',
        '}',
      ]);

      const findings = runUsageAudit({
        projectRoot,
        resolvedConfig: resolveConfig(baseConfig()),
      });

      expect(codes(findings)).toEqual(expect.arrayContaining([
        'usage.backend.direct_sqlite',
        'usage.backend.direct_resend',
        'usage.backend.direct_ai_sdk',
        'usage.backend.direct_zvec',
        'usage.backend.direct_jwt',
        'usage.backend.console',
      ]));
      expect(findings.find((finding) => finding.code === 'usage.backend.console')?.path)
        .toBe('server/routes/report.ts:8');
    });
  });

  test('respects disabled audit, excludes, rule overrides, and allow entries', async () => {
    await withTempProject(async (projectRoot) => {
      await writeSource(projectRoot, 'app/page.tsx', 'export default function Page() { return <button>Save</button>; }\n');
      await writeSource(projectRoot, 'app/ignored/page.tsx', 'export default function Page() { return <input />; }\n');
      await writeSource(projectRoot, 'app/allowed/page.tsx', 'export default function Page() { return <input />; }\n');

      const resolvedConfig = resolveConfig(baseConfig());

      expect(runUsageAudit({
        projectRoot,
        resolvedConfig,
        options: false,
      })).toHaveLength(0);

      const findings = runUsageAudit({
        projectRoot,
        resolvedConfig,
        options: {
          exclude: ['app/ignored/**'],
          rules: { 'usage.frontend.raw_button': 'off' },
          allow: [{ code: 'usage.frontend.raw_input', path: 'app/allowed/page.tsx' }],
        },
      });

      expect(codes(findings)).not.toContain('usage.frontend.raw_button');
      expect(codes(findings)).not.toContain('usage.frontend.raw_input');
    });
  });

  test('reports missing root providers for Zero hooks, UI, and toasts', async () => {
    await withTempProject(async (projectRoot) => {
      await writeSource(projectRoot, 'app/page.tsx', [
        "import { Button } from '@zero/framework/components/ui/button';",
        "import { toast } from '@zero/framework/components/ui/sonner';",
        "import { useCollection } from '@zero/framework/react/hooks';",
        'export default function Page() {',
        '  useCollection("todos");',
        '  toast.success("Saved");',
        '  return <Button>Save</Button>;',
        '}',
      ]);

      const findings = runUsageAudit({
        projectRoot,
        resolvedConfig: resolveConfig(baseConfig()),
      });

      expect(codes(findings)).toEqual(expect.arrayContaining([
        'usage.frontend.app_provider_missing',
        'usage.frontend.theme_provider_missing',
        'usage.frontend.toaster_missing',
      ]));
    });
  });

  test('does not report root provider warnings when root wiring is present', async () => {
    await withTempProject(async (projectRoot) => {
      await writeSource(projectRoot, 'app/layout.tsx', [
        "import { ThemeProvider } from '@zero/framework/components/ui/theme-provider';",
        "import { Toaster } from '@zero/framework/components/ui/sonner';",
        "import { AppProvider } from '@zero/framework/react/app-provider';",
        'export default function Layout({ children }: { children: React.ReactNode }) {',
        '  return <AppProvider><ThemeProvider><Toaster />{children}</ThemeProvider></AppProvider>;',
        '}',
      ]);
      await writeSource(projectRoot, 'app/page.tsx', [
        "import { Button } from '@zero/framework/components/ui/button';",
        "import { toast } from '@zero/framework/components/ui/sonner';",
        "import { useCollection } from '@zero/framework/react/hooks';",
        'export default function Page() {',
        '  useCollection("todos");',
        '  toast.success("Saved");',
        '  return <Button>Save</Button>;',
        '}',
      ]);

      const findings = runUsageAudit({
        projectRoot,
        resolvedConfig: resolveConfig(baseConfig()),
      });

      expect(codes(findings)).not.toContain('usage.frontend.app_provider_missing');
      expect(codes(findings)).not.toContain('usage.frontend.theme_provider_missing');
      expect(codes(findings)).not.toContain('usage.frontend.toaster_missing');
    });
  });

  test('integrates with runPlatformDoctor when a project root is provided', async () => {
    await withTempProject(async (projectRoot) => {
      await writeSource(projectRoot, 'app/page.tsx', 'export default function Page() { return <button>Save</button>; }\n');

      const relaxed = runPlatformDoctor(baseConfig(), { env: {}, projectRoot });
      expect(relaxed.ok).toBe(true);
      expect(codes(relaxed.findings)).toContain('usage.frontend.raw_button');

      const strict = runPlatformDoctor(baseConfig(), { env: {}, projectRoot, strict: true });
      expect(strict.ok).toBe(false);
    });
  });
});

function baseConfig(): AppConfig {
  return {
    db: { mode: ':memory:' },
    tables: {
      todos: { id: 'text primary key', title: 'text not null' },
    },
    auth: false,
    appDir: './app',
  };
}

function codes(findings: Array<{ code: string }>): string[] {
  return findings.map((finding) => finding.code);
}

async function withTempProject(run: (projectRoot: string) => Promise<void>): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'zero-usage-audit-test-'));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

async function writeSource(
  projectRoot: string,
  relativePath: string,
  source: string | string[]
): Promise<void> {
  const absolutePath = join(projectRoot, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Array.isArray(source) ? `${source.join('\n')}\n` : source);
}
