'use client';

import * as React from 'react';
import type { AuthAdminConfig, AuthAdminUpdateUserParams } from '../../../frontend/client/auth-client';
import { FieldRenderer } from '../../forms/field-renderer';
import { Button } from '../../ui/button';
import { useForm } from '../../../hooks/use-form';
import { useModalForm } from '../../../modals/modal-form';
import type { ModalContext } from '../../../modals/modal-system.types';
import { createUserManagementSchema } from './user-management-schema';
import { toAdminUserUpdateParams } from './user-management-mappers';
import type { UserManagementUser, UserRoleOption } from './user-management-types';

export interface TenantAccountEditFormProps {
  user: UserManagementUser;
  config: AuthAdminConfig;
  roleOptions: readonly UserRoleOption[];
  editableFields: readonly string[];
  onSubmit(changes: AuthAdminUpdateUserParams): Promise<void>;
  onSuccess(): void;
  modalContext?: ModalContext<UserManagementUser>;
  formId?: string;
}

/** Focused account-profile editor opened from the shared record action bar. */
export function TenantAccountEditForm({
  user,
  config,
  roleOptions,
  editableFields,
  onSubmit,
  onSuccess,
  modalContext, formId,
}: TenantAccountEditFormProps) {
  const schema = React.useMemo(
    () => createUserManagementSchema(
      roleOptions,
      config.tenancy?.mode === 'multi' ? 'Global identity role' : 'Role',
    ),
    [config.tenancy?.mode, roleOptions],
  );

  const form = useForm<UserManagementUser>({ schema, mode: 'edit', defaultValues: user,
    includeFields: editableFields, baseline: 'accepted', scopeKey: user.userId,
    onSubmit: values => onSubmit(toAdminUserUpdateParams(values)),
    onSuccess: modalContext ? undefined : onSuccess });
  if (modalContext) return <ManagedAccountEditFields form={form} context={modalContext} formId={formId} />;
  return <AccountEditFields form={form} formId={formId} onSubmit={form.handleSubmit} />;
}

function ManagedAccountEditFields({ form, context, formId }: {
  form: ReturnType<typeof useForm<UserManagementUser>>; context: ModalContext<UserManagementUser>; formId?: string;
}) {
  const binding = useModalForm({ form, context });
  return <AccountEditFields form={form} formId={formId} onSubmit={binding.onSubmit} managed />;
}

function AccountEditFields({ form, formId, onSubmit, managed = false }: {
  form: ReturnType<typeof useForm<UserManagementUser>>; formId?: string;
  onSubmit: React.FormEventHandler<HTMLFormElement>; managed?: boolean;
}) {
  return <form id={formId} className="space-y-4" onSubmit={onSubmit} aria-busy={form.isSubmitting}>
    <div className="grid gap-4 sm:grid-cols-2">{form.fieldNames.map(name => {
      const meta = form.getFieldMeta(name);
      return meta ? <FieldRenderer key={name} name={name} meta={meta} registration={form.register(name)} /> : null;
    })}</div>
    {!managed && form.submitError && <p role="alert" className="text-sm text-destructive">{form.submitError}</p>}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={form.reset} disabled={form.isSubmitting || !form.isDirty}>Reset</Button>
      {!managed && <Button type="submit" disabled={form.isSubmitting}>Save account</Button>}
    </div>
  </form>;
}
