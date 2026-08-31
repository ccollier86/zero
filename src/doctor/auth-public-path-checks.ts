import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import type { ResolvedConfig } from '../frontend/server/types';
import type { PlatformDoctorFinding } from './platform-doctor';

interface RequiredPath {
  label: string;
  path: string;
  code: string;
}

export function authPublicPathFindings(
  resolved: ResolvedConfig,
): PlatformDoctorFinding[] {
  if (resolved.auth === false || resolved.routeAuth === 'explicit') return [];
  let auth;
  try {
    auth = resolveAuthBehaviorConfig(resolved.auth);
  } catch {
    // The owning config check reports the invalid auth value. Doctor checks
    // must remain composable rather than turning one bad field into a crash.
    return [];
  }
  const required: RequiredPath[] = [
    { label: 'loginPath', path: resolved.loginPath, code: 'auth.login_path.not_public' },
    {
      label: 'registrationPath', path: resolved.registrationPath,
      code: 'auth.registration_path.not_public',
    },
  ];
  if (auth.accountEmails.passwordReset) {
    required.push(
      { label: 'forgot-password route', path: '/forgot-password', code: 'auth.forgot_path.not_public' },
      { label: 'password reset path', path: auth.accountEmails.resetPath, code: 'auth.reset_path.not_public' },
    );
  }
  if (auth.accountEmails.adminCreatedUser) {
    required.push({
      label: 'account setup path', path: auth.accountEmails.setupPath,
      code: 'auth.setup_path.not_public',
    });
  }
  if (auth.account.requireEmailVerification) {
    required.push({
      label: 'email verification path', path: auth.account.emailVerificationPath,
      code: 'auth.verification_path.not_public',
    });
  }

  return dedupe(required).flatMap((entry) => {
    const path = routePathname(entry.path) ?? entry.path;
    if (isPathPublic(path, resolved.publicPaths)) return [];
    return [{
      severity: 'warning' as const,
      code: entry.code,
      path: 'publicPaths',
      message: `${entry.label} "${path}" is protected, so its auth flow cannot start or complete.`,
      hint: `Add "${path}" to publicPaths or use routeAuth: "explicit".`,
      docs: './docs/auth/README.md',
    }];
  });
}

function routePathname(value: string): string | null {
  const path = value.trim().split(/[?#]/, 1)[0] ?? '';
  if (!path.startsWith('/') || path.startsWith('//')
    || /[\\\u0000-\u001f\u007f]/.test(path)) return null;
  return new URL(path, 'https://zero.local').pathname;
}

function isPathPublic(pathname: string, publicPaths: readonly string[]): boolean {
  return publicPaths.some((value) => {
    const publicPath = routePathname(value);
    if (!publicPath) return false;
    if (publicPath === '/') return true;
    const prefix = publicPath.endsWith('/') ? publicPath.slice(0, -1) : publicPath;
    return pathname === publicPath || pathname.startsWith(`${prefix}/`);
  });
}

function dedupe(paths: RequiredPath[]): RequiredPath[] {
  const seen = new Set<string>();
  return paths.filter((entry) => {
    const path = routePathname(entry.path) ?? entry.path;
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}
