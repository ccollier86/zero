/** Bounded DNS TXT resolution for server-derived verification names. */

import { resolveTxt as nodeResolveTxt } from 'node:dns/promises';
import type { AuthVerifiedDomainTxtResolver } from './auth-tenant-onboarding-types';

export interface BoundedTxtResolverOptions {
  resolveTxt?: AuthVerifiedDomainTxtResolver;
  timeoutMs: number;
  maxAnswers: number;
  maxBytes: number;
}

export class VerifiedDomainDnsError extends Error {
  constructor(readonly code: 'timeout' | 'lookup' | 'bounds' | 'invalid') {
    super('DNS TXT verification was unavailable');
    this.name = 'VerifiedDomainDnsError';
  }
}

export async function resolveBoundedTxt(
  hostname: string,
  options: BoundedTxtResolverOptions,
): Promise<readonly string[]> {
  const resolver = options.resolveTxt ?? nodeResolveTxt;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new VerifiedDomainDnsError('timeout')),
        options.timeoutMs,
      );
      timer.unref?.();
    });
    const raw = await Promise.race([resolver(hostname), timeout]);
    if (!Array.isArray(raw) || raw.length > options.maxAnswers) {
      throw new VerifiedDomainDnsError('bounds');
    }
    let total = 0;
    const answers: string[] = [];
    for (const chunks of raw) {
      if (!Array.isArray(chunks)
        || chunks.some((chunk) => typeof chunk !== 'string')) {
        throw new VerifiedDomainDnsError('invalid');
      }
      const answer = chunks.join('');
      total += Buffer.byteLength(answer, 'utf8');
      if (total > options.maxBytes) throw new VerifiedDomainDnsError('bounds');
      answers.push(answer);
    }
    return Object.freeze(answers);
  } catch (error) {
    if (error instanceof VerifiedDomainDnsError) throw error;
    if (isAuthoritativeAbsence(error)) return Object.freeze([]);
    throw new VerifiedDomainDnsError('lookup');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isAuthoritativeAbsence(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'ENODATA' || code === 'ENOTFOUND';
}
