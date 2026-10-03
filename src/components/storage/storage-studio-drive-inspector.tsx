'use client';

/** Drive-specific inspector tabs and default panel content. */

import * as React from 'react';
import { HardDrive } from 'lucide-react';
import {
  Tabs,
  TabsContent,
  TabsContents,
} from '../animate-ui/components/radix/tabs';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import type { StorageStudioDrive } from '../../storage/storage-studio-contracts';
import { formatStorageBytes } from './storage-format';
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

/** Render lifecycle, access, settings, usage, and jobs for one drive. */
export function StorageStudioDriveInspector({
  controller,
  drive,
  slots,
}: {
  controller: StorageManagementController;
  drive: StorageStudioDrive;
  slots?: StorageStudioInspectorSlots;
}) {
  return (
    <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
      <StorageInspectorHeader
        icon={<HardDrive className="size-5" aria-hidden="true" />}
        title={drive.drive.name}
        subtitle={drive.profile.ownerKind === 'user'
          ? 'Personal drive'
          : `${capitalizeStorageLabel(drive.profile.ownerKind)} drive`}
        badges={[drive.profile.lifecycle, drive.drive.public ? 'public' : 'private']}
      />
      <StorageInspectorTabs labels={['overview', 'access', 'settings', 'usage', 'jobs']} />
      <div className="min-h-0 flex-1 overflow-auto">
        <TabsContents mode="layout" className="min-h-full">
          <TabsContent value="overview" className="p-4">
            <DriveOverview drive={drive} />
          </TabsContent>
          <TabsContent value="access" className="p-4">
            {slots?.driveAccess?.(drive) ?? <DriveAccess drive={drive} />}
          </TabsContent>
          <TabsContent value="settings" className="p-4">
            {slots?.driveSettings?.(drive) ?? <DriveSettings controller={controller} drive={drive} />}
          </TabsContent>
          <TabsContent value="usage" className="p-4">
            {slots?.driveUsage?.(drive, controller.usage)
              ?? <DriveUsagePanel drive={drive} usage={controller.usage} />}
          </TabsContent>
          <TabsContent value="jobs" className="p-4">
            {slots?.driveJobs?.(drive, controller.jobs)
              ?? <DriveJobs jobs={controller.jobs} />}
          </TabsContent>
        </TabsContents>
      </div>
    </Tabs>
  );
}

function DriveOverview({ drive }: { drive: StorageStudioDrive }) {
  return (
    <StorageInspectorSection title="Drive overview" description="Identity and current provisioning state.">
      <StorageInspectorRows rows={[
        ['Key', drive.profile.key],
        ['Owner', `${capitalizeStorageLabel(drive.profile.ownerKind)} · ${drive.profile.ownerId}`],
        ['Scope', capitalizeStorageLabel(drive.profile.scopeKind)],
        ['Isolation', drive.profile.isolation],
        ['Generation', String(drive.profile.generation)],
        ['Revision', String(drive.profile.revision)],
        ['Created', formatStorageInspectorDate(drive.profile.createdAt)],
        ['Ready', drive.profile.readyAt ? formatStorageInspectorDate(drive.profile.readyAt) : 'Not ready'],
      ]} />
      {drive.profile.failureCode && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {drive.profile.failureCode}
        </div>
      )}
    </StorageInspectorSection>
  );
}

function DriveAccess({ drive }: { drive: StorageStudioDrive }) {
  const access = drive.drive.access;
  return (
    <StorageInspectorSection title="Effective access" description="Capabilities resolved for the current authorization scope.">
      <div className="grid grid-cols-2 gap-2">
        <StorageCapability label="Read" enabled={access.canRead} />
        <StorageCapability label="Write" enabled={access.canWrite} />
        <StorageCapability label="Admin" enabled={access.canAdmin} />
        <StorageCapability label="Owner" enabled={access.isOwner} />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Effective level: <span className="font-medium text-foreground">{access.effectiveAccess ?? 'None'}</span>
      </p>
    </StorageInspectorSection>
  );
}

function DriveSettings({
  controller,
  drive,
}: {
  controller: StorageManagementController;
  drive: StorageStudioDrive;
}) {
  return (
    <StorageInspectorSection title="Drive settings" description="Limits and visibility for this drive.">
      <StorageInspectorRows rows={[
        ['Visibility', drive.drive.public ? 'Public read' : 'Private'],
        ['Drive limit', drive.drive.max_size_bytes > 0 ? formatStorageBytes(drive.drive.max_size_bytes) : 'Unlimited'],
        ['File limit', drive.drive.max_file_size_bytes > 0 ? formatStorageBytes(drive.drive.max_file_size_bytes) : 'Unlimited'],
        ['MIME types', drive.drive.allowed_mime_types || '*'],
        ['Mutable', drive.control.canManage && controller.operations.renameDrive ? 'Yes' : 'No'],
      ]} />
    </StorageInspectorSection>
  );
}

function DriveUsagePanel({
  drive,
  usage,
}: {
  drive: StorageStudioDrive;
  usage: StorageManagementController['usage'];
}) {
  if (!usage) return <StorageInspectorEmpty label="Usage is not available for this drive yet." />;
  return (
    <StorageInspectorSection title="Storage usage" description="Current logical object usage.">
      <div className="mb-2 flex items-end justify-between gap-3">
        <span className="text-xl font-semibold tabular-nums">{formatStorageBytes(usage.totalBytes)}</span>
        <span className="text-xs text-muted-foreground">
          {usage.maxBytes > 0 ? `${formatStorageBytes(usage.maxBytes)} limit` : 'Unlimited'}
        </span>
      </div>
      {usage.maxBytes > 0 && <Progress value={usage.percentUsed} className="mb-4" />}
      <StorageInspectorRows rows={[
        ['Files', String(usage.fileCount)],
        ['Folders', String(usage.folderCount)],
        ['Isolation', drive.profile.isolation],
      ]} />
    </StorageInspectorSection>
  );
}

function DriveJobs({ jobs }: { jobs: StorageManagementController['jobs'] }) {
  if (jobs.length === 0) return <StorageInspectorEmpty label="No lifecycle jobs for this drive." />;
  return (
    <StorageInspectorSection title="Lifecycle jobs" description="Provisioning and maintenance activity.">
      <div className="divide-y divide-border/80 rounded-lg border border-border/80">
        {jobs.map((job) => (
          <div key={job.id} className="p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{job.label}</span>
              <Badge variant="outline" className="capitalize">{job.status}</Badge>
            </div>
            {job.detail && <p className="mt-1 text-xs text-muted-foreground">{job.detail}</p>}
            {typeof job.progress === 'number' && <Progress value={job.progress} className="mt-2" />}
          </div>
        ))}
      </div>
    </StorageInspectorSection>
  );
}
