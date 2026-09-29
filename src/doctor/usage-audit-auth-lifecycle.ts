import type { PlatformDoctorFinding } from './platform-doctor-contracts';
import type {
  NormalizedUsageAuditOptions,
  SourceFile,
} from './usage-audit-types';

const RULE_CODE = 'usage.backend.auth_stop_barrier_missing';

/** Warn when a directly composed public auth plugin has no joined stop boundary. */
export function addAuthStopLifecycleFinding(
  files: SourceFile[],
  options: NormalizedUsageAuditOptions,
  findings: PlatformDoctorFinding[]
): void {
  const authCall = findPublicCall(files, 'createAuthPlugin');
  if (!authCall || findPublicCall(files, 'installAuthStopBarrier')) return;
  const configured = options.rules[RULE_CODE];
  if (configured === 'off') return;

  findings.push({
    severity: configured ?? 'warning',
    code: RULE_CODE,
    path: `${authCall.file.relativePath}:${authCall.line}`,
    message: 'Standalone createAuthPlugin composition does not install an awaitable auth stop barrier.',
    hint: 'Wrap the finished root Elysia app with installAuthStopBarrier(), then await app.stop() before disposing the injected database.',
    docs: './docs/auth/README.md#the-full-loop',
  });
}

function findPublicCall(
  files: SourceFile[],
  symbol: string
): { file: SourceFile; line: number } | null {
  for (const file of files) {
    for (const localName of importedNames(file.source, symbol)) {
      const call = new RegExp(`\\b${escapeRegex(localName)}\\s*\\(`);
      const index = file.lines.findIndex((line) =>
        !line.trimStart().startsWith('//') && call.test(line)
      );
      if (index >= 0) return { file, line: index + 1 };
    }
  }
  return null;
}

function importedNames(source: string, symbol: string): string[] {
  const names: string[] = [];
  const imports = /import\s*\{([\s\S]*?)\}\s*from\s*['"]@zero\/framework\/(?:auth|server)['"]/g;
  for (const match of source.matchAll(imports)) {
    for (const part of (match[1] ?? '').split(',')) {
      const specifier = part.trim().replace(/^type\s+/, '');
      const parsed = new RegExp(`^${escapeRegex(symbol)}(?:\\s+as\\s+([A-Za-z_$][\\w$]*))?$`)
        .exec(specifier);
      if (parsed) names.push(parsed[1] ?? symbol);
    }
  }
  return names;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
