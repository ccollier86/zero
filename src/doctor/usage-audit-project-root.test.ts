import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveConfig, type AppConfig } from '../frontend/server/types';
import { runPlatformDoctor } from './platform-doctor';
import { runUsageAudit } from './usage-audit';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const MISMATCH = 'usage.config.project_root_mismatch';

describe('Doctor usage audit project ownership', () => {
  test('Doctor anchors relative configured directories to its supplied project root', async () => {
    await withProject(async (projectRoot) => {
      await source(projectRoot, 'app/custom-ui/page.tsx', 'export const page = <button />;');
      await source(projectRoot, 'server/custom-routes/report.ts', 'console.log("fixture");');
      const report = runPlatformDoctor({
        ...config(), appDir: './app/custom-ui', serverRoutesDir: './server/custom-routes',
      }, { projectRoot, env: {} });

      expect(report.ok).toBe(true);
      expect(report.findings.filter(finding => finding.code.startsWith('usage.'))
        .map(finding => [finding.code, finding.path])).toEqual([
        ['usage.frontend.raw_button', 'app/custom-ui/page.tsx:1'],
        ['usage.backend.console', 'server/custom-routes/report.ts:1'],
      ]);
    });
  });

  test('direct audits refuse conflicting resolved roots before scanning, including explicit include roots', async () => {
    await withProject(async (base) => {
      const projectRoot = join(base, 'requested-app');
      const otherRoot = join(base, 'other-app');
      await source(projectRoot, 'app/page.tsx', 'export const requested = <button />;');
      await source(otherRoot, 'app/page.tsx', 'export const other = <input />;');
      const resolvedConfig = resolveConfig(config(otherRoot));

      for (const options of [undefined, {
        include: [join(projectRoot, 'app')],
        rules: { [MISMATCH]: 'off' as const },
        allow: [{ code: MISMATCH, path: 'projectRoot' }],
      }]) {
        const findings = runUsageAudit({ projectRoot, resolvedConfig, options });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ severity: 'error', code: MISMATCH, path: 'projectRoot' });
      }
      expect(runUsageAudit({ projectRoot, resolvedConfig, options: false })).toEqual([]);
    });
  });

  test('explicit config ownership is not replaced by a disagreeing Doctor root, even with the audit disabled', async () => {
    await withProject(async (base) => {
      const projectRoot = join(base, 'requested-app');
      const otherRoot = join(base, 'configured-app');
      await source(projectRoot, 'app/page.tsx', 'export const requested = <button />;');
      await source(otherRoot, 'app/page.tsx', 'export const other = <input />;');

      for (const usageAudit of [true, false]) {
        const report = runPlatformDoctor(config(otherRoot), { projectRoot, env: {}, usageAudit });
        expect(report.ok).toBe(false);
        expect(report.findings.filter(finding => finding.code.startsWith('usage.')))
          .toEqual([expect.objectContaining({ severity: 'error', code: MISMATCH })]);
      }
    });
  });

  test('existing symlink aliases and file URL config roots retain app-relative findings', async () => {
    await withProject(async (base) => {
      const projectRoot = join(base, 'app-project');
      const alias = join(base, 'app-alias');
      await source(projectRoot, 'app/page.tsx', 'export const page = <button />;');
      await symlink(projectRoot, alias, 'dir');

      for (const [requestedRoot, configRoot] of [[alias, projectRoot], [projectRoot, alias]] as const) {
        const resolvedConfig = resolveConfig({ ...config(), projectRoot: pathToFileURL(configRoot) });
        expect(runUsageAudit({ projectRoot: requestedRoot, resolvedConfig })
          .filter(finding => finding.code.startsWith('usage.'))
          .map(finding => [finding.code, finding.path])).toEqual([
          ['usage.frontend.raw_button', 'app/page.tsx:1'],
        ]);
      }
      expect(runPlatformDoctor(config(projectRoot), { projectRoot: alias, env: {} }).ok).toBe(true);
    });
  });

  test('root mismatch also refuses optional existing database inspection', async () => {
    await withProject(async (base) => {
      const requestedRoot = join(base, 'requested-app');
      const configuredRoot = join(base, 'configured-app');
      await mkdir(requestedRoot);
      const databasePath = await source(configuredRoot, 'data/app.db', 'not a SQLite database');
      const appConfig: AppConfig = { ...config(configuredRoot),
        db: { mode: 'file', path: databasePath },
        systemDb: { mode: 'file', path: join(configuredRoot, 'data/system.db') } };
      const admitted = runPlatformDoctor(appConfig, { projectRoot: configuredRoot, env: {}, usageAudit: false });
      expect(admitted.findings.some(finding => finding.code === 'database.system.file_inspection_unavailable')).toBe(true);

      const denied = runPlatformDoctor(appConfig, { projectRoot: requestedRoot, env: {}, usageAudit: false });
      expect(denied.ok).toBe(false);
      expect(denied.findings.some(finding => finding.code === MISMATCH)).toBe(true);
      expect(denied.findings.some(finding => finding.code === 'database.system.file_inspection_unavailable')).toBe(false);
    });
  });

  test('intentionally external absolute app, server, and include roots remain admitted', async () => {
    await withProject(async (base) => {
      const projectRoot = join(base, 'app-project');
      const externalRoot = join(base, 'shared-source');
      await mkdir(projectRoot);
      const externalApp = await source(externalRoot, 'ui/page.tsx', ['export const title = "shared";', 'export const page = <button />;']);
      const externalServer = await source(externalRoot, 'routes/report.ts', ['export const title = "shared";', 'console.log("fixture");']);
      const resolvedConfig = resolveConfig({ ...config(projectRoot),
        appDir: dirname(externalApp), serverRoutesDir: dirname(externalServer) });
      const findings = runUsageAudit({ projectRoot, resolvedConfig, options: { maxFileLines: 1 } });
      expect(findings.filter(finding => finding.code === 'usage.structure.large_file')
        .map(finding => finding.path)).toEqual([
        `${relative(projectRoot, externalApp)}:1`, `${relative(projectRoot, externalServer)}:1`,
      ]);
      expect(findings.some(finding => finding.code === MISMATCH)).toBe(false);

      const included = runUsageAudit({ projectRoot, resolvedConfig,
        options: { include: [externalServer], maxFileLines: 1 } });
      expect(included.filter(finding => finding.code === 'usage.structure.large_file')
        .map(finding => finding.path)).toEqual([`${relative(projectRoot, externalServer)}:1`]);
    });
  });

  test('an explicit config origin alone does not opt Doctor into filesystem scanning', async () => {
    await withProject(async (projectRoot) => {
      await source(projectRoot, 'app/page.tsx', 'export const page = <button />;');
      const report = runPlatformDoctor(config(projectRoot), { env: {} });
      expect(report.findings.some(finding => finding.code.startsWith('usage.'))).toBe(false);
    });
  });
});

function config(projectRoot?: string): AppConfig {
  return { projectRoot, db: { mode: ':memory:' }, tables: { todos: { id: 'text primary key' } }, auth: false };
}

async function withProject(run: (root: string) => Promise<void>): Promise<void> {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'doctor-usage-root-'));
  try { await run(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

async function source(root: string, path: string, content: string | string[]): Promise<string> {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await Bun.write(target, typeof content === 'string' ? content : content.join('\n'));
  return target;
}
