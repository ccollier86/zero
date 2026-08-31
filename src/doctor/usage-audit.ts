/**
 * usage-audit.ts
 *
 * Orchestrates Doctor's app source usage audit. Discovery, rule definitions,
 * and shared contracts live in adjacent responsibility-focused files.
 */

import { resolve } from 'node:path';

import { addAuthStopLifecycleFinding } from './usage-audit-auth-lifecycle';
import { DEFAULT_EXCLUDES, browserSourceFile, discoverSourceFiles, matchesPathPattern, normalizePath, stripLineNumber } from './usage-audit-scanner';
import { USAGE_RULES, hasRootSymbol, usesZeroClientHooks, usesZeroComponents, usesZeroToast } from './usage-audit-rules';
import type {
  NormalizedUsageAuditOptions,
  RunUsageAuditInput,
  SourceFile,
  UsageAuditAllowEntry,
  UsageAuditOptions,
  UsageAuditRuleSeverity,
  UsageRule,
} from './usage-audit-types';
import type { PlatformDoctorFinding, PlatformDoctorSeverity } from './platform-doctor';

export type {
  UsageAuditAllowEntry,
  UsageAuditOptions,
  UsageAuditRuleSeverity,
} from './usage-audit-types';

const DEFAULT_MAX_FILE_LINES = 400;

/** Run the app source usage audit and return doctor-compatible findings. */
export function runUsageAudit(input: RunUsageAuditInput): PlatformDoctorFinding[] {
  const options = normalizeUsageAuditOptions(input.options);
  if (!options.enabled) return [];

  const projectRoot = resolve(input.projectRoot);
  const files = discoverSourceFiles(projectRoot, input.resolvedConfig, options);
  const findings: PlatformDoctorFinding[] = [];

  for (const file of files) {
    addLargeFileFinding(file, options, findings);
    addRuleFindings(file, options, findings);
  }
  addAuthStopLifecycleFinding(files, options, findings);
  addRootWiringFindings(files, options, findings);

  return findings.filter((finding) => !isAllowedFinding(finding, options.allow));
}

function normalizeUsageAuditOptions(
  input?: boolean | UsageAuditOptions
): NormalizedUsageAuditOptions {
  if (input === false) {
    return {
      enabled: false,
      exclude: DEFAULT_EXCLUDES,
      maxFileLines: DEFAULT_MAX_FILE_LINES,
      rules: {},
      allow: [],
    };
  }

  const options = input === true || input === undefined ? {} : input;
  return {
    enabled: options.enabled ?? true,
    include: options.include,
    exclude: [...DEFAULT_EXCLUDES, ...(options.exclude ?? [])],
    maxFileLines: options.maxFileLines ?? DEFAULT_MAX_FILE_LINES,
    rules: options.rules ?? {},
    allow: options.allow ?? [],
  };
}

function addLargeFileFinding(
  file: SourceFile,
  options: NormalizedUsageAuditOptions,
  findings: PlatformDoctorFinding[]
): void {
  const severity = getRuleSeverity('usage.structure.large_file', options);
  if (!severity) return;
  if (file.lines.length <= options.maxFileLines) return;

  findings.push({
    severity,
    code: 'usage.structure.large_file',
    path: `${file.relativePath}:1`,
    message: `${file.relativePath} has ${file.lines.length} lines, above the ${options.maxFileLines}-line responsibility threshold.`,
    hint: 'Review this file for mixed responsibilities. Split UI, data hooks, schema, mappers, route handlers, and services into focused files.',
    docs: './docs/engineering-standards.md',
  });
}

function addRuleFindings(
  file: SourceFile,
  options: NormalizedUsageAuditOptions,
  findings: PlatformDoctorFinding[]
): void {
  for (const rule of USAGE_RULES) {
    const severity = getRuleSeverity(rule.code, options);
    if (!severity || !rule.appliesTo(file)) continue;

    for (const match of findRuleMatches(file, rule)) {
      findings.push({
        severity,
        code: rule.code,
        path: `${file.relativePath}:${match.line}`,
        message: rule.message(file),
        hint: rule.hint,
        docs: rule.docs,
      });
    }
  }
}

function addRootWiringFindings(
  files: SourceFile[],
  options: NormalizedUsageAuditOptions,
  findings: PlatformDoctorFinding[]
): void {
  const browserFiles = files.filter(browserSourceFile);
  if (browserFiles.length === 0) return;

  const allBrowserSource = browserFiles.map((file) => file.source).join('\n');
  const rootPath = findRootLayoutPath(browserFiles);

  addMissingRootFinding({
    code: 'usage.frontend.app_provider_missing',
    options,
    findings,
    shouldWarn: usesZeroClientHooks(allBrowserSource) && !hasRootSymbol(allBrowserSource, 'AppProvider'),
    path: rootPath,
    message: 'Zero client hooks are used, but AppProvider was not found in app-owned source.',
    hint: 'Mount AppProvider in the root layout so auth, sync, resources, and client services share one runtime context.',
    docs: './docs/frontend/sdk.md',
  });

  addMissingRootFinding({
    code: 'usage.frontend.theme_provider_missing',
    options,
    findings,
    shouldWarn: usesZeroComponents(allBrowserSource) && !hasRootSymbol(allBrowserSource, 'ThemeProvider'),
    path: rootPath,
    message: 'Zero UI components are used, but ThemeProvider was not found in app-owned source.',
    hint: 'Mount ThemeProvider in the root layout so light/dark mode and design tokens behave consistently.',
    docs: './docs/frontend/design-tokens.md',
  });

  addMissingRootFinding({
    code: 'usage.frontend.toaster_missing',
    options,
    findings,
    shouldWarn: usesZeroToast(allBrowserSource) && !hasRootSymbol(allBrowserSource, 'Toaster'),
    path: rootPath,
    message: 'Toast calls or Zero toast imports are used, but Toaster was not found in app-owned source.',
    hint: 'Mount the Zero Toaster in the root layout before using toast notifications.',
    docs: './docs/frontend/component-inventory.md#overlays-and-feedback',
  });
}

function addMissingRootFinding(input: {
  code: string;
  options: NormalizedUsageAuditOptions;
  findings: PlatformDoctorFinding[];
  shouldWarn: boolean;
  path: string;
  message: string;
  hint: string;
  docs: string;
}): void {
  const severity = getRuleSeverity(input.code, input.options);
  if (!severity || !input.shouldWarn) return;

  input.findings.push({
    severity,
    code: input.code,
    path: `${input.path}:1`,
    message: input.message,
    hint: input.hint,
    docs: input.docs,
  });
}

function findRuleMatches(file: SourceFile, rule: UsageRule): Array<{ line: number }> {
  const matches: Array<{ line: number }> = [];

  for (let index = 0; index < file.lines.length; index += 1) {
    const line = file.lines[index] ?? '';
    if (line.trim().startsWith('//')) continue;
    if (!rule.matches.some((pattern) => pattern.test(line))) continue;
    matches.push({ line: index + 1 });
  }

  return matches;
}

function getRuleSeverity(
  code: string,
  options: NormalizedUsageAuditOptions
): PlatformDoctorSeverity | null {
  const configured = options.rules[code];
  if (configured === 'off') return null;
  return configured ?? 'warning';
}

function isAllowedFinding(
  finding: PlatformDoctorFinding,
  allow: UsageAuditAllowEntry[]
): boolean {
  if (!finding.path) return false;
  const path = stripLineNumber(finding.path);
  return allow.some((entry) =>
    entry.code === finding.code && matchesPathPattern(path, normalizePath(entry.path))
  );
}

function findRootLayoutPath(files: SourceFile[]): string {
  return files.find((file) =>
    file.relativePath === 'app/layout.tsx' ||
    file.relativePath === 'app/layout.jsx'
  )?.relativePath ?? 'app/layout.tsx';
}
