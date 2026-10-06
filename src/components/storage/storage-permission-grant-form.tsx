'use client';

/** Shared, policy-aware grant input for drive and exact-object ACL editors. */

import * as React from 'react';
import { LoaderCircle, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { AuthAdminUserPropertyConfig } from '../../frontend/client/auth-client';
import type {
  GrantPermissionParams,
  GrantType,
  PermissionLevel,
} from '../../storage/types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { useStorageAuthConfig } from './use-storage-auth-config';

export interface StoragePermissionGrantFormProps {
  readonly title: string;
  readonly description: string;
  readonly disabled?: boolean;
  readonly onGrant: (
    grant: Omit<GrantPermissionParams, 'objectPath'>,
  ) => void | Promise<void>;
}

/** Collect one role, user, or trusted-property grant. */
export function StoragePermissionGrantForm({
  title,
  description,
  disabled = false,
  onGrant,
}: StoragePermissionGrantFormProps) {
  const { config, loading: configLoading, error: configError } = useStorageAuthConfig(true);
  const [grantType, setGrantType] = React.useState<GrantType>('role');
  const [grantKey, setGrantKey] = React.useState('');
  const [grantValue, setGrantValue] = React.useState('');
  const [permission, setPermission] = React.useState<PermissionLevel>('read');
  const [submitting, setSubmitting] = React.useState(false);
  const submitPending = React.useRef(false);
  const policyProperties = React.useMemo(
    () => Object.values(config?.userProperties ?? {})
      .filter((field) => field.useInPolicies),
    [config],
  );
  const configuredRoles = React.useMemo(() => configuredStorageRoles(config), [config]);
  const selectedProperty = policyProperties.find((field) => field.key === grantKey) ?? null;

  React.useEffect(() => {
    if (grantType === 'property' && policyProperties.length === 0) {
      setGrantType('role');
      setGrantKey('');
      setGrantValue('');
    } else if (grantType === 'property' && !grantKey) {
      setGrantKey(policyProperties[0]!.key);
      setGrantValue('');
    } else if (grantType !== 'property' && grantKey) {
      setGrantKey('');
    }
  }, [grantKey, grantType, policyProperties]);
  React.useEffect(() => {
    if (grantType === 'role'
      && configuredRoles.length > 0
      && grantValue
      && !configuredRoles.some((role) => role.key === grantValue)) {
      setGrantValue('');
    }
  }, [configuredRoles, grantType, grantValue]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || submitPending.current) return;
    const value = grantValue.trim();
    const key = grantKey.trim();
    if (!value) {
      toast.error('Grant value is required');
      return;
    }
    if (grantType === 'property' && !key) {
      toast.error('Property key is required');
      return;
    }
    if (grantType === 'role'
      && configuredRoles.length > 0
      && !configuredRoles.some((role) => role.key === value)) {
      toast.error('Choose a configured role');
      return;
    }
    submitPending.current = true;
    setSubmitting(true);
    try {
      await onGrant({
        grantType,
        ...(grantType === 'property' ? { grantKey: key } : {}),
        grantValue: value,
        permission,
      });
      setGrantValue('');
    } catch {
      // The owning panel reports standardized storage errors and retains input.
    } finally {
      submitPending.current = false;
      setSubmitting(false);
    }
  };

  return (
    <form data-slot="storage-permission-grant-form" className="min-w-0 rounded-lg border border-border/80 bg-card p-3" onSubmit={submit} aria-busy={submitting}>
      <div className="mb-3 min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2.5">
        <PermissionField label="Grant type">
          {(id) => <Select
            value={grantType}
            disabled={disabled || submitting}
            onValueChange={(value) => {
              setGrantType(value as GrantType);
              setGrantValue('');
            }}
          >
            <SelectTrigger id={id} className="min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="role">Role</SelectItem>
              <SelectItem value="user">User ID</SelectItem>
              {policyProperties.length > 0 && <SelectItem value="property">User property</SelectItem>}
            </SelectContent>
          </Select>}
        </PermissionField>
        <PermissionField label="Access level">
          {(id) => <Select
            value={permission}
            disabled={disabled || submitting}
            onValueChange={(value) => setPermission(value as PermissionLevel)}
          >
            <SelectTrigger id={id} className="min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="read">Read</SelectItem>
              <SelectItem value="write">Write</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>}
        </PermissionField>
      </div>
      <div className="mt-2.5 flex min-w-0 flex-wrap items-end gap-2.5">
        <div className="min-w-0 flex-1 basis-48">
          <GrantTargetField
            grantType={grantType}
            grantKey={grantKey}
            grantValue={grantValue}
            selectedProperty={selectedProperty}
            policyProperties={policyProperties}
            configuredRoles={configuredRoles}
            disabled={disabled || submitting}
            onGrantKeyChange={(value) => {
              setGrantKey(value);
              setGrantValue('');
            }}
            onGrantValueChange={setGrantValue}
          />
        </div>
        <Button type="submit" size="sm" disabled={disabled || submitting || !grantValue.trim()} className="h-9 shrink-0">
          {submitting ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
          {submitting ? 'Saving…' : 'Grant'}
        </Button>
      </div>
      {!configLoading && policyProperties.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {configError
            ? 'Property grants are unavailable because Guardian policy configuration could not be loaded.'
            : 'Property grants are unavailable until a Guardian user property is enabled for policies.'}
        </p>
      )}
    </form>
  );
}

function GrantTargetField({
  grantType,
  grantKey,
  grantValue,
  selectedProperty,
  policyProperties,
  configuredRoles,
  disabled,
  onGrantKeyChange,
  onGrantValueChange,
}: {
  grantType: GrantType;
  grantKey: string;
  grantValue: string;
  selectedProperty: AuthAdminUserPropertyConfig | null;
  policyProperties: readonly AuthAdminUserPropertyConfig[];
  configuredRoles: readonly { readonly key: string; readonly label: string }[];
  disabled: boolean;
  onGrantKeyChange: (value: string) => void;
  onGrantValueChange: (value: string) => void;
}) {
  if (grantType !== 'property') {
    return (
      <PermissionField label={grantType === 'role' ? 'Role' : 'User ID'}>
        {(id) => grantType === 'role' && configuredRoles.length > 0 ? (
          <Select value={grantValue} disabled={disabled} onValueChange={onGrantValueChange}>
            <SelectTrigger id={id} className="min-w-0"><SelectValue placeholder="Select role" /></SelectTrigger>
            <SelectContent>
              {configuredRoles.map((role) => (
                <SelectItem key={role.key} value={role.key}>{role.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id={id}
            className="min-w-0"
            value={grantValue}
            disabled={disabled}
            maxLength={grantType === 'role' ? 100 : 200}
            onChange={(event) => onGrantValueChange(event.target.value)}
            placeholder={grantType === 'role' ? 'admin, user, manager' : 'usr_…'}
          />
        )}
      </PermissionField>
    );
  }
  const propertyValues = selectedProperty?.values ?? [];
  return (
    <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2.5">
      <PermissionField label="Property key">
        {(id) => <Select value={grantKey} disabled={disabled} onValueChange={onGrantKeyChange}>
          <SelectTrigger id={id} className="min-w-0"><SelectValue placeholder="Select property" /></SelectTrigger>
          <SelectContent>
            {policyProperties.map((field) => (
              <SelectItem key={field.key} value={field.key}>{field.label ?? field.key}</SelectItem>
            ))}
          </SelectContent>
        </Select>}
      </PermissionField>
      <PermissionField label="Property value">
        {(id) => propertyValues.length > 0 ? (
          <Select value={grantValue} disabled={disabled} onValueChange={onGrantValueChange}>
            <SelectTrigger id={id} className="min-w-0"><SelectValue placeholder="Select value" /></SelectTrigger>
            <SelectContent>
              {propertyValues.map((value) => (
                <SelectItem key={value} value={value}>{value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id={id}
            className="min-w-0"
            value={grantValue}
            disabled={disabled}
            maxLength={200}
            onChange={(event) => onGrantValueChange(event.target.value)}
            placeholder="accounting"
          />
        )}
      </PermissionField>
    </div>
  );
}

function configuredStorageRoles(config: unknown): readonly { key: string; label: string }[] {
  const authorization = (config as {
    readonly authorization?: {
      readonly roles?: Readonly<Record<string, {
        readonly label?: unknown;
        readonly assignable?: unknown;
      }>>;
    };
  } | null)?.authorization;
  return Object.freeze(Object.entries(authorization?.roles ?? {})
    .filter(([, role]) => role.assignable !== false)
    .map(([key, role]) => Object.freeze({
      key,
      label: typeof role.label === 'string' && role.label.trim() ? role.label : key,
    })));
}

function PermissionField({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = React.useId();
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium">{label}</Label>
      {children(id)}
    </div>
  );
}
