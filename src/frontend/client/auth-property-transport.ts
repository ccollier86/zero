/** Transport and local-store synchronization for current-user properties. */

import { createAuthClientError } from './auth-errors';

export interface AuthPropertyTransportOptions {
  baseUrl: string;
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  patchProperties: (properties: Record<string, string>) => void;
  replaceProperties: (properties: Record<string, string>) => void;
  removeProperty: (key: string) => void;
}

export class AuthPropertyTransport {
  constructor(private readonly options: AuthPropertyTransportOptions) {}

  async setProperty(key: string, value: unknown): Promise<void> {
    const response = await this.options.authenticatedFetch(this.propertyUrl(key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (!response.ok) throw await responseError(response, 'Failed to set property');
    this.options.patchProperties({ [key]: serializeAuthPropertyValue(value) });
  }

  async getProperty(key: string): Promise<string | null> {
    const response = await this.options.authenticatedFetch(this.propertyUrl(key));
    if (response.status === 404) return null;
    if (!response.ok) throw await responseError(response, 'Failed to get property');

    const data = await response.json();
    this.options.patchProperties({ [key]: data.value });
    return data.value;
  }

  async getProperties(): Promise<Record<string, string>> {
    const response = await this.options.authenticatedFetch(
      `${this.options.baseUrl}/auth/me/properties`,
    );
    if (!response.ok) throw await responseError(response, 'Failed to get properties');

    const data = await response.json();
    this.options.replaceProperties(data.properties);
    return data.properties;
  }

  async deleteProperty(key: string): Promise<void> {
    const response = await this.options.authenticatedFetch(this.propertyUrl(key), {
      method: 'DELETE',
    });
    if (!response.ok) throw await responseError(response, 'Failed to delete property');
    this.options.removeProperty(key);
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
