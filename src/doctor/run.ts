#!/usr/bin/env bun
/**
 * run.ts
 *
 * Human-facing CLI for Zero's platform doctor. Presentation uses console
 * output intentionally; reusable platform diagnostics live in platform-doctor.
 */

import { loadDoctorConfig, resolveDoctorConfigPath } from './config-loader';
import { runPlatformDoctor, type PlatformDoctorFinding } from './platform-doctor';

const args = process.argv.slice(2);

const strict = args.includes('--strict');
const json = args.includes('--json');
const configPath = resolveDoctorConfigPath(getArg('--config'));

try {
  if (!configPath) {
    throw new Error(
      '[doctor] No config module found. Pass --config ./zero.config.ts or create config/zero.config.ts.'
    );
  }

  const config = await loadDoctorConfig(configPath);
  const report = runPlatformDoctor(config, { strict });

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

  console.log(ok ? '\nDoctor completed with warnings.' : '\nDoctor failed.');
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
