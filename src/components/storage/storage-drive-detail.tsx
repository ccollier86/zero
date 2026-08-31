'use client';

/**
 * storage-drive-detail.tsx
 *
 * Composes the storage drive detail surface. This file owns panel layout only;
 * settings and permission form responsibilities live in dedicated children.
 */

import * as React from 'react';
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from '../animate-ui/components/radix/tabs';
import { StorageDrivePermissionsPanel } from './storage-drive-permissions-panel';
import { StorageDriveSettingsPanel } from './storage-drive-settings-panel';
import type { StorageDriveRow } from './storage-management-types';

export interface StorageDriveDetailProps {
  drive: StorageDriveRow;
  busy?: boolean;
  onSave: (driveId: string, changes: Partial<StorageDriveRow>) => Promise<void> | void;
  onRefresh?: () => void;
}

/** Render settings and permission controls for one selected storage drive. */
export function StorageDriveDetail({
  drive,
  busy = false,
  onSave,
  onRefresh,
}: StorageDriveDetailProps) {
  const canAdmin = drive.access?.canAdmin === true;

  return (
    <Tabs defaultValue="settings" className="mt-2 min-h-0">
      <TabsList className="w-full sm:w-auto">
        <TabsTrigger value="settings">Settings</TabsTrigger>
        <TabsTrigger value="permissions">Permissions</TabsTrigger>
      </TabsList>
      <TabsContents>
        <TabsContent value="settings" className="pt-4">
          <StorageDriveSettingsPanel
            drive={drive}
            busy={busy}
            disabled={!canAdmin}
            onSave={(changes) => onSave(drive.id, changes)}
          />
        </TabsContent>
        <TabsContent value="permissions" className="pt-4">
          <StorageDrivePermissionsPanel
            driveId={drive.id}
            canAdmin={canAdmin}
            onChanged={onRefresh}
          />
        </TabsContent>
      </TabsContents>
    </Tabs>
  );
}
