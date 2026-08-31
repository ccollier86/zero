'use client';

/**
 * storage-drive-list.tsx
 *
 * Renders and wires the storage drive management view. This file owns drive UI
 * orchestration only; storage transport lives in storage hooks and field
 * metadata lives in storage-drive-schema.
 */

import * as React from 'react';
import { FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { AnimateIcon } from '../animate-ui/icons/icon';
import { Eye } from '../animate-ui/icons/eye';
import { EyeOff } from '../animate-ui/icons/eye-off';
import { Trash } from '../animate-ui/icons/trash';
import { MasterDetailPage } from '../master-detail';
import type { NavigationAction } from '../ui/record-navigation-bar';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { modals } from '../../modals';
import { useStorageActions, useStorageDrives } from '../../storage/storage-hooks';
import type { DriveRecord } from '../../storage/types';
import {
  isStoragePublic,
  parseAllowedMimeTypes,
  parseStorageLimit,
} from './storage-format';
import { openStorageNameDialog } from './storage-name-dialog';
import { reportStorageActionError } from './storage-observability';
import { StorageDriveDetail } from './storage-drive-detail';
import { StorageDriveDetailHeader } from './storage-drive-detail-header';
import {
  storageDriveListColumns,
  storageDriveSchema,
} from './storage-drive-schema';
import type { StorageDriveRow } from './storage-management-types';

export interface StorageDriveListProps {
  onBrowse: (driveId: string) => void;
  className?: string;
}

/** Render a fully wired drive list and detail editor. */
export function StorageDriveList({ onBrowse, className }: StorageDriveListProps) {
  const { drives, loading, error, refresh } = useStorageDrives();
  const actions = useStorageActions();
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const data = React.useMemo(() => drives.map(toStorageDriveRow), [drives]);

  const runAction = React.useCallback(
    async (
      action: string,
      task: () => Promise<void>,
      metadata?: Record<string, unknown>,
      rethrow = false,
    ) => {
      setBusy(true);
      setActionError(null);
      try {
        await task();
      } catch (err) {
        const normalized = reportStorageActionError(action, err, metadata);
        setActionError(normalized.message);
        toast.error(normalized.message);
        if (rethrow) throw normalized;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const handleCreate = React.useCallback(() => {
    void runAction('createDrive', async () => {
      const name = await openStorageNameDialog({
        title: 'New drive',
        label: 'Drive name',
        placeholder: 'Project files',
        submitLabel: 'Create drive',
      });
      if (!name) return;
      await actions.createDrive(name);
      refresh();
      toast.success('Drive created');
    });
  }, [actions, refresh, runAction]);

  const handleDelete = React.useCallback(
    (drive: StorageDriveRow) => {
      void runAction('deleteDrive', async () => {
        const confirmed = await modals.confirm({
          title: 'Delete drive?',
          description: `${drive.name} and all files inside it will be deleted.`,
          confirmLabel: 'Delete',
          variant: 'destructive',
          holdToConfirm: true,
        });
        if (!confirmed) return;
        await actions.deleteDrive(drive.id);
        refresh();
        toast.success('Drive deleted');
      }, { driveId: drive.id });
    },
    [actions, refresh, runAction],
  );

  const handleToggleVisibility = React.useCallback(
    (drive: StorageDriveRow) => {
      void runAction('setDriveVisibility', async () => {
        const nextPublic = !isStoragePublic(drive.public);
        await actions.setVisibility(drive.id, nextPublic);
        refresh();
        toast.success(nextPublic ? 'Drive is public' : 'Drive is private');
      }, { driveId: drive.id });
    },
    [actions, refresh, runAction],
  );

  const handleUpdate = React.useCallback(
    (driveId: string, changes: Partial<StorageDriveRow>) => {
      return runAction('updateDrive', async () => {
        const current = data.find((drive) => drive.id === driveId);
        const updateParams = toDriveUpdateParams(changes);
        if (Object.keys(updateParams).length > 0) {
          await actions.updateDrive(driveId, updateParams);
        }

        if (Object.prototype.hasOwnProperty.call(changes, 'public')) {
          const nextPublic = isStoragePublic(changes.public);
          if (!current || isStoragePublic(current.public) !== nextPublic) {
            await actions.setVisibility(driveId, nextPublic);
          }
        }

        refresh();
        toast.success('Drive updated');
      }, { driveId }, true);
    },
    [actions, data, refresh, runAction],
  );

  const navigationActions = React.useCallback(
    (drive: StorageDriveRow | null): NavigationAction[] => [
      {
        icon: <FolderOpen size={20} />,
        label: 'Browse Files',
        variant: 'default',
        onClick: () => { if (drive) onBrowse(drive.id); },
        disabled: busy || !drive || drive.access?.canRead === false,
      },
      {
        icon: isStoragePublic(drive?.public) ? (
          <AnimateIcon animate>
            <EyeOff size={20} />
          </AnimateIcon>
        ) : (
          <AnimateIcon animate>
            <Eye size={20} />
          </AnimateIcon>
        ),
        label: isStoragePublic(drive?.public) ? 'Make Private' : 'Make Public',
        variant: 'default',
        onClick: () => { if (drive) handleToggleVisibility(drive); },
        disabled: busy || !drive || drive.access?.canAdmin !== true,
      },
      {
        icon: (
          <AnimateIcon animateOnHover>
            <Trash size={20} />
          </AnimateIcon>
        ),
        label: 'Delete',
        variant: 'destructive',
        onClick: () => { if (drive) handleDelete(drive); },
        disabled: busy || !drive || drive.access?.canAdmin !== true,
      },
    ],
    [busy, handleDelete, handleToggleVisibility, onBrowse],
  );

  return (
    <div className={cn('flex h-full min-h-[32rem] flex-col gap-3', className)}>
      {(error || actionError) && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span className="min-w-0 truncate">{actionError ?? error}</span>
          <Button size="sm" variant="outline" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}

      <MasterDetailPage<StorageDriveRow>
        schema={storageDriveSchema}
        listColumns={storageDriveListColumns}
        primaryKey="id"
        data={data}
        detailHeader={({ item }) => <StorageDriveDetailHeader drive={item} />}
        renderDetail={(item) => (
          <StorageDriveDetail
            drive={item}
            busy={busy}
            onSave={handleUpdate}
            onRefresh={refresh}
          />
        )}
        navigationActions={navigationActions}
        emptyStateText={loading ? 'Loading drives...' : 'No drives yet. Create one to get started.'}
        primaryAction={{
          label: loading ? 'Loading' : 'New Drive',
          shortcut: 'Cmd+N',
          disabled: loading || busy,
          onClick: handleCreate,
        }}
        onUpdate={handleUpdate}
        onUpdateError={(message) => toast.error(message)}
        className="min-h-0 flex-1"
      />
    </div>
  );
}

function toStorageDriveRow(record: DriveRecord & { access?: StorageDriveRow['access'] }): StorageDriveRow {
  return {
    id: record.drive_id,
    name: record.name,
    max_size_bytes: record.max_size_bytes,
    max_file_size_bytes: record.max_file_size_bytes,
    allowed_mime_types: record.allowed_mime_types,
    public: record.public,
    owner_id: record.owner_id,
    access: record.access,
  };
}

interface StorageDriveUpdateParams {
  name?: string;
  maxSize?: number;
  maxFileSize?: number;
  allowedMimeTypes?: string[];
}

function toDriveUpdateParams(changes: Partial<StorageDriveRow>): StorageDriveUpdateParams {
  const updates: {
    name?: string;
    maxSize?: number;
    maxFileSize?: number;
    allowedMimeTypes?: string[];
  } = {};

  if (typeof changes.name === 'string') updates.name = changes.name;
  if (Object.prototype.hasOwnProperty.call(changes, 'max_size_bytes')) {
    updates.maxSize = parseStorageLimit(changes.max_size_bytes);
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'max_file_size_bytes')) {
    updates.maxFileSize = parseStorageLimit(changes.max_file_size_bytes);
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'allowed_mime_types')) {
    updates.allowedMimeTypes = parseAllowedMimeTypes(changes.allowed_mime_types);
  }

  return updates;
}
