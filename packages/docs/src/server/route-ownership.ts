/** Root-mounted documentation preserves the platform's centrally owned API/system namespaces. */
import { isReservedAppRoutePath } from '@zero/framework/server';
import type { DocsManifest } from '../content/types';
import { docsFailure } from '../content/errors';

export function assertDocsPlatformRoutes(manifest: DocsManifest): void {
  if (manifest.basePath !== '/') return;
  for (const page of manifest.pages) if (isReservedAppRoutePath(page.route)) docsFailure('DOCS_ROUTE_CONFLICT', 'A documentation page claims a reserved Zero platform/API route.', { sourcePath: page.sourcePath ?? undefined, field: 'slug' });
  for (const redirect of manifest.redirects) if (isReservedAppRoutePath(redirect.from)) docsFailure('DOCS_ROUTE_CONFLICT', 'A documentation redirect claims a reserved Zero platform/API route.', { field: 'redirects' });
}
