'use client';

import type { ReactNode } from 'react';
import type { RouteConfig } from '@zero/framework/react';

import { DashboardShell } from '../components/dashboard-shell';

/** Server and browser routing both require a Guardian session for this branch. */
export const config: RouteConfig = {
  auth: 'required',
};

export default function DashboardLayout({ children }: { children?: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
