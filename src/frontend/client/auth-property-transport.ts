/** Transport and local-store synchronization for current-user properties. */

import { AuthClientError, createAuthClientError } from './auth-errors';

export interface AuthPropertyTransportOptions {
  baseUrl: string;
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  patchProperties: (response: Response, properties: Record<string, string>) => void;
  replaceProperties: (response: Response, properties: Record<string, string>) => void;
  removeProperty: (response: Response, key: string) => void;
  /** Local authorization family; old-account completions cannot invalidate new-account reads. */
  authorityKey?: () => string | null;
}

export class AuthPropertyTransport {
  private epoch: { authority: string | null; revision: number } | undefined;
  constructor(private readonly options: AuthPropertyTransportOptions) {}

  async setProperty(key: string, value: unknown): Promise<void> {
    const epoch = this.captureEpoch(); epoch.revision++;
    try {
      const response = await this.options.authenticatedFetch(this.propertyUrl(key), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      if (!response.ok) throw await responseError(response, 'Failed to set property');
      this.options.patchProperties(response, { [key]: serializeAuthPropertyValue(value) });
    } finally { epoch.revision++; }
  }

  async getProperty(key: string): Promise<string | null> {
    const epoch = this.captureEpoch(), revision = epoch.revision;
    const response = await this.options.authenticatedFetch(this.propertyUrl(key));
    if (response.status === 404) {
      this.assertReadCurrent(epoch, revision);
      this.options.removeProperty(response, key);
      return null;
    }
    if (!response.ok) throw await responseError(response, 'Failed to get property');

    const data = await response.json();
    this.assertReadCurrent(epoch, revision);
    this.options.patchProperties(response, { [key]: data.value });
    return data.value;
  }

  async getProperties(): Promise<Record<string, string>> {
    const epoch = this.captureEpoch(), revision = epoch.revision;
    const response = await this.options.authenticatedFetch(
      `${this.options.baseUrl}/auth/me/properties`,
    );
    if (!response.ok) throw await responseError(response, 'Failed to get properties');

    const data = await response.json();
    this.assertReadCurrent(epoch, revision);
    this.options.replaceProperties(response, data.properties);
    return data.properties;
  }

  async deleteProperty(key: string): Promise<void> {
    const epoch = this.captureEpoch(); epoch.revision++;
    try {
      const response = await this.options.authenticatedFetch(this.propertyUrl(key), {
        method: 'DELETE',
      });
      if (!response.ok) throw await responseError(response, 'Failed to delete property');
      this.options.removeProperty(response, key);
    } finally { epoch.revision++; }
  }

  private captureEpoch() {
    const authority = this.options.authorityKey?.() ?? null;
    if (!this.epoch || this.epoch.authority !== authority) this.epoch = { authority, revision: 0 };
    return this.epoch;
  }

  private assertReadCurrent(epoch: { authority: string | null; revision: number }, revision: number): void {
    if (this.captureEpoch() !== epoch || epoch.revision !== revision) throw new AuthClientError(
      'Settings changed while this read was in flight. Read the current settings again.',
      409, 'AUTH_PROPERTIES_READ_SUPERSEDED', null,
    );
  }

  private propertyUrl(key: string): string {
    return `${this.options.baseUrl}/auth/me/properties/${encodeURIComponent(key)}`;
  }
}

function serializeAuthPropertyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value) ?? String(value);
}

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return createAuthClientError(response, body, fallback);
}
