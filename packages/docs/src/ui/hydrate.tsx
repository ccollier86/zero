/** Enhancement entry: server content and ordinary navigation remain useful with JavaScript disabled. */
import { hydrateRoot } from 'react-dom/client';
import { DocsApp } from './docs-app';
import type { DocsPageProps } from './types';
import { emitFrontendCode, FRONTEND_OBS_CODES } from '@zero/framework/react';

const root = document.getElementById('zero-docs-root'), data = document.getElementById('zero-docs-props');
if (root && data?.textContent) {
  try {
    const props = JSON.parse(data.textContent) as DocsPageProps;
    hydrateRoot(root, <DocsApp {...props} />, {
      onRecoverableError: () => emitFrontendCode(FRONTEND_OBS_CODES.FRONTEND_DOCS_HYDRATION_FAILED, { metadata: { stage: 'hydrate' } }),
    });
  } catch {
    // Keep useful SSR in place; a malformed enhancement must not hide the article.
    emitFrontendCode(FRONTEND_OBS_CODES.FRONTEND_DOCS_HYDRATION_FAILED, { metadata: { stage: 'bootstrap' } });
  }
}
