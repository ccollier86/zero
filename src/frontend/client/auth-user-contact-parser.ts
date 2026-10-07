/** Admit secret-free contact projections; ownership proof is always server-derived. */
import type { UserContactCapabilities, UserContactSnapshot, UserContactValue } from '../../auth/auth-user-contact-types';
import { isPhoneNumber } from '../../lib/phone-number';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const timestamp = (value: unknown) => value === null || Number.isSafeInteger(value) && Number(value) >= 0;
const text = (value: unknown, maximum: number) => value === null || typeof value === 'string' && value.length > 0 && value.length <= maximum;
const bools = (value: unknown, keys: readonly string[]) => record(value) && keys.every(key => typeof value[key] === 'boolean');

export function isUserContactCapabilities(value: unknown): value is UserContactCapabilities {
  if (!record(value) || !['ready', 'blocked', 'disabled'].includes(String(value.state))
    || typeof value.verificationPath !== 'string' || value.verificationPath.length > 2048
    || !value.verificationPath.startsWith('/') || value.verificationPath.startsWith('//')
    || /[\\?#\u0000-\u0020]/u.test(value.verificationPath)
    || !bools(value.email, ['readable', 'verifyReady', 'changeReady'])
    || !bools(value.phone, ['readable', 'enabled', 'editable', 'verifyReady'])) return false;
  const email = value.email as UserContactCapabilities['email'], phone = value.phone as UserContactCapabilities['phone'];
  if (email.cancelReady !== undefined && typeof email.cancelReady !== 'boolean'
    || phone.cancelReady !== undefined && typeof phone.cancelReady !== 'boolean') return false;
  return (!email.verifyReady && !email.changeReady || value.state === 'ready' && email.readable)
    && (!phone.editable && !phone.verifyReady || value.state === 'ready' && phone.readable && phone.enabled)
    && (!email.cancelReady || value.state === 'ready' && email.readable)
    && (!phone.cancelReady || value.state === 'ready' && phone.readable && phone.enabled);
}

function isContact(value: unknown, channel: 'email' | 'phone'): value is UserContactValue {
  if (!record(value) || !text(value.value, channel === 'email' ? 254 : 16)
    || !['absent', 'unverified', 'pending', 'delivery-unavailable', 'possession-verified', 'administratively-attested'].includes(String(value.state))
    || !timestamp(value.verifiedAt) || !timestamp(value.expiresAt) || !text(value.pendingValue, channel === 'email' ? 254 : 16)) return false;
  if (channel === 'phone' && [value.value, value.pendingValue].some(number => number !== null && !isPhoneNumber(number))) return false;
  if (value.value === null && value.state !== 'absent' || value.state === 'absent' && value.value !== null) return false;
  if (value.state === 'possession-verified' || value.state === 'administratively-attested') {
    if (value.value === null || value.verifiedAt === null || channel === 'phone' && value.state === 'administratively-attested') return false;
  } else if (value.verifiedAt !== null) return false;
  const noChallenge = value.challengeId === null && value.pendingValue === null && value.expiresAt === null;
  const hasChallenge = typeof value.challengeId === 'string' && /^acc_[a-f0-9-]{36}$/u.test(value.challengeId)
    && value.pendingValue !== null && value.expiresAt !== null;
  return (noChallenge || hasChallenge) && (!['pending', 'delivery-unavailable'].includes(String(value.state)) || hasChallenge);
}

export function isUserContactSnapshot(value: unknown): value is UserContactSnapshot {
  if (!record(value) || typeof value.userId !== 'string' || !value.userId || value.userId.length > 512
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || !isUserContactCapabilities(value.capabilities)) return false;
  return (value.email === null || isContact(value.email, 'email'))
    && (value.phone === null || isContact(value.phone, 'phone'))
    && (value.capabilities.email.readable || value.email === null)
    && (value.capabilities.phone.readable && value.capabilities.phone.enabled || value.phone === null);
}
