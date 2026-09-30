'use client';

import { AuthLayout, RegisterForm } from '@zero/framework/components/auth';
import { useRouter } from '@zero/framework/react/hooks';

export const meta = {
  title: 'Create account | Guardian + Fabric Proof',
  description: 'Bootstrap or join the Guardian multi-tenant proof application.',
};

/** Public registration route that adapts to Guardian's bootstrap state. */
export default function RegisterPage() {
  const router = useRouter();

  return (
    <AuthLayout appName="Guardian + Fabric Proof">
      <RegisterForm
        fields={['email', 'firstName', 'lastName', 'password']}
        loginHref="/login"
        onSuccess={() => router.replace('/app')}
      />
    </AuthLayout>
  );
}
