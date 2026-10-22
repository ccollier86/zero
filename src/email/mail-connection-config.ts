/** Shared, network-free resolution of trusted SMTP/IMAP connection settings. */
import type { MailConnectionConfig } from './types';

export interface MailConnectionSettings {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth?: { user: string; pass: string };
  tls: { rejectUnauthorized: true; minVersion: 'TLSv1.2'; servername?: string; ca?: string[] };
  timeoutMs: number;
}
export interface MailConfigIssue { field: string; message: string }

/** Never include configured values in findings: they may contain credentials. */
export function inspectMailConnection(
  protocol: 'smtp' | 'imap',
  input: MailConnectionConfig = {},
  env: Record<string, string | undefined> = process.env,
): { settings: MailConnectionSettings; issues: MailConfigIssue[] } {
  const prefix = protocol.toUpperCase();
  const issues: MailConfigIssue[] = [];
  const issue = (field: string, message: string) => issues.push({ field, message });
  const config = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (config !== input) issue('', 'Connection configuration must be an object.');
  const allowed = new Set(['host', 'port', 'secure', 'requireTLS', 'auth', 'tls', 'timeoutMs']);
  for (const key of Object.keys(config)) if (!allowed.has(key)) issue('', 'Unsupported connection configuration field.');
  const string = (value: unknown, field: string, trim = true): string => {
    if (value === undefined) return '';
    if (typeof value !== 'string') { issue(field, 'Must be a string.'); return ''; }
    return trim ? value.trim() : value;
  };
  const boolean = (value: unknown, fallback: boolean, field: string): boolean => {
    if (value === undefined || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    issue(field, 'Must be true or false.'); return fallback;
  };
  const host = string(config.host ?? env[`${prefix}_HOST`], 'host');
  if (!host || /[\s/@\x00-\x1f]/.test(host)) issue('host', 'A hostname or IP address is required, without a URL scheme.');
  const rawPort = config.port ?? env[`${prefix}_PORT`];
  const secure = boolean(config.secure ?? env[`${prefix}_SECURE`],
    rawPort === undefined || rawPort === '' ? protocol === 'imap' : Number(rawPort) === (protocol === 'smtp' ? 465 : 993), 'secure');
  const port = rawPort === undefined || rawPort === '' ? (protocol === 'smtp' ? (secure ? 465 : 587) : (secure ? 993 : 143)) : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) issue('port', 'Must be an integer between 1 and 65535.');
  const requireTLS = boolean(config.requireTLS ?? env[`${prefix}_REQUIRE_TLS`], true, 'requireTLS');
  const authConfig = config.auth;
  if (authConfig !== undefined && authConfig !== false
    && (authConfig === null || typeof authConfig !== 'object' || Array.isArray(authConfig))) issue('auth', 'Must be an authentication object or false.');
  const authObject = authConfig && typeof authConfig === 'object' ? authConfig : {};
  if (Object.keys(authObject).some(key => key !== 'user' && key !== 'pass')) issue('auth', 'Unsupported authentication field.');
  const user = authConfig === false ? '' : string(authObject.user ?? env[`${prefix}_USER`], 'auth.user');
  const pass = authConfig === false ? '' : string(authObject.pass ?? env[`${prefix}_PASSWORD`], 'auth.pass', false);
  if ((protocol === 'imap' || authConfig !== false) && (!user || !pass)) issue('auth', 'A username and password are required; only SMTP may explicitly select auth: false for an anonymous relay.');
  const tls = config.tls;
  if (tls !== undefined && (!tls || typeof tls !== 'object' || Array.isArray(tls))) issue('tls', 'Must be a TLS configuration object.');
  if (tls && Object.keys(tls).some(key => key !== 'servername' && key !== 'ca')) issue('tls', 'Only servername and ca may be configured; certificate verification cannot be disabled.');
  const servername = string(tls?.servername, 'tls.servername');
  if (/[\s/\x00-\x1f]/.test(servername)) issue('tls.servername', 'Must be a TLS server hostname.');
  const ca = tls?.ca === undefined ? undefined : typeof tls.ca === 'string' ? [tls.ca] : tls.ca;
  if (ca && (!Array.isArray(ca) || !ca.length || ca.some(value => typeof value !== 'string' || !value.trim()))) issue('tls.ca', 'Must be a certificate string or nonempty array of certificate strings.');
  const timeoutMs = config.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600_000) issue('timeoutMs', 'Must be an integer from 100 to 600000 milliseconds.');
  return { settings: {
    host, port, secure, requireTLS, auth: user && pass ? { user, pass } : undefined,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', ...(servername ? { servername } : {}), ...(Array.isArray(ca) ? { ca: [...ca] } : {}) },
    timeoutMs,
  }, issues };
}
