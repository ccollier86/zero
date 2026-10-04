import { validateDownloadUrl } from '@ai-sdk/provider-utils';

import { AIError } from './ai-errors';
import {
  aiSafeDownloadAbortReason,
  awaitAISafeDownloadAbortable,
  isAISafeDownloadAbort,
} from './ai-safe-download-cancellation';
import type {
  AISafeDownloadResolvedAddress,
  AISafeDownloadTransportOptions,
} from './ai-safe-download-contracts';
import { invalidRemoteAIAsset } from './ai-safe-download-errors';

type AISafeDownloadLookup = NonNullable<AISafeDownloadTransportOptions['lookup']>;

export function assertSafeAIAssetUrl(url: URL): void {
  if (url.username || url.password) {
    throw invalidRemoteAIAsset('Remote AI input URLs cannot contain credentials.');
  }
  try {
    validateDownloadUrl(url.toString());
  } catch {
    throw invalidRemoteAIAsset('Remote AI input URL is not allowed.');
  }
}

export async function pinPublicAIAssetAddress(
  logicalUrl: URL,
  lookup: AISafeDownloadLookup,
  abortSignal?: AbortSignal,
): Promise<URL> {
  const hostname = normalizeAIAssetHostname(logicalUrl.hostname);
  const literal = parseAIAssetAddressLiteral(hostname);
  const addresses = literal
    ? [literal]
    : await resolveAIAssetHostname(lookup, hostname, aiAssetUrlPort(logicalUrl), abortSignal);
  if (addresses.length === 0) {
    throw invalidRemoteAIAsset('Remote AI input hostname did not resolve.');
  }
  for (const address of addresses) assertPublicAIAssetAddress(address);

  const selected = addresses[0]!;
  const pinned = new URL(logicalUrl);
  pinned.hostname = selected.family === 6 ? `[${selected.address}]` : selected.address;
  return pinned;
}

export async function lookupAIAssetHostnameWithBun(
  hostname: string,
  port: number,
): Promise<readonly AISafeDownloadResolvedAddress[]> {
  return Bun.dns.lookup(hostname, { family: 0, port });
}

export function isAIAssetAddressLiteral(hostname: string): boolean {
  return parseAIAssetAddressLiteral(normalizeAIAssetHostname(hostname)) !== null;
}

export function normalizeAIAssetHostname(hostname: string): string {
  const unwrapped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  return unwrapped.replace(/\.+$/, '').toLowerCase();
}

async function resolveAIAssetHostname(
  lookup: AISafeDownloadLookup,
  hostname: string,
  port: number,
  abortSignal?: AbortSignal,
): Promise<readonly AISafeDownloadResolvedAddress[]> {
  try {
    return await awaitAISafeDownloadAbortable(lookup(hostname, port), abortSignal);
  } catch (error) {
    if (error instanceof AIError) throw error;
    if (isAISafeDownloadAbort(error, abortSignal)) {
      throw aiSafeDownloadAbortReason(abortSignal);
    }
    throw invalidRemoteAIAsset('Remote AI input hostname could not be resolved.');
  }
}

function assertPublicAIAssetAddress(address: AISafeDownloadResolvedAddress): void {
  if (address.family !== 4 && address.family !== 6) {
    throw invalidRemoteAIAsset('Remote AI input resolved to an invalid address.');
  }
  const host = address.family === 6 ? `[${address.address}]` : address.address;
  try {
    validateDownloadUrl(`http://${host}/`);
  } catch {
    throw invalidRemoteAIAsset('Remote AI input resolved to a disallowed address.');
  }
}

function parseAIAssetAddressLiteral(hostname: string): AISafeDownloadResolvedAddress | null {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    return { address: hostname, family: 4 };
  }
  if (hostname.includes(':')) return { address: hostname, family: 6 };
  return null;
}

function aiAssetUrlPort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}
