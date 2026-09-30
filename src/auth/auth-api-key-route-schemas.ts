/** Elysia input schemas shared by API-key management route groups. */

import { t } from 'elysia';

export const authApiKeyIdSchema = t.String({
  minLength: 36,
  maxLength: 36,
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
});

export const authApiKeySubjectIdSchema = t.String({
  minLength: 1,
  maxLength: 200,
  pattern: '^[A-Za-z0-9_-]+$',
});

export const authApiKeyIssueBodySchema = t.Object({
  label: t.String({ minLength: 1, maxLength: 100 }),
  ttl: t.Optional(t.String({ minLength: 2, maxLength: 32 })),
}, { additionalProperties: false });

export const authApiKeyListQuerySchema = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
  cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
}, { additionalProperties: false });
