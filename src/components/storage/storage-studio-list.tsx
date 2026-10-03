'use client';

/** Dense drive catalog and folder listing for the Storage Studio workspace. */

import * as React from 'react';
import { File, Folder, HardDrive, LockKeyhole, Users } from 'lucide-react';
import { Badge } from '../ui/badge';
import { InlineEditText } from '../ui/inline-edit-text';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { cn } from '../../lib/utils';
import type { StorageStudioDrive } from '../../storage/storage-studio-contracts';
import type { FileInfo } from '../../storage/types';
import { formatStorageBytes } from './storage-format';
import type { StorageManagementController } from './storage-management-controller';
import { StorageStudioPaginationControls } from './storage-studio-pagination';

export interface StorageStudioListProps {
  readonly controller: StorageManagementController;
  readonly className?: string;
}

/** Render the drive catalog or current folder as one dense adaptive table. */
export function StorageStudioList({ controller, className }: StorageStudioListProps) {
  return (
    <section
      data-slot="storage-studio-list"
      data-view={controller.view}
      className={cn('flex min-h-0 min-w-0 flex-col bg-background', className)}
    >
      <div className="min-h-0 flex-1 overflow-auto">
        {controller.view === 'drives'
          ? <DriveCatalog controller={controller} />
          : <FileCatalog controller={controller} />}
      </div>
      <StorageStudioPaginationControls controller={controller} />
    </section>
  );
}

function DriveCatalog({ controller }: { controller: StorageManagementController }) {
  if ((controller.loading || controller.status === 'loading') && controller.drives.length === 0) {
    return <StorageListState icon={HardDrive} label="Loading drives…" />;
  }
  if (controller.drives.length === 0) {
    return (
      <StorageListState
        icon={HardDrive}
        label={controller.filters.search ? 'No drives match these filters.' : 'No drives yet.'}
        detail="Create a drive to give applications a durable place for files."
      />
    );
  }

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="hidden lg:table-cell">Owner</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden sm:table-cell">Access</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {controller.drives.map((drive, index) => {
          const selected = controller.selectedDrive?.drive.drive_id === drive.drive.drive_id;
          const canRename = drive.control.canManage && Boolean(controller.operations.renameDrive);
          return (
            <TableRow
              key={drive.drive.drive_id}
              data-storage-item-id={drive.drive.drive_id}
              data-state={selected ? 'selected' : undefined}
              className="cursor-default"
              tabIndex={0}
              aria-selected={selected}
              onClick={() => controller.selectDrive(drive.drive.drive_id)}
              onDoubleClick={() => {
                if (drive.drive.access.canRead && drive.profile.lifecycle === 'ready') {
                  controller.openDrive(drive.drive.drive_id);
                }
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                controller.selectDrive(drive.drive.drive_id);
              }}
            >
              <TableCell className="min-w-44 font-medium">
                <div className="flex min-w-0 items-center gap-2">
                  <HardDrive className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <InlineEditText
                    value={drive.drive.name}
                    revision={drive.profile.revision}
                    label="drive name"
                    disabled={!canRename || controller.busy || controller.status === 'loading'}
                    selected={selected}
                    className="min-w-0 flex-1"
                    onSelect={() => controller.selectDrive(drive.drive.drive_id)}
                    onCommit={(name) => controller.operations.renameDrive?.(drive, name)}
                    onReload={controller.refresh}
                    onNavigate={(direction) => selectDriveOffset(controller, index, direction)}
                  />
                </div>
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <OwnerLabel drive={drive} />
              </TableCell>
              <TableCell>
                <LifecycleBadge lifecycle={drive.profile.lifecycle} />
              </TableCell>
              <TableCell className="hidden sm:table-cell text-muted-foreground">
                {storageAccessLabel(drive)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function FileCatalog({ controller }: { controller: StorageManagementController }) {
  const selectedDrive = controller.selectedDrive;
  if (!selectedDrive) {
    return <StorageListState icon={HardDrive} label="Choose a drive to browse its files." />;
  }
  if ((controller.loading || controller.status === 'loading') && controller.files.length === 0) {
    return <StorageListState icon={Folder} label="Loading folder…" />;
  }
  if (controller.files.length === 0) {
    return (
      <StorageListState
        icon={Folder}
        label={controller.filters.search ? 'No files match this search.' : 'This folder is empty.'}
        detail="Upload a file or create a folder to get started."
      />
    );
  }

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="hidden md:table-cell">Type</TableHead>
          <TableHead className="w-28 text-right">Size</TableHead>
          <TableHead className="hidden xl:table-cell">Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {controller.files.map((file, index) => {
          const selected = controller.selectedFile?.id === file.id;
          const access = selected ? controller.selectedFileAccess : null;
          const canRename = selected
            && access?.canWrite === true
            && Boolean(controller.operations.renameFile);
          return (
            <TableRow
              key={file.id}
              data-storage-item-id={file.id}
              data-state={selected ? 'selected' : undefined}
              className="cursor-default"
              tabIndex={0}
              aria-selected={selected}
              onClick={() => controller.selectFile(file)}
              onDoubleClick={() => {
                if (file.type === 'folder') controller.openFolder(file.path);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (file.type === 'folder') controller.openFolder(file.path);
                else controller.selectFile(file);
              }}
            >
              <TableCell className="min-w-48 font-medium">
                <div className="flex min-w-0 items-center gap-2">
                  {file.type === 'folder' ? (
                    <Folder className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  ) : (
                    <File className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <InlineEditText
                    value={file.name}
                    revision={file.updatedAt}
                    label={`${file.type} name`}
                    disabled={!canRename || controller.busy || controller.status === 'loading'}
                    selected={selected}
                    className="min-w-0 flex-1"
                    onSelect={() => controller.selectFile(file)}
                    onCommit={(name) => controller.operations.renameFile?.(file, name)}
                    onReload={controller.refresh}
                    onNavigate={(direction) => selectFileOffset(controller, index, direction)}
                  />
                  {(selectedDrive.drive.public === 1 || file.isPublic) && (
                    <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
                      {selectedDrive.drive.public === 1 && !file.isPublic
                        ? 'Public via drive'
                        : 'Public'}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell text-muted-foreground">
                {file.mimeType ?? (file.type === 'folder' ? 'Folder' : 'Unknown')}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {file.type === 'folder' ? '—' : formatStorageBytes(file.sizeBytes)}
              </TableCell>
              <TableCell className="hidden xl:table-cell text-muted-foreground">
                {formatStorageDate(file.updatedAt)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function StorageListState({
  icon: Icon,
  label,
  detail,
}: {
  icon: typeof HardDrive;
  label: string;
  detail?: string;
}) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
      <span className="mb-3 flex size-10 items-center justify-center rounded-xl border border-border/80 bg-muted/45 text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-medium">{label}</p>
      {detail && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function OwnerLabel({ drive }: { drive: StorageStudioDrive }) {
  const personal = drive.profile.ownerKind === 'user';
  const Icon = personal ? LockKeyhole : Users;
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <Icon className="size-3.5" aria-hidden="true" />
      {personal ? 'Personal' : drive.profile.ownerKind === 'organization' ? 'Organization' : 'Application'}
    </span>
  );
}

function LifecycleBadge({
  lifecycle,
}: {
  lifecycle: StorageStudioDrive['profile']['lifecycle'];
}) {
  const variant = lifecycle === 'failed'
    ? 'destructive'
    : lifecycle === 'degraded' || lifecycle === 'suspended'
      ? 'warning'
      : lifecycle === 'ready'
        ? 'secondary'
        : 'outline';
  return (
    <Badge variant={variant} className="capitalize">
      {lifecycle}
    </Badge>
  );
}

function storageAccessLabel(drive: StorageStudioDrive): string {
  if (drive.drive.access.isOwner) return 'Owner';
  if (drive.drive.access.canAdmin) return 'Admin';
  if (drive.drive.access.canWrite) return 'Write';
  if (drive.drive.access.canRead) return 'Read';
  return 'None';
}

function selectDriveOffset(
  controller: StorageManagementController,
  index: number,
  direction: -1 | 1,
) {
  const next = controller.drives[index + direction];
  if (next) controller.selectDrive(next.drive.drive_id);
}

function selectFileOffset(
  controller: StorageManagementController,
  index: number,
  direction: -1 | 1,
) {
  const next = controller.files[index + direction];
  if (next) controller.selectFile(next);
}

function formatStorageDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
