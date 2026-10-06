/** Optional docs facade: installing it alone changes nothing; a native plugin declaration opts in. */
import { defineZeroPlugin } from '@zero/framework/server';
import type { ZeroPluginDefinition } from '@zero/framework/server';
import { applyDocsAppDefaults, resolveDocsOptions } from './options';
import type { DocsOptions } from './options';
import { canonicalDocsJson, docsHash } from './content/identity';
import { prepareDocsBuild } from './server/build';
import { setupDocs } from './server/setup';

export function docs(input: DocsOptions): ZeroPluginDefinition {
  const options = resolveDocsOptions(input);
  const explicitTitle = input.title !== undefined;
  return defineZeroPlugin({ name: options.name,
    build: { required: true, mountPaths: [options.basePath], identity: docsHash(canonicalDocsJson({ version: 1, options })), prepare: context => prepareDocsBuild(context, applyDocsAppDefaults(options, context.appIdentity, explicitTitle)) },
    setup: context => setupDocs(context, applyDocsAppDefaults(options, context.appIdentity, explicitTitle)) });
}
export type { DocsOptions } from './options';
export type { DocsManifest, DocsPage, DocsHeading, DocsNode, DocsNavigationEntry, DocsAsset, DocsCompilerLimits, DocsDiagnostic } from './content/types';
export { DocsContentError } from './content/errors';
