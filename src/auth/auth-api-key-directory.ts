/** Bounded, secret-free API-key management read model. */

import type { AuthApiKeyAuthority, AuthApiKeyBinding } from './auth-api-key-authority';
import { normalizeAuthApiKeyPage, pageCursor } from './auth-api-key-pagination';
import type { AuthApiKeyStore } from './auth-api-key-store';
import type {
  AuthApiKeyListQuery,
  AuthApiKeyManagementCapabilities,
  AuthApiKeyPage,
  AuthApiKeyRecord,
  AuthApiKeySummary,
} from './auth-api-key-types';

export class AuthApiKeyDirectory {
  constructor(private readonly options: {
    readonly store: AuthApiKeyStore;
    readonly authority: AuthApiKeyAuthority;
    readonly now: () => number;
  }) {}

  listUserBinding(
    userId: string,
    binding: AuthApiKeyBinding,
    query: AuthApiKeyListQuery,
    capabilities: AuthApiKeyManagementCapabilities,
  ): AuthApiKeyPage {
    const page = normalizeAuthApiKeyPage(query);
    const records = this.options.store.listForUserScope(
      userId,
      binding.scopeKind,
      binding.scopeId,
      { ...page, limit: page.limit + 1 },
    );
    return this.projectPage(records, page.limit, capabilities);
  }

  listPlatform(
    query: AuthApiKeyListQuery,
    capabilities: AuthApiKeyManagementCapabilities,
    tenantId?: string,
  ): AuthApiKeyPage {
    const page = normalizeAuthApiKeyPage(query);
    const records = tenantId
      ? this.options.store.listForTenant(tenantId, { ...page, limit: page.limit + 1 })
      : this.options.store.listAll({ ...page, limit: page.limit + 1 });
    return this.projectPage(records, page.limit, capabilities);
  }

  summarize(record: AuthApiKeyRecord, now = this.options.now()): AuthApiKeySummary {
    return Object.freeze({
      keyId: record.keyId,
      userId: record.userId,
      label: record.label,
      hint: record.secretHint,
      scopeKind: record.scopeKind,
      scopeId: record.scopeId,
      tenantId: record.tenantId,
      membershipId: record.membershipId,
      createdByUserId: record.createdByUserId,
      createdVia: record.createdVia,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      lastUsedAt: record.lastUsedAt,
      revokedAt: record.revokedAt,
      status: this.options.authority.status(record, now),
    });
  }

  private projectPage(
    records: AuthApiKeyRecord[],
    limit: number,
    capabilities: AuthApiKeyManagementCapabilities,
  ): AuthApiKeyPage {
    const hasMore = records.length > limit;
    const visible = hasMore ? records.slice(0, limit) : records;
    const now = this.options.now();
    return Object.freeze({
      apiKeys: Object.freeze(visible.map((record) => this.summarize(record, now))),
      capabilities: Object.freeze({ ...capabilities }),
      page: Object.freeze({
        limit,
        count: visible.length,
        hasMore,
        nextCursor: hasMore ? pageCursor(visible.at(-1)) : null,
      }),
    });
  }
}
