#!/usr/bin/env bun
/**
 * Standalone migration CLI.
 *
 * Managed migrations target Zero's separated system database. Application
 * schema doctor/plan commands are explicit inspection operations and never
 * create platform migration state in app or Fabric databases.
 */

import { Database } from 'bun:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveMigrationCliTarget,
  type MigrationCliTarget,
} from './migration-cli-target';
import { createMigrationPlan, renderMigrationPlan } from './migration-planner';
import {
  runMigrationDoctor,
  runSchemaDoctor,
  type DoctorReport,
} from './migration-doctor';
import { Migrator } from './migrator';
import { inspectDatabaseSchema } from './schema-inspector';
import { loadDeclaredTables } from './schema-loader';
import { migrations } from './index';

interface CliOptions {
  showStatus: boolean;
  checkpointOnly: boolean;
  doctor: boolean;
  plan: boolean;
  strict: boolean;
  allowDestructive: boolean;
  allowDestructiveDown: boolean;
  createBackups: boolean;
  writePlan: boolean;
  help: boolean;
  toVersion?: string;
  downToVersion?: string;
  explicitDbPath?: string;
  schemaPath?: string;
  backupDir: string;
  planVersion: string;
  planDescription: string;
  planOutDir: string;
}

try {
  await run(process.argv.slice(2));
} catch (error) {
  console.error('[migrator] Fatal error:', error);
  process.exitCode = 1;
}

async function run(args: readonly string[]): Promise<void> {
  const options = parseOptions(args);
  if (options.help) {
    printUsage();
    return;
  }
  validateOptions(options);

  const schemaInspection = options.plan || (options.doctor && options.schemaPath !== undefined);
  const target = resolveMigrationCliTarget({
    explicitDbPath: options.explicitDbPath,
    systemDbPath: process.env.SYSTEM_DB_PATH,
    schemaInspection,
  });
  printTarget(target);

  if (schemaInspection) {
    await runSchemaInspection(options, target.path);
    return;
  }

  runSystemMigrationCommand(options, target.path);
}

function runSystemMigrationCommand(options: CliOptions, dbPath: string): void {
  console.log(`[migrator] ${migrations.length} system migration(s) registered`);
  const migrator = new Migrator({
    dbPath,
    migrations,
    allowDestructive: options.allowDestructive,
    allowDestructiveDown: options.allowDestructiveDown,
    createBackups: options.createBackups,
    backupDir: options.backupDir,
    log: console.log,
  });

  try {
    if (options.checkpointOnly) {
      console.log('[migrator] Running system database WAL checkpoint only...');
      migrator.checkpoint();
      console.log('[migrator] Done.');
      return;
    }
    if (options.showStatus) {
      printStatus(migrator.status());
      return;
    }
    if (options.doctor) {
      const report = runMigrationDoctor({
        db: migrator.database,
        migrations,
        strict: options.strict,
      });
      printDoctorReport(report, 'System Migration Doctor');
      if (!report.ok) process.exitCode = 1;
      return;
    }
    if (options.downToVersion !== undefined) {
      migrator.rollback(options.downToVersion);
      return;
    }

    const applied = migrator.run(options.toVersion);
    if (applied.length === 0) console.log('[migrator] System database is up to date.');
  } finally {
    migrator.dispose();
  }
}

async function runSchemaInspection(options: CliOptions, dbPath: string): Promise<void> {
  const schemaPath = options.schemaPath!;
  const declaredTables = await loadDeclaredTables(schemaPath);
  // Schema inspection is a read-only boundary. Opening readonly also makes a
  // mistyped/nonexistent app path fail instead of silently creating a new DB.
  const database = new Database(dbPath, { readonly: true, strict: true });

  try {
    if (options.doctor) {
      const report = runSchemaDoctor({
        db: database,
        declaredTables,
        strict: options.strict,
      });
      printDoctorReport(report, 'Application Schema Doctor');
      if (!report.ok) process.exitCode = 1;
      return;
    }

    const actual = inspectDatabaseSchema(database, { includeInternal: false });
    const migrationPlan = createMigrationPlan(declaredTables, actual);
    printPlan(migrationPlan);

    if (options.writePlan) {
      mkdirSync(options.planOutDir, { recursive: true });
      const outPath = join(
        options.planOutDir,
        `${options.planVersion}_${slugify(options.planDescription)}.ts`,
      );
      writeFileSync(outPath, renderMigrationPlan({
        version: options.planVersion,
        description: options.planDescription,
        plan: migrationPlan,
      }));
      console.log(`[migrator] Draft migration written: ${outPath}`);
      console.log('[migrator] Review it and route it through the app/Fabric provisioning path.');
    }
  } finally {
    database.close();
  }
}

function parseOptions(args: readonly string[]): CliOptions {
  return {
    showStatus: args.includes('--status'),
    checkpointOnly: args.includes('--checkpoint'),
    doctor: args.includes('--doctor'),
    plan: args.includes('--plan'),
    strict: args.includes('--strict'),
    allowDestructive: args.includes('--allow-destructive'),
    allowDestructiveDown: args.includes('--allow-destructive-down'),
    createBackups: !args.includes('--no-backup'),
    writePlan: args.includes('--write'),
    help: args.includes('--help') || args.includes('-h'),
    toVersion: getArg(args, '--to'),
    downToVersion: getArg(args, '--down-to'),
    explicitDbPath: getArg(args, '--db'),
    schemaPath: getArg(args, '--schema'),
    backupDir: getArg(args, '--backup-dir') ?? './data/backups',
    planVersion: getArg(args, '--version') ?? nextDraftVersion(),
    planDescription: getArg(args, '--name') ?? 'schema drift plan',
    planOutDir: getArg(args, '--out') ?? './src/migrations/definitions',
  };
}

function validateOptions(options: CliOptions): void {
  const modes = [
    options.showStatus,
    options.checkpointOnly,
    options.doctor,
    options.plan,
    options.downToVersion !== undefined,
  ].filter(Boolean).length;
  if (modes > 1) {
    throw new Error(
      '[migrator] Choose one of --status, --checkpoint, --doctor, --plan, or --down-to.',
    );
  }
  if (options.toVersion !== undefined && options.downToVersion !== undefined) {
    throw new Error('[migrator] --to and --down-to cannot be combined.');
  }
  if (options.toVersion !== undefined && modes > 0) {
    throw new Error('[migrator] --to is supported only by the default system migration command.');
  }
  if (options.plan && !options.schemaPath) {
    throw new Error('[migrator] --plan requires --schema <module>.');
  }
  if (options.schemaPath && !options.plan && !options.doctor) {
    throw new Error('[migrator] --schema is supported only with --plan or --doctor.');
  }
  if (options.writePlan && !options.plan) {
    throw new Error('[migrator] --write is supported only with --plan.');
  }
}

function getArg(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`[migrator] ${flag} requires a value.`);
  }
  return value;
}

function printTarget(target: MigrationCliTarget): void {
  const label = target.plane === 'system'
    ? 'System database'
    : 'Application schema database';
  console.log(`[migrator] ${label}: ${target.path} (${target.source})`);
}

function printStatus(statuses: ReturnType<Migrator['status']>): void {
  console.log('');
  console.log('  Version  │ Status          │ Safety       │ Down │ Checksum │ Description');
  console.log('  ─────────┼─────────────────┼──────────────┼──────┼──────────┼──────────────────────────────────');
  for (const statusRow of statuses) {
    const status = statusRow.lastStatus === 'failed'
      ? `${statusRow.applied ? 'applied' : 'pending'}+failed`
      : statusRow.applied
        ? `applied${statusRow.durationMs != null ? ` ${statusRow.durationMs}ms` : ''}`
        : (statusRow.lastStatus ?? 'pending');
    const checksum = statusRow.checksumMatches === null
      ? '-'
      : statusRow.checksumMatches
        ? 'ok'
        : 'changed';
    console.log(
      `  ${statusRow.version.padEnd(8)} │ ${status.padEnd(15)} │ ` +
      `${statusRow.safety.padEnd(12)} │ ${statusRow.hasDown ? 'yes ' : 'no  '} │ ` +
      `${checksum.padEnd(8)} │ ${statusRow.description}`,
    );
  }
  console.log('');
}

function printDoctorReport(report: DoctorReport, title: string): void {
  console.log('');
  console.log(title);
  console.log('─'.repeat(title.length));

  if (report.findings.length === 0 && report.schemaIssues.length === 0) {
    console.log('✓ No issues found.');
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
  console.log(
    `Application Schema Plan (${migrationPlan.safety}` +
    `${migrationPlan.needsManualReview ? ', review required' : ''})`,
  );
  console.log('───────────────────────');

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

function printUsage(): void {
  console.log('Usage:');
  console.log('  zero migrate [--status|--checkpoint|--doctor] [--db <system-db>]');
  console.log('  zero migrate --plan --schema <module> --db <application-db>');
  console.log('  zero migrate --doctor --schema <module> --db <application-db>');
  console.log('');
  console.log('Managed migrations default to SYSTEM_DB_PATH, then ./data/zero.system.db.');
  console.log('--db is an intentional exact target override.');
  console.log('Schema doctor/plan are app-database inspections and never install system migrations.');
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
