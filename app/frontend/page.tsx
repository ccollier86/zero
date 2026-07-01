'use client';

/**
 * page.tsx
 *
 * App-owned public frontend demo route for Zero's reusable public components.
 * This file owns route metadata and entry only; the demo composition lives in
 * frontend-demo-page.tsx.
 */

import { FrontendDemoPage } from './frontend-demo-page';

export const meta = {
  title: 'Zero Frontend Demo',
  description: 'A public-route demo of Zero frontend components and platform capabilities.',
};

export default function FrontendRoutePage() {
  return <FrontendDemoPage />;
}
