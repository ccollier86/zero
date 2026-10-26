/** Enhance SSR without starting auth or a second data client. A bootstrap failure must leave the public article readable. */
import { hydrateRoot } from 'react-dom/client';
import { BlogPublicPage } from '../components/blog/blog-public-page';
import type { BlogPublicPageModel } from './public-page-model';
import { emitFrontendCode, FRONTEND_OBS_CODES } from '../frontend/client/observability';

const root = document.getElementById('zero-blog-public-root'), source = document.getElementById('zero-blog-page-props');
if (root && source?.textContent) {
  try {
    const value = JSON.parse(source.textContent) as BlogPublicPageModel;
    if (value.version !== 1 || !Array.isArray(value.posts) || !Array.isArray(value.categories)) throw new Error('Invalid public page.');
    hydrateRoot(root, <BlogPublicPage {...value} />, { onRecoverableError: () => report('hydrate') });
  } catch { report('bootstrap'); }
}
function report(stage: 'hydrate' | 'bootstrap') {
  emitFrontendCode(FRONTEND_OBS_CODES.FRONTEND_HYDRATE_FAILED, { metadata: { component: 'blog-reader', stage } });
}
