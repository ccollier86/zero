import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';

import {
  canonicalizeVerifiedDomain,
  isPublicSuffix,
  publicSuffixListInfo,
  VerifiedDomainNameError,
  verifiedDomainFromEmail,
} from './verified-domain-name';
import publicSuffixList from './vendor/public_suffix_list.txt';

describe('verified domain names and pinned Public Suffix List', () => {
  test('normalizes exact ASCII A-labels without silently mapping Unicode', () => {
    expect(canonicalizeVerifiedDomain(' ACME.COM. ')).toBe('acme.com');
    expect(canonicalizeVerifiedDomain('xn--bcher-kva.de')).toBe('xn--bcher-kva.de');
    expect(() => canonicalizeVerifiedDomain('bücher.de')).toThrow(VerifiedDomainNameError);
    expect(verifiedDomainFromEmail('Person@ACME.COM')).toBe('acme.com');
  });

  test('rejects IPs, single labels, shared mailboxes, and every IANA example domain', () => {
    for (const domain of [
      '127.0.0.1',
      'localhost',
      'gmail.com',
      'staff.gmail.com',
      'example.com',
      'child.example.com',
      'example.net',
      'child.example.net',
      'example.org',
      'child.example.org',
      'company.test',
    ]) {
      expect(() => canonicalizeVerifiedDomain(domain)).toThrow(
        VerifiedDomainNameError,
      );
    }
  });

  test('uses ICANN wildcard/exception rules and PRIVATE suffixes', () => {
    expect(isPublicSuffix('com')).toBe(true);
    expect(isPublicSuffix('test.ck')).toBe(true);
    expect(isPublicSuffix('www.ck')).toBe(false);
    expect(canonicalizeVerifiedDomain('www.ck')).toBe('www.ck');
    expect(isPublicSuffix('blogspot.com')).toBe(true);
    expect(() => canonicalizeVerifiedDomain('blogspot.com')).toThrow(
      VerifiedDomainNameError,
    );
    expect(canonicalizeVerifiedDomain('company.blogspot.com'))
      .toBe('company.blogspot.com');
  });

  test('pins official source metadata, both sections, license, and SHA-256', () => {
    const info = publicSuffixListInfo();
    expect(info).toMatchObject({
      source: 'https://publicsuffix.org/list/public_suffix_list.dat',
      license: 'MPL-2.0',
      includes: ['ICANN', 'PRIVATE'],
    });
    expect(info.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(publicSuffixList).toContain('// ===BEGIN ICANN DOMAINS===');
    expect(publicSuffixList).toContain('// ===BEGIN PRIVATE DOMAINS===');
    expect(createHash('sha256').update(publicSuffixList).digest('hex'))
      .toBe(info.sha256);
  });
});
