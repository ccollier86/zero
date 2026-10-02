'use client';

import { AuthLayout, RegisterForm } from '@zero/framework/components/auth';

export default function RegisterPage() {
  return (
    <AuthLayout appName="Fabric Tenancy">
      <RegisterForm
        loginHref="/login"
        onSuccess={() => window.location.assign('/')}
      />
    </AuthLayout>
  );
}
