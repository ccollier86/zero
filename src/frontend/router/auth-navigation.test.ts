import { describe, expect, test } from 'bun:test';

import {
  authenticatedLoginDestination,
  comparableAuthPathname,
  configuredAuthPathname,
  loginRedirectLocation,
  normalizeAuthReturnPath,
  normalizeConfiguredAuthPath,
} from './auth-navigation';

describe('auth navigation', () => {
  test('preserves the protected route, query, and configured login URL pieces', () => {
    expect(loginRedirectLocation(
      '/signin?mode=password#form',
      '/app/patients/42?tab=notes#latest',
    )).toBe(
      '/signin?mode=password&redirect=%2Fapp%2Fpatients%2F42%3Ftab%3Dnotes%23latest#form',
    );
  });

  test('accepts only bounded root-relative return paths', () => {
    expect(normalizeAuthReturnPath('/app?tab=one#section')).toBe('/app?tab=one#section');
    expect(normalizeAuthReturnPath('https://attacker.example/app')).toBeNull();
    expect(normalizeAuthReturnPath('//attacker.example/app')).toBeNull();
    expect(normalizeAuthReturnPath('/\\attacker.example/app')).toBeNull();
    expect(normalizeAuthReturnPath('/%2e%2e//attacker.example')).toBeNull();
    expect(normalizeAuthReturnPath('/a/%2e%2e//attacker.example')).toBeNull();
    expect(normalizeAuthReturnPath(`/${'a'.repeat(4_096)}`)).toBeNull();
  });

  test('uses one safe return target before the configured fallback', () => {
    expect(authenticatedLoginDestination({
      loginPath: '/login',
      postLoginPath: '/dashboard',
      search: '?redirect=%2Fapp%2Frecords%3Fpage%3D2%23active',
    })).toBe('/app/records?page=2#active');

    expect(authenticatedLoginDestination({
      loginPath: '/login',
      postLoginPath: '/dashboard',
      search: '?redirect=https%3A%2F%2Fattacker.example',
    })).toBe('/dashboard');
  });

  test('rejects ambiguous and recursive return targets', () => {
    expect(authenticatedLoginDestination({
      loginPath: '/login',
      postLoginPath: '/app',
      search: '?redirect=%2Ffirst&redirect=%2Fsecond',
    })).toBe('/app');

    expect(authenticatedLoginDestination({
      loginPath: '/login',
      postLoginPath: '/app',
      search: '?redirect=%2Flogin%3Fagain%3D1',
    })).toBe('/app');

    expect(authenticatedLoginDestination({
      loginPath: '/login/',
      postLoginPath: '/app',
      search: '?redirect=%2Flogin%3Fagain%3D1',
    })).toBe('/app');

    expect(authenticatedLoginDestination({
      loginPath: '/login',
      postLoginPath: '/app',
      search: '?redirect=%2Flogin%2F%3Fagain%3D1',
    })).toBe('/app');

    expect(authenticatedLoginDestination({
      loginPath: '/',
      postLoginPath: '/',
      search: '',
    })).toBeNull();
  });

  test('normalizes configured app paths without weakening untrusted targets', () => {
    expect(normalizeConfiguredAuthPath('dashboard?tab=home', 'postLoginPath'))
      .toBe('/dashboard?tab=home');
    expect(configuredAuthPathname('/signin?mode=password', 'loginPath'))
      .toBe('/signin');
    expect(comparableAuthPathname('/signin/')).toBe('/signin');
    expect(() => normalizeConfiguredAuthPath('//attacker.example', 'postLoginPath'))
      .toThrow('postLoginPath must be a safe local path');
    expect(() => normalizeConfiguredAuthPath('https://attacker.example', 'postLoginPath'))
      .toThrow('postLoginPath must be a safe local path');
    expect(() => normalizeConfiguredAuthPath('', 'postLoginPath'))
      .toThrow('postLoginPath must be a safe local path');
  });
});
