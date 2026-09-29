import { describe, expect, test } from 'bun:test';
import type { NativeFetch } from './adapter-types';
import { FakeNativeClient } from './broker-test-support';
import type { NativeAuthBrokerRequest } from './broker-types';
import { createNativeAuthBrokerClient } from './native-auth-broker-client';
import { createNativeAuthBroker } from './native-auth-broker';
import type { NativeOidcMetadata } from './oidc-types';
import { testMetadata } from './test-provider';
import { listNativeTenants, switchNativeTenant } from './token-endpoint';

const tenantA = {
  tenantId: 'tenant-a', kind: 'administration' as const,
  slug: 'tenant-a', name: 'Tenant A', role: 'owner',
};
const tenantB = {
  tenantId: 'tenant-b', kind: 'organization' as const,
  slug: 'tenant-b', name: 'Tenant B', role: 'member',
};

describe('native tenant-session SDK', () => {
  test('uses only the broker-held refresh proof for list and switch transport', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch: NativeFetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/tenants')) {
        return Response.json({ activeTenantId: tenantA.tenantId, tenants: [tenantA, tenantB] });
      }
      return Response.json({
        access_token: 'access-b',
        refresh_token: 'refresh-b',
        id_token: 'id-b',
        expires_in: 300,
        token_type: 'Bearer',
        active_tenant: tenantB,
      });
    };
    const client = {
      metadata: tenantMetadata(), clientId: 'desktop-test', fetch,
    };

    expect(await listNativeTenants(client, 'refresh-a')).toEqual({
      activeTenantId: 'tenant-a', tenants: [tenantA, tenantB],
    });
    expect(await switchNativeTenant(client, 'refresh-a', 'tenant-b')).toMatchObject({
      accessToken: 'access-b', refreshToken: 'refresh-b', activeTenant: tenantB,
    });

    expect(calls.map((call) => call.url)).toEqual([
      'https://zero.example/auth/tenants',
      'https://zero.example/auth/tenants/switch',
    ]);
    expect(calls.map((call) => new Headers(call.init?.headers).get('authorization')))
      .toEqual([null, null]);
    expect(calls.map((call) => call.init?.credentials)).toEqual(['omit', 'omit']);
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]!.init?.body)))).toEqual({
      refresh_token: 'refresh-a', client_id: 'desktop-test',
    });
    expect(Object.fromEntries(new URLSearchParams(String(calls[1]!.init?.body)))).toEqual({
      refresh_token: 'refresh-a', client_id: 'desktop-test', tenant_id: 'tenant-b',
    });
  });

  test('keeps refresh credentials out of broker commands and publishes cloned tenant state', async () => {
    const owner = new FakeNativeClient();
    owner.authenticate();
    owner.listTenants = async () => ({ activeTenantId: 'tenant-a', tenants: [tenantA, tenantB] });
    owner.switchTenant = async (tenantId: string) => {
      owner.setState({ ...owner.state, activeTenant: { ...tenantB, tenantId } });
      return owner.state;
    };
    const broker = createNativeAuthBroker(owner);
    const commands: NativeAuthBrokerRequest[] = [];
    const proxy = createNativeAuthBrokerClient({
      serverUrl: 'https://app.example.test',
      transport: {
        subscribeState: broker.subscribeState,
        request(command, options) {
          commands.push(command);
          return broker.request(command, options);
        },
      },
    });

    expect(await proxy.listTenants()).toEqual({
      activeTenantId: 'tenant-a', tenants: [tenantA, tenantB],
    });
    await proxy.switchTenant('tenant-b');
    expect(proxy.state.activeTenant).toEqual(tenantB);
    expect(commands).toEqual([
      { operation: 'listTenants' },
      { operation: 'switchTenant', tenantId: 'tenant-b' },
    ]);
    expect(JSON.stringify(commands)).not.toContain('refresh');

    const published = owner.state.activeTenant!;
    (published as { name: string }).name = 'mutated after publish';
    expect(proxy.state.activeTenant?.name).toBe('Tenant B');
    proxy.dispose();
  });

  test('fails closed when discovery does not advertise tenant-session support', async () => {
    const client = {
      metadata: testMetadata(),
      clientId: 'desktop-test',
      fetch: async () => Response.json({}),
    };
    await expect(listNativeTenants(client, 'refresh-a')).rejects.toMatchObject({
      code: 'OIDC_TENANT_SESSIONS_UNSUPPORTED',
    });
  });
});

function tenantMetadata(): NativeOidcMetadata {
  return {
    ...testMetadata(),
    zero_tenant_sessions: {
      version: 1,
      list_endpoint: 'https://zero.example/auth/tenants',
      switch_endpoint: 'https://zero.example/auth/tenants/switch',
      proof: 'refresh_token',
    },
  };
}
