/** Shared compiler label/target bounds; reject oversized identities rather than silently changing links. */
import { docsFailure } from './errors';

export const DOCS_MAX_LABEL_LENGTH = 256;
export const DOCS_MAX_ROUTE_LENGTH = 4_096;

/** Validate inferred labels just as strictly as configured labels before publishing a snapshot. */
export function assertDocsLabel(value: string, sourcePath?: string, field = 'title'): void {
  if (value.length > DOCS_MAX_LABEL_LENGTH) docsFailure('DOCS_LIMIT_EXCEEDED', 'A documentation title, heading or navigation label exceeds 256 characters.', { sourcePath, field });
}
/** Bound complete encoded public routes before reader/search projections duplicate their values. */
export function assertDocsRouteLength(value: string, sourcePath?: string): void {
  if (value.length > DOCS_MAX_ROUTE_LENGTH) docsFailure('DOCS_LIMIT_EXCEEDED', 'A public documentation route exceeds 4096 characters.', { sourcePath, field: 'slug' });
}
