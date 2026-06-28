#!/usr/bin/env bun
/**
 * migrations/run.ts — Standalone CLI migration runner.
 *
 * Usage:
 *   bun run src/migrations/run.ts                    # apply all pending
 *   bun run src/migrations/run.ts --status           # show migration status
 *   bun run src/migrations/run.ts --to 003           # apply up to version 003
 *   bun run src/migrations/run.ts --down-to 002      # roll back to version 002
 *   bun run src/migrations/run.ts --doctor --schema ./app/lib/schemas.ts
 *   bun run src/migrations/run.ts --plan --schema ./app/lib/schemas.ts
 *   bun run src/migrations/run.ts --checkpoint       # just WAL checkpoint, no migrations
 *   bun run src/migrations/run.ts --db ./data/app.db # custom db path
 *
 * Exit codes:
 *   0 — success (or nothing to do)
 *   1 — migration failed
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectDatabaseSchema } from './schema-inspector';
import { createMigrationPlan, renderMigrationPlan } from './migration-planner';
import { loadDeclaredTables } from './schema-loader';
import { runMigrationDoctor } from './migration-doctor';
import { Migrator } from './migrator';
import { migrations } from './index';

// ─── Parse CLI args ──────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
}

const showStatus = args.includes('--status');
const checkpointOnly = args.includes('--checkpoint');
const doctor = args.includes('--doctor');
const plan = args.includes('--plan');
const strict = args.includes('--strict');
const allowDestructive = args.includes('--allow-destructive');
const allowDestructiveDown = args.includes('--allow-destructive-down');
const createBackups = !args.includes('--no-backup');
const writePlan = args.includes('--write');
const toVersion = getArg('--to');
const downToVersion = getArg('--down-to');
const dbPath = getArg('--db') ?? process.env.DATABASE_PATH ?? './data/platform.db';
const schemaPath = getArg('--schema');
const backupDir = getArg('--backup-dir') ?? './data/backups';
const planVersion = getArg('--version') ?? nextDraftVersion();
const planDescription = getArg('--name') ?? 'schema drift plan';
const planOutDir = getArg('--out') ?? './src/migrations/definitions';

// ─── Run ─────────────────────────────────────────────────────────────────

console.log(`[migrator] Database: ${dbPath}`);
console.log(`[migrator] ${migrations.length} migration(s) registered`);

const migrator = new Migrator({
  dbPath,
  migrations,
  allowDestructive,
  allowDestructiveDown,
  createBackups,
  backupDir,
  log: console.log,
});

try {
  if (checkpointOnly) {
    console.log('[migrator] Running WAL checkpoint only...');
    migrator.checkpoint();
    console.log('[migrator] Done.');
  } else if (showStatus) {
    const statuses = migrator.status();
    console.log('');
    console.log('  Version  │ Status       │ Safety       │ Down │ Checksum │ Description');
    console.log('  ─────────┼──────────────┼──────────────┼──────┼──────────┼──────────────────────────────────');
    for (const s of statuses) {
      const status = s.applied ? `applied${s.durationMs != null ? ` ${s.durationMs}ms` : ''}` : (s.lastStatus ?? 'pending');
      const checksum = s.checksumMatches === null ? '-' : s.checksumMatches ? 'ok' : 'changed';
      console.log(
        `  ${s.version.padEnd(8)} │ ${status.padEnd(12)} │ ${s.safety.padEnd(12)} │ ${s.hasDown ? 'yes ' : 'no  '} │ ${checksum.padEnd(8)} │ ${s.description}`
      );
    }
    console.log('');
  } else if (doctor) {
    const declaredTables = schemaPath ? await loadDeclaredTables(schemaPath) : undefined;
    const report = runMigrationDoctor({
      db: migrator.database,
      migrations,
      declaredTables,
      strict,
    });

    printDoctorReport(report);
    if (!report.ok) process.exitCode = 1;
  } else if (plan) {
    if (!schemaPath) {
      throw new Error('[migrator] --plan requires --schema <module>');
    }

    const declaredTables = await loadDeclaredTables(schemaPath);
    const actual = inspectDatabaseSchema(migrator.database, { includeInternal: false });
    const migrationPlan = createMigrationPlan(declaredTables, actual);
    printPlan(migrationPlan);

    if (writePlan) {
      mkdirSync(planOutDir, { recursive: true });
      const outPath = join(planOutDir, `${planVersion}_${slugify(planDescription)}.ts`);
      writeFileSync(outPath, renderMigrationPlan({
        version: planVersion,
        description: planDescription,
        plan: migrationPlan,
      }));
      console.log(`[migrator] Draft migration written: ${outPath}`);
      console.log('[migrator] Review it, then add it to src/migrations/index.ts.');
    }
  } else if (downToVersion !== null) {
    migrator.rollback(downToVersion);
  } else {
    const applied = migrator.run(toVersion ?? undefined);
    if (applied.length === 0) {
      console.log('[migrator] Database is up to date.');
    }
  }
} catch (err) {
  console.error('[migrator] Fatal error:', err);
  process.exit(1);
} finally {
  migrator.dispose();
}

function printDoctorReport(report: ReturnType<typeof runMigrationDoctor>): void {
  console.log('');
  console.log('Migration Doctor');
  console.log('────────────────');

  if (report.findings.length === 0 && report.schemaIssues.length === 0) {
    console.log('✓ No migration issues found.');
    return;
  }

  for (const finding of report.findings) {
    console.log(`${mark(finding.severity)} ${finding.code}: ${finding.message}`);
  }
  for (const issue of report.schemaIssues) {
    console.log(`${mark(issue.severity)} ${issue.kind}: ${issue.message}`);
  }

  console.log(report.ok ? '\nDoctor completed with warnings.' : '\nDoctor failed.');
}

function printPlan(migrationPlan: ReturnType<typeof createMigrationPlan>): void {
  console.log('');
  console.log(`Migration Plan (${migrationPlan.safety}${migrationPlan.needsManualReview ? ', review required' : ''})`);
  console.log('────────────────');

  for (const issue of migrationPlan.issues) {
    console.log(`${mark(issue.severity)} ${issue.kind}: ${issue.message}`);
  }

  if (migrationPlan.statements.length === 0) {
    console.log('No draft SQL statements were generated.');
    return;
  }

  console.log('');
  for (const statement of migrationPlan.statements) {
    console.log(`-- ${statement.safety}: ${statement.reason}`);
    console.log(`${statement.sql};`);
  }
}

function mark(severity: 'info' | 'warning' | 'error'): string {
  if (severity === 'error') return '✗';
  if (severity === 'warning') return '!';
  return 'i';
}

function nextDraftVersion(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'migration';
}
