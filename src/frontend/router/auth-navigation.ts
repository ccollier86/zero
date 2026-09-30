/**
 * Safe local navigation helpers for browser and server auth redirects.
 *
 * App-configured routes may be written with or without a leading slash.
 * Untrusted return targets are stricter: they must already be root-relative so
 * values such as external URLs can never be reinterpreted as local routes.
 */

import {
  normalizeAbsoluteLocalPath,
  normalizeConfiguredLocalPath,
} from '../../auth/local-path';

const LOCAL_ORIGIN = 'https://zero.local';

/** Normalize an app-configured route and reject external or malformed values. */
export function normalizeConfiguredAuthPath(
  value: string,
  label: string,
): string {
  const normalized = normalizeConfiguredLocalPath(value);
  if (!normalized) {
    throw new Error(`[app] ${label} must be a safe local path.`);
  }
  return normalized;
}

/** Normalize an untrusted root-relative return target. */
export function normalizeAuthReturnPath(value: unknown): string | null {
  return normalizeAbsoluteLocalPath(value);
}

/** Return the pathname portion of a trusted, configured auth route. */
export function configuredAuthPathname(value: string, label: string): string {
  const configured = normalizeConfiguredAuthPath(value, label);
  return new URL(configured, LOCAL_ORIGIN).pathname;
}

/** Match router-equivalent pathnames, including an optional trailing slash. */
export function comparableAuthPathname(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

/**
 * Add a safe return target to a login route while preserving configured query
 * parameters and hashes.
 */
export function loginRedirectLocation(
  loginPath: string,
  returnPath: unknown,
): string {
  const configuredLogin = normalizeConfiguredAuthPath(loginPath, 'loginPath');
  const loginUrl = new URL(configuredLogin, LOCAL_ORIGIN);
  const safeReturnPath = normalizeAuthReturnPath(returnPath);

  if (
    safeReturnPath
    && comparableAuthPathname(new URL(safeReturnPath, LOCAL_ORIGIN).pathname)
      !== comparableAuthPathname(loginUrl.pathname)
  ) {
    loginUrl.searchParams.set('redirect', safeReturnPath);
  }

  return serializeLocalUrl(loginUrl);
}

/**
 * Resolve the destination for an authenticated browser currently on login.
 * A valid return target wins; otherwise the configured post-login path does.
 */
export function authenticatedLoginDestination(input: {
  loginPath: string;
  postLoginPath: string;
  search: string;
}): string | null {
  const loginPathname = configuredAuthPathname(input.loginPath, 'loginPath');
  const configuredFallback = normalizeConfiguredAuthPath(
    input.postLoginPath,
    'postLoginPath',
  );
  const params = new URLSearchParams(input.search);
  const returnValues = params.getAll('redirect');
  const returnPath = returnValues.length === 1
    ? normalizeAuthReturnPath(returnValues[0])
    : null;

  if (
    returnPath
    && comparableAuthPathname(new URL(returnPath, LOCAL_ORIGIN).pathname)
      !== comparableAuthPathname(loginPathname)
  ) {
    return returnPath;
  }

  if (
    comparableAuthPathname(new URL(configuredFallback, LOCAL_ORIGIN).pathname)
    === comparableAuthPathname(loginPathname)
  ) {
    return null;
  }

  return configuredFallback;
}

function serializeLocalUrl(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}
