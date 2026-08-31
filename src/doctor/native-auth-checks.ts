/** Focused pre-resolution diagnostics for desktop/mobile public clients. */
import { resolveNativeAuthConfig } from '../auth/native/config';
import { classifyNativeRedirectUri } from '../auth/native/redirect-uri';
import type { NativeAuthConfig } from '../auth/native/types';
import type { AppConfig } from '../frontend/server/types';
import { checkNativeAuthOrigin } from './native-auth-origin-checks';

interface NativeAuthFinding {
  severity: 'info' | 'warning' | 'error'; code: string; message: string;
  path?: string; hint?: string; docs?: string;
}

const DOCS = './docs/auth/native-app-auth.md';

export function checkNativeAuthConfig(
  config: AppConfig,
  findings: NativeAuthFinding[],
): void {
  const native = getNativeConfig(config);
  if (!native) return;

  checkRedirects(native, findings);
  let resolved;
  try {
    resolved = resolveNativeAuthConfig(native);
  } catch (error) {
    findings.push({
      severity: 'error',
      code: 'auth.native.config_invalid',
      path: 'auth.nativeApps',
      message: error instanceof Error ? error.message : 'Native app auth config is invalid.',
      hint: 'Use publishable unique client IDs and valid, unique native redirect URIs.',
      docs: DOCS,
    });
    return;
  }

  if (!resolved.enabled) return;
  if (resolved.clients.length === 0) {
    findings.push({
      severity: 'error',
      code: 'auth.native.clients_missing',
      path: 'auth.nativeApps.clients',
      message: 'Native app auth is enabled without a registered public client.',
      hint: 'Register at least one desktop or mobile client, or set enabled: false.',
      docs: DOCS,
    });
  }
  checkNativeAuthOrigin(config, resolved, findings);
}

function getNativeConfig(config: AppConfig): NativeAuthConfig | undefined {
  return config.auth && typeof config.auth === 'object'
    ? config.auth.nativeApps
    : undefined;
}

function checkRedirects(config: NativeAuthConfig, findings: NativeAuthFinding[]): void {
  if (!Array.isArray(config.clients)) return;
  config.clients.forEach((client, clientIndex) => {
    if (!Array.isArray(client?.redirectUris)) return;
    client.redirectUris.forEach((uri: unknown, redirectIndex: number) => {
      if (typeof uri === 'string' && classifyNativeRedirectUri(uri)) return;
      findings.push({
        severity: 'error',
        code: 'auth.native.redirect_invalid',
        path: `auth.nativeApps.clients.${clientIndex}.redirectUris.${redirectIndex}`,
        message: `Native redirect URI ${JSON.stringify(uri)} is unsafe or unsupported.`,
        hint: 'Use an exact claimed HTTPS URI, reverse-domain private scheme, or IP-literal loopback URI.',
        docs: DOCS,
      });
    });
  });
}
