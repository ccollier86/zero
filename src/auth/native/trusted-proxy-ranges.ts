/** Validated IP/CIDR matcher for deployment-trusted reverse proxies. */

import { BlockList, isIP } from 'node:net';

export interface TrustedProxyMatcher {
  has(address: string): boolean;
}

export function createTrustedProxyMatcher(ranges: readonly string[]): TrustedProxyMatcher {
  const blockList = new BlockList();
  for (const value of ranges) addRange(blockList, value);
  return {
    has(address) {
      const family = isIP(address);
      return family !== 0 && blockList.check(address, family === 4 ? 'ipv4' : 'ipv6');
    },
  };
}

function addRange(blockList: BlockList, value: string): void {
  const normalized = value.trim();
  const slash = normalized.lastIndexOf('/');
  const address = slash < 0 ? normalized : normalized.slice(0, slash);
  const family = isIP(address);
  if (family === 0) fail(value);
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (slash < 0) {
    blockList.addAddress(address, type);
    return;
  }
  const prefix = Number(normalized.slice(slash + 1));
  const maximum = family === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix <= 0 || prefix > maximum) fail(value);
  blockList.addSubnet(address, prefix, type);
}

function fail(value: string): never {
  throw new Error(`[native-auth] Invalid trusted proxy IP or CIDR: ${JSON.stringify(value)}.`);
}
