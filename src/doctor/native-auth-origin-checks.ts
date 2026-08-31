import { isValidNativeIssuer } from '../auth/native/issuer';
import type { ResolvedNativeAuthConfig } from '../auth/native/types';
import type { AppConfig } from '../frontend/server/types';

interface Finding {
  severity: 'info' | 'warning' | 'error';
  code: string;
  path?: string;
  message: string;
  hint?: string;
  docs?: string;
}

const DOCS = './docs/auth/native-app-auth.md';

export function checkNativeAuthOrigin(
  config: AppConfig,
  native: ResolvedNativeAuthConfig,
  findings: Finding[],
): void {
  const configuredPublicUrl = config.app?.publicUrl;
  const publicOrigin = canonicalPublicOrigin(configuredPublicUrl);

  if (configuredPublicUrl && !publicOrigin) {
    findings.push(invalidPublicUrl());
    return;
  }
  if (native.issuer && publicOrigin) {
    if (new URL(native.issuer).origin !== publicOrigin) {
      findings.push({
        severity: 'error',
        code: 'auth.native.origin_mismatch',
        path: 'auth.nativeApps.issuer',
        message: 'Native issuer and app.publicUrl must share one origin.',
        hint: 'Serve native authorization and protected Zero APIs from the same public origin.',
        docs: DOCS,
      });
    }
    return;
  }
  if (native.issuer || publicOrigin) return;

  findings.push({
    severity: 'error',
    code: 'auth.native.issuer_missing',
    path: 'auth.nativeApps.issuer',
    message: 'Native app auth needs app.publicUrl or an explicit issuer.',
    hint: 'Use a canonical HTTPS origin, or loopback HTTP during development.',
    docs: DOCS,
  });
}

function canonicalPublicOrigin(value: string | undefined): string | null {
  if (!value || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return isValidNativeIssuer(`${url.origin}/auth`) ? url.origin : null;
  } catch {
    return null;
  }
}

function invalidPublicUrl(): Finding {
  return {
    severity: 'error',
    code: 'auth.native.public_url_invalid',
    path: 'app.publicUrl',
    message: 'Native app auth needs app.publicUrl to be a canonical secure origin.',
    hint: 'Use HTTPS, or exact localhost/loopback HTTP during development.',
    docs: DOCS,
  };
}
