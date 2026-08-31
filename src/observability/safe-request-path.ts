/**
 * Return an observability-safe request path without query parameters or
 * secret-bearing path segments.
 */
export function getSafeRequestPath(request: Request): string {
  return sanitizeRequestPath(new URL(request.url).pathname);
}

/** Redact known path parameters that carry reusable authentication secrets. */
export function sanitizeRequestPath(pathname: string): string {
  return pathname
    .replace(
      /(^|\/)(auth\/action-token)\/[^/]+(?=\/|$)/g,
      '$1$2/:token',
    )
    .replace(
      /(^|\/)(storage\/(?:presigned|upload-grants))\/[^/]+(?=\/|$)/g,
      '$1$2/:token',
    );
}
