'use client';
import { LoggingWorkspace } from '@zero/framework/components/logging';

export const config = { auth: 'admin' };
export const meta = { title: 'Synthetic audit' };
export default function Audit() { return <section data-testid="protected-audit"><h1>Synthetic audit</h1>
  <LoggingWorkspace defaultStream="audit" scope="current" />
</section>; }
