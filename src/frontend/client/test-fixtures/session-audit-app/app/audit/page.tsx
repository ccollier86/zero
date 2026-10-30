'use client';
import { LoggingWorkspace } from '@zero/framework/components/logging';
export const config = { auth: 'admin' };
export default function Audit() { return <main data-testid="native-audit-workspace"><h1>Synthetic activity investigation</h1><LoggingWorkspace allowExport={false} /></main>; }
