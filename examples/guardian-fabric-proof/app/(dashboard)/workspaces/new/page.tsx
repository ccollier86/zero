'use client';

import { TenantCreationForm } from '@zero/framework/components/auth';
import {
  Card,
  CardContent,
} from '@zero/framework/components/ui/card';
import { useRouter } from '@zero/framework/react/hooks';

export const meta = {
  title: 'Create workspace | Guardian + Fabric Proof',
  description: 'Create and activate a physically isolated customer workspace.',
};

/** Guardian creates the tenant, owner membership, and replacement session atomically. */
export default function CreateWorkspacePage() {
  const router = useRouter();

  return (
    <Card className="mx-auto max-w-xl">
      <CardContent className="pt-5">
        <TenantCreationForm onSuccess={() => router.replace('/app')} />
      </CardContent>
    </Card>
  );
}
