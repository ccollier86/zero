/** Execute serializable broker commands and return revision-bound snapshots. */

import type { NativeAuthBrokerStateChannel } from './broker-state-channel';
import type { NativeAuthBrokerRequest, NativeAuthBrokerResponse } from './broker-types';
import type { NativeAuthClient } from './client-types';
import { toNativeAuthError } from './errors';

export async function dispatchNativeAuthBrokerCommand(
  client: NativeAuthClient,
  channel: NativeAuthBrokerStateChannel,
  command: NativeAuthBrokerRequest,
  signal?: AbortSignal,
): Promise<NativeAuthBrokerResponse> {
  try {
    if (command.operation === 'initialize') await client.initialize();
    if (command.operation === 'signIn') await client.signIn({ loginHint: command.loginHint, signal });
    if (command.operation === 'signUp') await client.signUp({ loginHint: command.loginHint, signal });
    if (command.operation === 'completeAuthorization') {
      await client.completeAuthorization(command.callbackUrl, signal);
    }
    if (command.operation === 'refresh') await client.refresh();
    const tenantList = command.operation === 'listTenants'
      ? await client.listTenants()
      : undefined;
    if (command.operation === 'switchTenant') await client.switchTenant(command.tenantId);
    if (command.operation === 'signOut') await client.signOut();
    const accessToken = command.operation === 'getAccessToken'
      ? await stableAccessToken(client, channel) : undefined;
    return {
      ok: true,
      snapshot: channel.snapshot(),
      ...(accessToken !== undefined ? { accessToken } : {}),
      ...(tenantList !== undefined ? { tenantList } : {}),
    };
  } catch (error) {
    const safe = toNativeAuthError(error, 'NATIVE_BROKER_OPERATION_FAILED');
    return {
      ok: false,
      snapshot: channel.snapshot(),
      error: { code: safe.code, message: safe.message, status: safe.status },
    };
  }
}

async function stableAccessToken(
  client: NativeAuthClient,
  channel: NativeAuthBrokerStateChannel,
): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = channel.snapshot();
    const token = await client.getAccessToken();
    const after = channel.snapshot();
    if (after.state.status !== 'authenticated') return null;
    if (before.revision === after.revision) return token;
  }
  return null;
}
