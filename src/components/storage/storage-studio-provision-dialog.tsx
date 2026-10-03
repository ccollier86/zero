'use client';

/**
 * storage-studio-provision-dialog.tsx
 *
 * Promise-backed form for one managed-drive provisioning request. It owns
 * draft input only; authority, quotas, idempotency, and persistence remain on
 * the server and in the controller mutation layer.
 */

import * as React from 'react';
import type {
  StorageStudioCapabilities,
  StorageStudioProvisionRequest,
} from '../../storage/storage-studio-contracts';
import { modals } from '../../modals';
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
import {
  defaultStorageStudioOwner,
  storageStudioDriveKey,
} from './storage-studio-controller-values';

export type StorageStudioProvisionDraft = Omit<StorageStudioProvisionRequest, 'operationId'>;

/** Open the native drive-provisioning form and resolve null on dismissal. */
export function openStorageStudioProvisionDialog(
  capabilities: StorageStudioCapabilities,
): Promise<StorageStudioProvisionDraft | null> {
  return new Promise((resolve) => {
    let settled = false;
    let modalId = '';
    const finish = (value: StorageStudioProvisionDraft | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
      if (modalId) modals.close(modalId);
    };
    modalId = modals.open({
      title: 'New storage drive',
      size: 'md',
      onClose: () => finish(null),
      content: (
        <StorageStudioProvisionForm
          capabilities={capabilities}
          onSubmit={(value) => finish(value)}
          onCancel={() => finish(null)}
        />
      ),
    });
  });
}

function StorageStudioProvisionForm({
  capabilities,
  onSubmit,
  onCancel,
}: {
  readonly capabilities: StorageStudioCapabilities;
  readonly onSubmit: (value: StorageStudioProvisionDraft) => void;
  readonly onCancel: () => void;
}) {
  const allowedOwners = capabilities.ownerChoices.filter((owner) => (
    owner === 'organization'
      ? capabilities.canProvisionOrganization
      : capabilities.canProvisionPersonal
  ));
  const [owner, setOwner] = React.useState<'organization' | 'personal' | null>(
    defaultStorageStudioOwner(capabilities),
  );
  const [name, setName] = React.useState('');
  const [key, setKey] = React.useState('');
  const [keyEdited, setKeyEdited] = React.useState(false);
  const [isPublic, setIsPublic] = React.useState(false);

  const updateName = React.useCallback((value: string) => {
    setName(value);
    if (!keyEdited) setKey(storageStudioDriveKey(value));
  }, [keyEdited]);
  const valid = Boolean(owner && name.trim() && /^[a-z][a-z0-9_-]{0,99}$/u.test(key));

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || !owner) return;
        onSubmit({
          owner,
          key,
          name: name.trim(),
          maxSize: capabilities.policy.defaultDriveSizeBytes,
          maxFileSize: capabilities.policy.defaultFileSizeBytes,
          public: capabilities.policy.allowPublicDrives && isPublic,
          creatorAccess: 'admin',
        });
      }}
    >
      <p className="text-sm text-muted-foreground">
        Create a stable, policy-managed drive in the current authorization scope.
      </p>

      {allowedOwners.length > 1 && (
        <ProvisionField label="Owner">
          <Select value={owner ?? undefined} onValueChange={(value) => setOwner(
            value as 'organization' | 'personal',
          )}>
            <SelectTrigger><SelectValue placeholder="Choose owner" /></SelectTrigger>
            <SelectContent>
              {allowedOwners.includes('organization') && (
                <SelectItem value="organization">Organization</SelectItem>
              )}
              {allowedOwners.includes('personal') && (
                <SelectItem value="personal">Personal</SelectItem>
              )}
            </SelectContent>
          </Select>
        </ProvisionField>
      )}

      <ProvisionField label="Name" htmlFor="storage-studio-drive-name">
        <Input
          id="storage-studio-drive-name"
          value={name}
          onChange={(event) => updateName(event.target.value)}
          placeholder="Workflow files"
          autoFocus
        />
      </ProvisionField>

      <ProvisionField
        label="Stable key"
        htmlFor="storage-studio-drive-key"
        description="Functions and workflows can resolve this key without storing a drive ID."
      >
        <Input
          id="storage-studio-drive-key"
          value={key}
          onChange={(event) => {
            setKeyEdited(true);
            setKey(event.target.value.toLowerCase());
          }}
          placeholder="workflow-files"
          pattern="[a-z][a-z0-9_-]{0,99}"
        />
      </ProvisionField>

      {capabilities.policy.allowPublicDrives && (
        <ProvisionField
          label="Visibility"
          description="Public read is durable. Private drives can still issue short-lived links."
        >
          <Select value={isPublic ? 'public' : 'private'} onValueChange={(value) => setIsPublic(value === 'public')}>
            <SelectTrigger aria-label="New drive visibility"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="private">Private</SelectItem>
              <SelectItem value="public">Public read</SelectItem>
            </SelectContent>
          </Select>
        </ProvisionField>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={!valid}>Create drive</Button>
      </div>
    </form>
  );
}

function ProvisionField({
  label,
  htmlFor,
  description,
  children,
}: {
  readonly label: string;
  readonly htmlFor?: string;
  readonly description?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {children}
    </div>
  );
}
