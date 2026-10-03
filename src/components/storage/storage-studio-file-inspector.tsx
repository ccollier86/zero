'use client';

/** File/folder-specific inspector tabs and inline metadata presentation. */

import * as React from 'react';
import { File, Folder, Globe2, Image as ImageIcon, KeyRound, LockKeyhole } from 'lucide-react';
import {
  Tabs,
  TabsContent,
  TabsContents,
} from '../animate-ui/components/radix/tabs';
import { InlineEditText } from '../ui/inline-edit-text';
import { Button } from '../ui/button';
import type { FileInfo } from '../../storage/types';
import { formatStorageBytes } from './storage-format';
import { StorageFilePreview } from './storage-file-preview';
import type {
  StorageManagementController,
  StorageStudioInspectorSlots,
} from './storage-management-controller';
import {
  capitalizeStorageLabel,
  formatStorageInspectorDate,
  StorageCapability,
  StorageInspectorEmpty,
  StorageInspectorHeader,
  StorageInspectorRows,
  StorageInspectorSection,
  StorageInspectorTabs,
} from './storage-studio-inspector-primitives';

/** Render preview, details, access, and sharing for one file or folder. */
export function StorageStudioFileInspector({
  controller,
  file,
  slots,
}: {
  controller: StorageManagementController;
  file: FileInfo;
  slots?: StorageStudioInspectorSlots;
}) {
  const drivePublic = controller.selectedDrive?.drive.public === 1;
  const effectivePublic = drivePublic
    || file.isPublic
    || controller.selectedFileAccess?.isPublic === true;
  const icon = file.type === 'folder'
    ? <Folder className="size-5" aria-hidden="true" />
    : file.mimeType?.startsWith('image/')
      ? <ImageIcon className="size-5" aria-hidden="true" />
      : <File className="size-5" aria-hidden="true" />;

  return (
    <Tabs defaultValue="details" className="flex min-h-0 flex-1 flex-col">
      <StorageInspectorHeader
        icon={icon}
        title={file.name}
        subtitle={file.mimeType ?? capitalizeStorageLabel(file.type)}
        badges={[
          effectivePublic
            ? drivePublic && !file.isPublic ? 'public via drive' : 'public'
            : 'private',
        ]}
      />
      <StorageInspectorTabs labels={['preview', 'details', 'access', 'sharing']} />
      <div className="min-h-0 flex-1 overflow-auto">
        <TabsContents mode="layout" className="min-h-full">
          <TabsContent value="preview" className="p-4">
            {slots?.filePreview?.(file) ?? (controller.selectedDrive
              ? <StorageFilePreview driveId={controller.selectedDrive.drive.drive_id} file={file} />
              : <StorageInspectorEmpty label="Choose a drive to preview this object." />)}
          </TabsContent>
          <TabsContent value="details" className="p-4">
            <FileDetails controller={controller} file={file} />
          </TabsContent>
          <TabsContent value="access" className="p-4">
            {slots?.fileAccess?.(file) ?? <FileAccess controller={controller} />}
          </TabsContent>
          <TabsContent value="sharing" className="p-4">
            {slots?.fileSharing?.(file) ?? <StorageStudioFileSharing controller={controller} file={file} />}
          </TabsContent>
        </TabsContents>
      </div>
    </Tabs>
  );
}

function FileDetails({
  controller,
  file,
}: {
  controller: StorageManagementController;
  file: FileInfo;
}) {
  const metadataEntries = Object.entries(file.metadata ?? {});
  const canEdit = controller.selectedFileAccess?.canWrite === true
    && Boolean(controller.operations.updateFileMetadata);
  return (
    <div className="space-y-5">
      <StorageInspectorSection title="Object details">
        <StorageInspectorRows rows={[
          ['Path', file.path],
          ['Type', file.mimeType ?? capitalizeStorageLabel(file.type)],
          ['Size', file.type === 'folder' ? '—' : formatStorageBytes(file.sizeBytes)],
          ['Checksum', file.checksum ? `${file.checksum.slice(0, 20)}…` : 'N/A'],
          ['Created', formatStorageInspectorDate(file.createdAt)],
          ['Updated', formatStorageInspectorDate(file.updatedAt)],
        ]} />
      </StorageInspectorSection>

      <StorageInspectorSection
        title="Metadata"
        description={canEdit ? 'Select a value to edit it in place.' : 'Custom object metadata.'}
      >
        {metadataEntries.length === 0 ? (
          <StorageInspectorEmpty label="No custom metadata." compact />
        ) : (
          <div className="divide-y divide-border/80 rounded-lg border border-border/80">
            {metadataEntries.map(([key, value], index) => (
              <div key={key} className="grid grid-cols-[minmax(5rem,0.8fr)_minmax(0,1.2fr)] items-center gap-2 px-2 py-1.5 text-xs">
                <span className="truncate text-muted-foreground">{key}</span>
                <InlineEditText
                  value={formatMetadataValue(value)}
                  revision={file.updatedAt}
                  label={`${key} metadata`}
                  disabled={!canEdit}
                  onCommit={(draft) => controller.operations.updateFileMetadata?.(file, {
                    ...file.metadata,
                    [key]: parseMetadataValue(draft),
                  })}
                  onReload={controller.refresh}
                  onNavigate={(direction) => focusMetadataOffset(metadataEntries, index, direction)}
                />
              </div>
            ))}
          </div>
        )}
      </StorageInspectorSection>
    </div>
  );
}

function FileAccess({ controller }: { controller: StorageManagementController }) {
  const access = controller.selectedFileAccess;
  if (!access) return <StorageInspectorEmpty label="Access details are unavailable." />;
  return (
    <StorageInspectorSection title="Effective access" description="Capabilities resolved for this path.">
      <div className="grid grid-cols-2 gap-2">
        <StorageCapability label="Read" enabled={access.canRead} />
        <StorageCapability label="Write" enabled={access.canWrite} />
        <StorageCapability label="Admin" enabled={access.canAdmin} />
        <StorageCapability label="Public" enabled={access.isPublic} />
      </div>
    </StorageInspectorSection>
  );
}

export function StorageStudioFileSharing({
  controller,
  file,
}: {
  controller: StorageManagementController;
  file: FileInfo;
}) {
  const publicObjectsAllowed = controller.capabilities?.policy.allowPublicObjects === true;
  const canAdmin = controller.selectedFileAccess?.canAdmin === true;
  const drivePublic = controller.selectedDrive?.drive.public === 1;
  const effectivePublic = drivePublic
    || file.isPublic
    || controller.selectedFileAccess?.isPublic === true;
  const pending = controller.busy || controller.loading || controller.status === 'loading';
  return (
    <div className="space-y-5">
      {(publicObjectsAllowed || effectivePublic || file.isPublic) && (
        <StorageInspectorSection title="Public visibility" description="Effective visibility and the object-level flag are tracked separately.">
          <div className="flex items-center gap-3 rounded-lg border border-border/80 bg-muted/20 p-3">
            {effectivePublic
              ? <Globe2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
              : <LockKeyhole className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {effectivePublic ? 'Effectively public' : 'Effectively private'}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {drivePublic
                  ? `Inherited from the public drive. Object flag: ${file.isPublic ? 'public' : 'private'}. Make the drive private before restricting this object.`
                  : `Object flag: ${file.isPublic ? 'public' : 'private'}. ${canAdmin ? 'You can change durable object visibility.' : 'Storage ACL admin access is required to change it.'}`}
              </p>
            </div>
            {(publicObjectsAllowed || file.isPublic) && controller.operations.setFileVisibility && (
              <Button
                size="sm"
                variant="outline"
                disabled={!canAdmin || pending || drivePublic}
                onClick={() => {
                  void Promise.resolve(
                    controller.operations.setFileVisibility?.(file, !file.isPublic),
                  ).catch(() => {
                    // Controller state and standardized observability surface failures.
                  });
                }}
              >
                {drivePublic ? 'Drive is public' : file.isPublic ? 'Make private' : 'Make public'}
              </Button>
            )}
          </div>
        </StorageInspectorSection>
      )}
      <StorageInspectorSection title="Temporary link" description="Short-lived links do not change durable object visibility.">
        <div className="flex items-start gap-3 rounded-lg border border-border/80 bg-muted/20 p-3">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">Presigned download</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {file.type === 'file' && controller.operations.share
                ? 'Use Share in the action bar to copy an approved, expiring link.'
                : file.type === 'folder'
                  ? 'Folder download links are not supported; grant access from the Access tab.'
                  : 'Sharing is not enabled by this storage controller.'}
            </p>
          </div>
        </div>
      </StorageInspectorSection>
    </div>
  );
}

function focusMetadataOffset(
  entries: [string, unknown][],
  index: number,
  direction: -1 | 1,
) {
  const target = entries[index + direction];
  if (!target) return;
  document.querySelector<HTMLElement>(
    `[aria-label^="Edit ${escapeSelectorValue(target[0])} metadata"]`,
  )?.focus();
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? '');
  }
}

function parseMetadataValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function escapeSelectorValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
