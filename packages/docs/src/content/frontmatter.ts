/** Bounded YAML metadata admission; classification precedes Markdown-body parsing. */
import { parseDocument } from 'yaml';
import { docsFailure } from './errors';
import { freezeDocsValue } from './identity';

export interface DocsPageMetadata {
  readonly title?: string;
  readonly description?: string;
  readonly slug?: string;
  readonly semanticId?: string;
  readonly navigation: { readonly label?: string; readonly order?: number; readonly hidden: boolean };
  readonly searchable: boolean;
  readonly redirects: readonly string[];
  readonly extra: Readonly<Record<string, unknown>>;
}
export type DocsFrontmatter = { readonly admitted: false } | { readonly admitted: true; readonly body: string; readonly metadata: DocsPageMetadata };

export function admitDocsFrontmatter(source: string, sourcePath: string, maximum: number): DocsFrontmatter {
  const text = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
  let record: Record<string, unknown> = Object.create(null), body = text;
  if (text.startsWith('---\n')) {
    const ending = /^---[ \t]*$/gmu; ending.lastIndex = 4;
    const found = ending.exec(text);
    if (!found) docsFailure('DOCS_METADATA_INVALID', 'YAML frontmatter is missing its closing --- delimiter.', { sourcePath });
    const yaml = text.slice(4, found.index);
    if (new TextEncoder().encode(yaml).byteLength > maximum) docsFailure('DOCS_LIMIT_EXCEEDED', 'Frontmatter exceeds its admitted byte limit.', { sourcePath });
    try {
      const document = parseDocument(yaml, { schema: 'core', uniqueKeys: true });
      if (document.errors.length || document.warnings.length) throw new Error('Invalid YAML.');
      const value: unknown = document.toJS({ maxAliasCount: 0 });
      if (value !== null) record = plainRecord(value, sourcePath);
    } catch { docsFailure('DOCS_METADATA_INVALID', 'Frontmatter must contain one valid YAML mapping without aliases or custom tags.', { sourcePath }); }
    body = text.slice(found.index + found[0].length).replace(/^\n/u, '');
  }
  const visibility = optionalEnum(record.visibility, ['public', 'internal', 'private'], sourcePath, 'visibility');
  const access = optionalEnum(record.access, ['public', 'private', 'protected', 'internal'], sourcePath, 'access');
  const status = optionalEnum(record.status, ['draft', 'in-review', 'published', 'stable', 'supported', 'archived', 'complete', 'reviewed', 'verified'], sourcePath, 'status');
  const draft = optionalBoolean(record.draft, sourcePath, 'draft');
  if (visibility === 'internal' || visibility === 'private' || access && access !== 'public' || draft === true || status === 'draft' || status === 'in-review') return { admitted: false };

  const navigationInput = record.navigation ?? record.sidebar ?? {};
  const navigation = plainRecord(navigationInput, sourcePath, 'navigation');
  for (const key of Object.keys(navigation)) if (!['label', 'order', 'hidden'].includes(key)) docsFailure('DOCS_METADATA_INVALID', 'Navigation contains an unsupported option.', { sourcePath, field: `navigation.${key}` });
  const order = navigation.order ?? record.order;
  if (order !== undefined && (typeof order !== 'number' || !Number.isSafeInteger(order) || Math.abs(order) > 1_000_000)) docsFailure('DOCS_METADATA_INVALID', 'Navigation order must be a bounded integer.', { sourcePath, field: 'navigation.order' });
  const search = optionalBoolean(record.search, sourcePath, 'search'), searchable = optionalBoolean(record.searchable, sourcePath, 'searchable');
  if (search !== undefined && searchable !== undefined && search !== searchable) docsFailure('DOCS_METADATA_INVALID', 'search and searchable cannot disagree.', { sourcePath, field: 'search' });
  const redirects = record.redirects ?? [];
  if (!Array.isArray(redirects) || redirects.length > 100 || redirects.some(value => typeof value !== 'string' || !value.trim() || value.length > 1_024)) docsFailure('DOCS_METADATA_INVALID', 'redirects must be a bounded array of path strings.', { sourcePath, field: 'redirects' });
  const extra: Record<string, unknown> = Object.create(null);
  const known = new Set(['title', 'description', 'slug', 'id', 'navigation', 'sidebar', 'order', 'label', 'hideFromNavigation', 'search', 'searchable', 'redirects', 'visibility', 'access', 'status', 'draft']);
  for (const [key, value] of Object.entries(record)) {
    if (known.has(key)) continue;
    if (/^x[-_.:]|^[a-z][a-z0-9-]*[.:]/iu.test(key) || ['audience', 'applies_to', 'reviewed_against', 'maturity', 'system', 'feature', 'owner', 'type', 'version', 'license', 'tags'].includes(key)) extra[key] = safeMetadataValue(value, sourcePath, 0);
    else docsFailure('DOCS_METADATA_INVALID', 'Frontmatter contains an unknown option; custom metadata must use a namespace.', { sourcePath, field: key });
  }
  return freezeDocsValue({ admitted: true, body, metadata: {
    title: optionalText(record.title, 256, sourcePath, 'title'), description: optionalText(record.description, 2_000, sourcePath, 'description'),
    slug: optionalText(record.slug, 1_024, sourcePath, 'slug'), semanticId: optionalText(record.id, 256, sourcePath, 'id'),
    navigation: { label: optionalText(navigation.label ?? record.label, 256, sourcePath, 'navigation.label'),
      order: order as number | undefined, hidden: optionalBoolean(navigation.hidden ?? record.hideFromNavigation, sourcePath, 'navigation.hidden') ?? false },
    searchable: searchable ?? search ?? true, redirects: redirects as string[], extra,
  } });
}
function plainRecord(value: unknown, sourcePath: string, field?: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) docsFailure('DOCS_METADATA_INVALID', 'A plain metadata mapping was expected.', { sourcePath, field });
  if (Object.keys(value).some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) docsFailure('DOCS_METADATA_INVALID', 'Unsafe metadata keys are not supported.', { sourcePath, field });
  return value as Record<string, unknown>;
}
function optionalText(value: unknown, maximum: number, sourcePath: string, field: string): string | undefined {
  if (value === undefined) return;
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f]/u.test(value.trim())) docsFailure('DOCS_METADATA_INVALID', 'A bounded non-empty text value was expected.', { sourcePath, field });
  return value.trim();
}
function optionalBoolean(value: unknown, sourcePath: string, field: string): boolean | undefined {
  if (value === undefined) return;
  if (typeof value !== 'boolean') docsFailure('DOCS_METADATA_INVALID', 'A boolean value was expected.', { sourcePath, field });
  return value;
}
function optionalEnum(value: unknown, choices: readonly string[], sourcePath: string, field: string): string | undefined {
  if (value === undefined) return;
  if (typeof value !== 'string' || !choices.includes(value)) docsFailure('DOCS_METADATA_INVALID', 'The metadata classification value is not supported.', { sourcePath, field });
  return value;
}
function safeMetadataValue(value: unknown, sourcePath: string, depth: number): unknown {
  if (depth > 8) docsFailure('DOCS_LIMIT_EXCEEDED', 'Custom metadata is nested too deeply.', { sourcePath });
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 256) docsFailure('DOCS_LIMIT_EXCEEDED', 'Custom metadata has too many entries.', { sourcePath });
    return value.map(child => safeMetadataValue(child, sourcePath, depth + 1));
  }
  const record = plainRecord(value, sourcePath);
  if (Object.keys(record).length > 128) docsFailure('DOCS_LIMIT_EXCEEDED', 'Custom metadata has too many fields.', { sourcePath });
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, safeMetadataValue(child, sourcePath, depth + 1)]));
}
