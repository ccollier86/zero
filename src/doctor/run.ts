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
  console.log('');

  if (findings.length === 0) {
    console.log('✓ No platform issues found.');
    return;
  }

  for (const finding of findings) {
    const path = finding.path ? ` (${finding.path})` : '';
    console.log(`${mark(finding.severity)} ${finding.code}${path}: ${finding.message}`);
  }

  console.log(ok ? '\nDoctor completed with warnings.' : '\nDoctor failed.');
}

function mark(severity: PlatformDoctorFinding['severity']): string {
  if (severity === 'error') return '✗';
  if (severity === 'warning') return '!';
  return 'i';
}
