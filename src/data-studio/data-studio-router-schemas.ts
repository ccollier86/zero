/** Shared transport schemas for Data Studio's HTTP surface. */

import { t } from 'elysia';
import { DATA_STUDIO_MAX_COLUMNS } from './data-studio-contracts';

export const DATA_STUDIO_ID_SCHEMA = t.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$',
});

const operationIdSchema = t.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
});

export const DATA_STUDIO_REVISION_SCHEMA = t.Integer({ minimum: 1 });
export const DATA_STUDIO_STATUS_SCHEMA = t.Union([
  t.Literal('active'),
  t.Literal('archived'),
]);
export const DATA_STUDIO_VALUES_SCHEMA = t.Record(
  t.String({ minLength: 1, maxLength: 64 }),
  t.Unknown(),
);

const columnSchema = t.Object({
  columnId: t.String({
    minLength: 1,
    maxLength: 64,
    pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$',
  }),
  key: t.String({
    minLength: 1,
    maxLength: 64,
    pattern: '^[a-z][a-z0-9_]*$',
  }),
  label: t.String({ minLength: 1, maxLength: 120 }),
  type: t.Union([
    t.Literal('text'),
    t.Literal('number'),
    t.Literal('boolean'),
    t.Literal('date'),
    t.Literal('datetime'),
    t.Literal('json'),
  ]),
  required: t.Boolean(),
  description: t.Optional(t.String({ minLength: 1, maxLength: 500 })),
  defaultValue: t.Optional(t.Unknown()),
}, { additionalProperties: false });

export const DATA_STUDIO_LOGICAL_SCHEMA = t.Object({
  version: t.Literal(1),
  columns: t.Array(columnSchema, { maxItems: DATA_STUDIO_MAX_COLUMNS }),
}, { additionalProperties: false });

export const DATA_STUDIO_MUTATION_FIELDS = Object.freeze({
  operationId: operationIdSchema,
});
