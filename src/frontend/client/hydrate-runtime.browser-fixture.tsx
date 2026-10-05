/** Synthetic app-generated manifest with controllably delayed route modules. */

import * as React from 'react';
import { startHydration } from './hydrate-runtime';
import { useRouter } from './router-context';
import { useRouteAuthRequirement } from './route-auth-context';

const releases = new Map<string, () => void>();
const loading: string[] = [];

function Page({ name, params }: { name: string; params?: Record<string, string> }) {
  const router = useRouter();
  const requirement = useRouteAuthRequirement();
  window.__hydrationHarness.push = router.push;
  return <main data-page={name} data-auth={String(requirement)} data-params={JSON.stringify(params)}>{name}</main>;
}

function delayed(name: string, auth: false | 'admin' = false) {
  loading.push(name);
  return new Promise<{ default: (props: { params?: Record<string, string> }) => React.ReactNode; config: { auth: false | 'admin' } }>((resolve) => {
    releases.set(name, () => resolve({ default: (props) => <Page {...props} name={name} />, config: { auth } }));
  });
}

window.__hydrationHarness = {
  push: () => { throw new Error('The synthetic root is not ready.'); },
  release: (name) => releases.get(name)?.(),
  loading,
};
window.__ROUTE_DATA__ = { pattern: '/', params: {}, loaderData: null, renderMode: 'client' };

void startHydration({
  routes: [
    { pattern: '/', load: async () => ({ default: () => <Page name="home" /> }), layouts: [] },
    { pattern: '/slow/[id]', load: () => delayed('slow', 'admin'), layouts: [] },
    { pattern: '/fast/[id]', load: () => delayed('fast'), layouts: [] },
    { pattern: '/empty', load: () => {
      loading.push('empty');
      return new Promise<{ default?: never }>((resolve) => releases.set('empty', () => resolve({})));
    }, layouts: [] },
  ],
  serverRoutes: ['/server'],
});

declare global {
  interface Window {
    __hydrationHarness: { push(path: string): void; release(name: string): void; loading: string[] };
    __hydrationTestUnmount(): void;
  }
}
