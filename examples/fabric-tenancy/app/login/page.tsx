'use client';

import { AuthLayout, LoginForm } from '@zero/framework/components/auth';

export default function LoginPage() {
  return (
    <AuthLayout appName="Fabric Tenancy">
      <LoginForm
        registerHref="/register"
        onSuccess={() => window.location.assign('/')}
      />
    </AuthLayout>
  );
}
