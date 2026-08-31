#!/usr/bin/env bun
/**
 * run.ts
 *
 * Human-facing CLI for Zero's platform doctor. Presentation uses console
 * output intentionally; reusable platform diagnostics live in platform-doctor.
 */

import { basename, dirname } from 'node:path';

import { loadDoctorConfig, resolveDoctorConfigPath } from './config-loader';
import { runPlatformDoctor, type PlatformDoctorFinding } from './platform-doctor';
import type { UsageAuditOptions } from './usage-audit';

const args = process.argv.slice(2);

const strict = args.includes('--strict');
const json = args.includes('--json');
const noUsageAudit = args.includes('--no-usage-audit');
const configPath = resolveDoctorConfigPath(getArg('--config'));
const usageInclude = getArgs('--usage-include');
const usageExclude = getArgs('--usage-exclude');
let maxFileLines: number | undefined;

try {
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  maxFileLines = parsePositiveIntArg('--max-file-lines');

  if (!configPath) {
    throw new Error(
      '[doctor] No config module found. Pass --config ./zero.config.ts or create config/zero.config.ts.'
    );
  }

  const config = await loadDoctorConfig(configPath);
  const report = runPlatformDoctor(config, {
    strict,
    projectRoot: deriveProjectRoot(configPath),
    usageAudit: noUsageAudit ? false : buildUsageAuditOptions(),
  });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(configPath, report.findings, report.ok);
  }

  if (!report.ok) process.exitCode = 1;
} catch (error) {
  if (json) {
    console.log(JSON.stringify({
      ok: false,
      findings: [{
        severity: 'error',
        code: 'doctor.failed',
        message: error instanceof Error ? error.message : String(error),
      }],
    }, null, 2));
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
}

function getArg(flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
}

function getArgs(flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) continue;
    const value = args[index + 1];
    if (value) values.push(value);
  }
  return values;
}

function parsePositiveIntArg(flag: string): number | undefined {
  const value = getArg(flag);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`[doctor] ${flag} must be a positive integer.`);
  }
  return parsed;
}

function buildUsageAuditOptions(): UsageAuditOptions {
  return {
    ...(maxFileLines ? { maxFileLines } : {}),
    ...(usageInclude.length > 0 ? { include: usageInclude } : {}),
    ...(usageExclude.length > 0 ? { exclude: usageExclude } : {}),
  };
}

function deriveProjectRoot(configPath: string): string {
  const configDir = dirname(configPath);
  if (basename(configDir) === 'config') return dirname(configDir);
  return configDir;
}

function printReport(
  configPath: string,
  findings: PlatformDoctorFinding[],
  ok: boolean
): void {
  console.log('');
  console.log('Platform Doctor');
  console.log('───────────────');
  console.log(`Config: ${configPath}`);
  console.log(`Summary: ${formatSummary(findings)}`);
  console.log('');

  if (findings.length === 0) {
    console.log('✓ No platform issues found.');
    return;
  }

  printFindings('Errors', findings.filter((finding) => finding.severity === 'error'));
  printFindings('Warnings', findings.filter((finding) => finding.severity === 'warning'));
  printFindings('Info', findings.filter((finding) => finding.severity === 'info'));

  if (!ok) {
    console.log('\nDoctor failed.');
    return;
  }

  const hasWarnings = findings.some((finding) => finding.severity === 'warning');
  console.log(hasWarnings ? '\nDoctor completed with warnings.' : '\nDoctor completed.');
}

function printFindings(title: string, findings: PlatformDoctorFinding[]): void {
  if (findings.length === 0) return;

  console.log(title);
  for (const finding of findings) {
    const location = finding.path ? ` (${finding.path})` : '';
    console.log(`  ${mark(finding.severity)} ${finding.code}${location}`);
    console.log(`    ${finding.message}`);
    if (finding.hint) console.log(`    hint: ${finding.hint}`);
    if (finding.docs) console.log(`    docs: ${finding.docs}`);
  }
  console.log('');
}

function formatSummary(findings: PlatformDoctorFinding[]): string {
  const errors = findings.filter((finding) => finding.severity === 'error').length;
  const warnings = findings.filter((finding) => finding.severity === 'warning').length;
  const info = findings.filter((finding) => finding.severity === 'info').length;
  return [
    formatCount(errors, 'error'),
    formatCount(warnings, 'warning'),
    formatCount(info, 'info'),
  ].join(', ');
}

function formatCount(count: number, label: string): string {
  return `${count} ${count === 1 ? label : `${label}s`}`;
}

function mark(severity: PlatformDoctorFinding['severity']): string {
  if (severity === 'error') return '✗';
  if (severity === 'warning') return '!';
  return 'i';
}

function printUsage(): void {
  console.log('Usage: zero doctor --config ./zero.config.ts [options]');
  console.log('');
  console.log('Options:');
  console.log('  --strict                    Treat warnings as failures');
  console.log('  --json                      Print JSON report');
  console.log('  --no-usage-audit            Disable app source usage scanning');
  console.log('  --max-file-lines <count>    Large-file warning threshold (default: 400)');
  console.log('  --usage-include <path>      Add/override a source scan root; repeatable');
  console.log('  --usage-exclude <pattern>   Exclude a path or glob from source scanning; repeatable');
  console.log('  -h, --help                  Show this help');
}
