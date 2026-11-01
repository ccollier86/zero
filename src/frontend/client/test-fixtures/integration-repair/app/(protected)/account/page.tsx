'use client';
import { UserProfileSettings } from '@zero/framework/components/profile-settings';
import { UserPropertiesForm } from '@zero/framework/components/auth';

export const config = { auth: 'admin' };
export const meta = { title: 'Synthetic account' };
export default function Account() { return <section data-testid="protected-account"><h1>Synthetic account</h1>
  <UserProfileSettings mode="full" saveMode="page" additionalProperties={false} />
  <UserPropertiesForm title="Professional profile" disableSaveWhenUnchanged />
</section>; }
