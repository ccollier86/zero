/** Test-only NativeAuthClient double shared by broker regression suites. */

import type {
  NativeAuthClient,
  NativeAuthState,
  NativeAuthStateListener,
  NativeTenantListResult,
} from './client-types';
import { NativeAuthError } from './errors';

export class FakeNativeClient implements NativeAuthClient {
  state: NativeAuthState = { status: 'uninitialized', identity: null, error: null };
  initializeCalls = 0;
  refreshCalls = 0;
  accessToken: string | null = 'access-one';
  private listeners = new Set<NativeAuthStateListener>();

  async initialize() { this.initializeCalls += 1; await Bun.sleep(5); this.authenticate(); return this.state; }
  async refresh() { this.refreshCalls += 1; await Bun.sleep(5); this.accessToken = 'access-two'; return this.state; }
  async listTenants(): Promise<NativeTenantListResult> {
    return { activeTenantId: null, tenants: [] };
  }
  async switchTenant(_tenantId: string): Promise<NativeAuthState> { return this.state; }
  async signIn() { this.authenticate(); return this.state; }
  async signUp(): Promise<NativeAuthState> {
    throw new NativeAuthError('Registration blocked.', 'REGISTRATION_BLOCKED', 403);
  }
  async completeAuthorization() { this.authenticate(); return this.state; }
  getUser() { return this.state.identity; }
  async getAccessToken() { return this.accessToken; }
  async fetch() { return new Response(); }
  async signOut() { this.accessToken = null; this.setState({ status: 'anonymous', identity: null, error: null }); }
  subscribe(listener: NativeAuthStateListener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  authenticate() {
    this.setState({
      status: 'authenticated', error: null,
      identity: { sub: 'user-1', iss: 'https://app.example.test/auth', aud: 'desktop',
        exp: 9999999999, iat: 1 },
    });
  }

  setState(state: NativeAuthState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
