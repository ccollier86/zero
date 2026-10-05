'use client';

/**
 * storage-drive-settings-panel.tsx
 *
 * Renders mutable storage drive settings. This file owns settings form state
 * only; persistence is delegated to the parent storage drive view.
 */

import * as React from 'react';
import { toast } from 'sonner';
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
import { TagInput } from '../ui/tag-input';
import { cn } from '../../lib/utils';
import {
  formatStorageBytes,
  isStoragePublic,
  parseAllowedMimeTypes,
  parseStorageLimit,
} from './storage-format';
import type { StorageDriveRow } from './storage-management-types';

export interface StorageDriveSettingsPanelProps {
  drive: StorageDriveRow;
  disabled?: boolean;
  busy?: boolean;
  /** Permit changing a private drive to public; existing public drives can always be remediated. */
  allowPublicVisibility?: boolean;
  onSave: (changes: Partial<StorageDriveRow>) => Promise<void> | void;
}

/** Render storage drive settings with token-aware controls. */
export function StorageDriveSettingsPanel({
  drive,
  disabled = false,
  busy = false,
  allowPublicVisibility = true,
  onSave,
}: StorageDriveSettingsPanelProps) {
  const [name, setName] = React.useState(drive.name);
  const [maxSize, setMaxSize] = React.useState(String(drive.max_size_bytes ?? 0));
  const [maxFileSize, setMaxFileSize] = React.useState(String(drive.max_file_size_bytes ?? 0));
  const [visibility, setVisibility] = React.useState(isStoragePublic(drive.public) ? '1' : '0');
  const [mimeTypes, setMimeTypes] = React.useState(() =>
    drive.allowed_mime_types === '*'
      ? []
      : parseAllowedMimeTypes(drive.allowed_mime_types) ?? [],
  );
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setName(drive.name);
    setMaxSize(String(drive.max_size_bytes ?? 0));
    setMaxFileSize(String(drive.max_file_size_bytes ?? 0));
    setVisibility(isStoragePublic(drive.public) ? '1' : '0');
    setMimeTypes(drive.allowed_mime_types === '*'
      ? []
      : parseAllowedMimeTypes(drive.allowed_mime_types) ?? []);
  }, [drive]);

  const readonly = disabled || busy || saving;
  const allowedMimeTypes = mimeTypes.length > 0 ? mimeTypes.join(',') : '*';
  const driveIsPublic = isStoragePublic(drive.public);
  const showVisibility = allowPublicVisibility || driveIsPublic;

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmedName = name.trim();
      if (!trimmedName) {
        toast.error('Drive name is required');
        return;
      }
      const driveLimit = parseStorageLimit(maxSize.trim() || 0);
      const fileLimit = parseStorageLimit(maxFileSize.trim() || 0);
      if (driveLimit === undefined || fileLimit === undefined) {
        toast.error('Storage limits must be non-negative whole byte counts. Use 0 for unlimited.');
        return;
      }

      setSaving(true);
      try {
        await onSave({
          name: trimmedName,
          max_size_bytes: driveLimit,
          max_file_size_bytes: fileLimit,
          allowed_mime_types: allowedMimeTypes,
          ...(allowPublicVisibility || (driveIsPublic && visibility === '0')
            ? { public: visibility }
            : {}),
        });
      } catch {
        // The owning mutation/controller presents and observes the failure.
        // React's form event cannot await its rejected save callback.
      } finally {
        setSaving(false);
      }
    },
    [allowPublicVisibility, allowedMimeTypes, driveIsPublic, maxFileSize, maxSize, name, onSave, visibility],
  );

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      {disabled && (
        <div className="rounded-md border border-border/80 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          You can read this drive, but control-plane manage authority is required
          to change its settings. Data ACL admin access is managed separately.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <StorageSettingField label="Drive name" htmlFor="storage-drive-name">
          <Input
            id="storage-drive-name"
            value={name}
            disabled={readonly}
            onChange={(event) => setName(event.target.value)}
            placeholder="Project files"
          />
        </StorageSettingField>

        {showVisibility && (
          <StorageSettingField
            label="Visibility"
            hint={allowPublicVisibility ? 'Durable read policy' : 'Public access is disabled by policy'}
          >
            <Select value={visibility} onValueChange={setVisibility} disabled={readonly}>
              <SelectTrigger aria-label="Drive visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Private</SelectItem>
                <SelectItem value="1" disabled={!allowPublicVisibility}>Public read</SelectItem>
              </SelectContent>
            </Select>
          </StorageSettingField>
        )}

        <StorageSettingField
          label="Drive limit"
          htmlFor="storage-drive-max-size"
          hint={Number(maxSize) > 0 ? formatStorageBytes(Number(maxSize)) : 'Unlimited'}
        >
          <Input
            id="storage-drive-max-size"
            inputMode="numeric"
            value={maxSize}
            disabled={readonly}
            onChange={(event) => setMaxSize(event.target.value)}
            placeholder="0"
          />
        </StorageSettingField>

        <StorageSettingField
          label="Per-file limit"
          htmlFor="storage-drive-max-file-size"
          hint={Number(maxFileSize) > 0 ? formatStorageBytes(Number(maxFileSize)) : 'Unlimited'}
        >
          <Input
            id="storage-drive-max-file-size"
            inputMode="numeric"
            value={maxFileSize}
            disabled={readonly}
            onChange={(event) => setMaxFileSize(event.target.value)}
            placeholder="0"
          />
        </StorageSettingField>
      </div>

      <StorageSettingField
        label="Allowed MIME types"
        hint={mimeTypes.length === 0 ? 'All file types are accepted.' : allowedMimeTypes}
      >
        <TagInput
          value={mimeTypes}
          onChange={setMimeTypes}
          disabled={readonly}
          placeholder="image/*, application/pdf"
          suggestions={[
            'image/*',
            'application/pdf',
            'text/plain',
            'text/csv',
            'application/json',
            'video/*',
            'audio/*',
          ]}
        />
      </StorageSettingField>

      <div className="flex justify-end">
        <Button type="submit" disabled={readonly}>
          {saving ? 'Saving...' : 'Save settings'}
        </Button>
      </div>
    </form>
  );
}

function StorageSettingField({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
