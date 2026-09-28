/** Exact ASCII A-label validation backed by Zero's pinned official PSL. */

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import publicSuffixList from './vendor/public_suffix_list.txt';
import { PUBLIC_SUFFIX_LIST_METADATA } from './vendor/public-suffix-list-metadata';

const DEFAULT_SHARED_MAILBOX_DOMAINS = Object.freeze([
  'aol.com',
  'fastmail.com',
  'gmail.com',
  'googlemail.com',
  'gmx.com',
  'gmx.de',
  'hey.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mail.com',
  'mac.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'tuta.com',
  'tutanota.com',
  'yahoo.com',
  'yandex.com',
  'zoho.com',
]);

const RESERVED_SUFFIXES = Object.freeze([
  'example',
  'invalid',
  'localhost',
  'local',
  'test',
  'home.arpa',
  'example.com',
  'example.net',
  'example.org',
]);

interface PublicSuffixRules {
  exact: ReadonlySet<string>;
  wildcard: ReadonlySet<string>;
  exception: ReadonlySet<string>;
}

export type VerifiedDomainNameErrorCode =
  | 'unicode'
  | 'syntax'
  | 'ip'
  | 'single-label'
  | 'reserved'
  | 'public-suffix'
  | 'shared-mailbox';

export class VerifiedDomainNameError extends Error {
  constructor(readonly code: VerifiedDomainNameErrorCode) {
    super('Domain is not eligible for verified-company onboarding');
    this.name = 'VerifiedDomainNameError';
  }
}

assertPinnedPublicSuffixList();
const PSL = parsePublicSuffixRules(publicSuffixList);

/** Normalize and validate one explicit ASCII DNS A-label domain. */
export function canonicalizeVerifiedDomain(
  input: string,
  additionalSharedMailboxDomains: readonly string[] = [],
): string {
  if (typeof input !== 'string' || /[^\x00-\x7f]/.test(input)) {
    throw new VerifiedDomainNameError('unicode');
  }
  const domain = input.trim().toLowerCase().replace(/\.$/, '');
  if (!domain || domain.length > 253 || domain.includes('..')) {
    throw new VerifiedDomainNameError('syntax');
  }
  if (isIP(domain) !== 0) throw new VerifiedDomainNameError('ip');
  const labels = domain.split('.');
  if (labels.length < 2) throw new VerifiedDomainNameError('single-label');
  for (const label of labels) {
    if (label.length < 1 || label.length > 63
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) {
      throw new VerifiedDomainNameError('syntax');
    }
  }
  // This accepts already-ASCII UTS/IDNA A-labels (including xn--) but never
  // silently maps a Unicode U-label or compatibility character.
  if (domainToASCII(domain) !== domain) throw new VerifiedDomainNameError('syntax');
  if (RESERVED_SUFFIXES.some((suffix) => isSameOrChild(domain, suffix))) {
    throw new VerifiedDomainNameError('reserved');
  }
  if (isPublicSuffix(domain)) throw new VerifiedDomainNameError('public-suffix');
  const shared = new Set([
    ...DEFAULT_SHARED_MAILBOX_DOMAINS,
    ...additionalSharedMailboxDomains,
  ]);
  if ([...shared].some((suffix) => isSameOrChild(domain, suffix))) {
    throw new VerifiedDomainNameError('shared-mailbox');
  }
  return domain;
}

/** Extract and validate the exact live primary-email domain. */
export function verifiedDomainFromEmail(
  email: string,
  additionalSharedMailboxDomains: readonly string[] = [],
): string {
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) {
    throw new VerifiedDomainNameError('syntax');
  }
  return canonicalizeVerifiedDomain(
    email.slice(at + 1),
    additionalSharedMailboxDomains,
  );
}

/** True only when the complete input is itself an ICANN or PRIVATE suffix. */
export function isPublicSuffix(domain: string): boolean {
  const labels = domain.split('.');
  return labels.length === publicSuffixLabelCount(labels);
}

export function publicSuffixListInfo() {
  return PUBLIC_SUFFIX_LIST_METADATA;
}

function publicSuffixLabelCount(labels: readonly string[]): number {
  let matched = 1; // PSL prevailing rule: `*`.
  for (let index = 0; index < labels.length; index += 1) {
    const candidate = labels.slice(index).join('.');
    if (PSL.exception.has(candidate)) {
      return Math.max(1, labels.length - index - 1);
    }
    if (PSL.exact.has(candidate)) {
      matched = Math.max(matched, labels.length - index);
    }
    if (index > 0 && PSL.wildcard.has(candidate)) {
      matched = Math.max(matched, labels.length - index + 1);
    }
  }
  return matched;
}

function parsePublicSuffixRules(text: string): PublicSuffixRules {
  const exact = new Set<string>();
  const wildcard = new Set<string>();
  const exception = new Set<string>();
  for (const source of text.split(/\r?\n/)) {
    const line = source.trim();
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('!')) exception.add(line.slice(1));
    else if (line.startsWith('*.')) wildcard.add(line.slice(2));
    else exact.add(line);
  }
  return { exact, wildcard, exception };
}

function assertPinnedPublicSuffixList(): void {
  const digest = createHash('sha256').update(publicSuffixList).digest('hex');
  if (digest !== PUBLIC_SUFFIX_LIST_METADATA.sha256) {
    throw new Error(
      '[auth] Vendored Public Suffix List failed its pinned SHA-256 integrity check.',
    );
  }
  if (!publicSuffixList.includes('// ===BEGIN ICANN DOMAINS===')
    || !publicSuffixList.includes('// ===BEGIN PRIVATE DOMAINS===')) {
    throw new Error('[auth] Vendored Public Suffix List is incomplete.');
  }
}

function isSameOrChild(domain: string, suffix: string): boolean {
  return domain === suffix || domain.endsWith(`.${suffix}`);
}
