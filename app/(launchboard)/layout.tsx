'use client';

/**
 * layout.tsx
 *
 * URL-less LaunchBoard layout branch. The route group keeps LaunchBoard at `/`
 * while proving that app chrome can live in a route-owned layout instead of
 * the root provider layout.
 */

import type { ReactNode } from 'react';

import { LaunchBoardShell } from '../launchboard/launchboard-shell';

export default function LaunchBoardLayout({ children }: { children?: ReactNode }) {
  return <LaunchBoardShell>{children}</LaunchBoardShell>;
}
