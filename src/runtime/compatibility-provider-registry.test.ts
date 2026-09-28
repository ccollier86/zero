import { describe, expect, test } from 'bun:test';

import {
  CompatibilityProviderRegistry,
  ZERO_RUNTIME_AMBIGUOUS,
  ZeroRuntimeAmbiguousError,
} from './compatibility-provider-registry';

describe('CompatibilityProviderRegistry', () => {
  test('returns null when no provider is registered', () => {
    const registry = new CompatibilityProviderRegistry<object>('test service');
    expect(registry.get()).toBeNull();
  });

  test('preserves the single-provider compatibility path', () => {
    const registry = new CompatibilityProviderRegistry<{ id: string }>('test service');
    const service = { id: 'one' };
    const registration = registry.register({}, () => service);

    expect(registry.get()).toBe(service);
    expect(registry.size).toBe(1);

    registration.unregister();
    registration.unregister();
    expect(registry.get()).toBeNull();
  });

  test('replaces a provider registered by the same owner', () => {
    const registry = new CompatibilityProviderRegistry<{ id: string }>('test service');
    const owner = {};
    const stale = registry.register(owner, () => ({ id: 'stale' }));
    const current = registry.register(owner, () => ({ id: 'current' }));

    expect(registry.size).toBe(1);
    expect(registry.get()).toEqual({ id: 'current' });

    stale.unregister();
    expect(registry.get()).toEqual({ id: 'current' });
    current.unregister();
    expect(registry.get()).toBeNull();
  });

  test('fails explicitly when more than one provider is configured', () => {
    const registry = new CompatibilityProviderRegistry<{ id: string }>('test service');
    const first = registry.register({}, () => ({ id: 'one' }));
    const second = registry.register({}, () => null);

    expect(() => registry.get()).toThrow(ZeroRuntimeAmbiguousError);
    try {
      registry.get();
    } catch (error) {
      expect(error).toBeInstanceOf(ZeroRuntimeAmbiguousError);
      expect((error as ZeroRuntimeAmbiguousError).code).toBe(ZERO_RUNTIME_AMBIGUOUS);
      expect((error as ZeroRuntimeAmbiguousError).providerCount).toBe(2);
    }

    first.unregister();
    expect(registry.get()).toBeNull();
    second.unregister();
  });
});
