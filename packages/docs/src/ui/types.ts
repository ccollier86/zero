import type { CodeBlockHighlightResult } from '@zero/framework/react';
import type { DocsNavigationEntry, DocsPage } from '../content/types';
import type { DocsMatchRange } from '../search/text';
export type { DocsMatchRange } from '../search/text';

/** Public presentation only. Filesystem roots and unpublished content never enter these props. */
export interface DocsPresentation {
  readonly title: string;
  readonly basePath: string;
  readonly breadcrumbs: boolean;
  readonly search: boolean;
  readonly toc: boolean;
  readonly pageNavigation: boolean;
  readonly headerLinks: readonly { readonly label: string; readonly href: string }[];
  readonly editUrl?: string;
  readonly themeStorageKey: string;
}
export interface DocsSearchResult {
  readonly route: string;
  readonly pageRoute: string;
  /** Public navigation pathname only, never an absolute filesystem/source path. */
  readonly path: string;
  /** Immutable page identity binds a transient destination highlight to this exact search snapshot. */
  readonly pageHash?: string;
  readonly title: string;
  readonly section?: string;
  readonly excerpt: string;
  readonly passageId?: string;
  readonly sectionPath?: readonly string[];
  readonly matches?: {
    readonly title: readonly DocsMatchRange[];
    readonly section?: readonly DocsMatchRange[];
    readonly excerpt: readonly DocsMatchRange[];
  };
}
export interface DocsPageLink { readonly route: string; readonly title: string }
export interface DocsPageProps {
  readonly presentation: DocsPresentation;
  readonly page: DocsPage;
  readonly navigation: readonly DocsNavigationEntry[];
  /** Ordered by occurrence of the code nodes in the page's allowlisted AST. */
  readonly highlights: readonly (CodeBlockHighlightResult | null)[];
  readonly previous?: DocsPageLink;
  readonly next?: DocsPageLink;
  readonly nonce?: string;
}
