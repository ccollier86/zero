'use client';

/**
 * storage-drive-detail-header.tsx
 *
 * Renders the selected drive summary for the storage management organism. This
 * file owns drive presentation only; usage data is read through storage hooks.
 */

import * as React from 'react';
import { HardDrive } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import { useDriveUsage } from '../../storage/storage-hooks';
import { formatStorageBytes, isStoragePublic } from './storage-format';
import type { StorageDriveRow } from './storage-management-types';

export interface StorageDriveDetailHeaderProps {
  drive: StorageDriveRow;
  className?: string;
}

/** Render selected drive metadata, visibility, and usage summary. */
export function StorageDriveDetailHeader({
  drive,
  className,
}: StorageDriveDetailHeaderProps) {
  const { usage } = useDriveUsage(drive.id);
  const isPublic = isStoragePublic(drive.public);
  const usedBytes = usage?.totalBytes ?? 0;
  const maxBytes = usage?.maxBytes ?? drive.max_size_bytes ?? 0;
  const fileCount = usage?.fileCount ?? 0;
  const folderCount = usage?.folderCount ?? 0;
  const pct = maxBytes > 0 ? Math.min((usedBytes / maxBytes) * 100, 100) : 0;
  const accessLabel = drive.access?.effectiveAccess
    ? `${drive.access.effectiveAccess} access`
    : 'No access';

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center gap-3">
        <AnimatePresence mode="wait">
          <motion.div
            key={drive.id}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="flex size-12 items-center justify-center rounded-lg bg-primary/10"
          >
            <HardDrive className="size-6 text-primary" />
          </motion.div>
        </AnimatePresence>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{drive.name}</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={isPublic ? 'default' : 'secondary'}>
              {isPublic ? 'Public' : 'Private'}
            </Badge>
            {drive.access && (
              <Badge variant={drive.access.canAdmin ? 'default' : 'outline'}>
                {accessLabel}
              </Badge>
            )}
            {drive.access?.isOwner && <Badge variant="outline">Owner</Badge>}
            <span className="truncate">
              {drive.allowed_mime_types === '*' ? 'All file types' : drive.allowed_mime_types}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between gap-3 text-xs text-muted-foreground">
          <span>{formatStorageBytes(usedBytes)} used</span>
          <span>{maxBytes > 0 ? formatStorageBytes(maxBytes) : 'Unlimited'}</span>
        </div>
        {maxBytes > 0 && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <motion.div
              className={cn(
                'h-full rounded-full',
                pct > 90 ? 'bg-destructive' : pct > 70 ? 'bg-yellow-500' : 'bg-primary',
              )}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
        )}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>{fileCount} files</span>
          <span>{folderCount} folders</span>
          {maxBytes > 0 && <span>{pct.toFixed(1)}% used</span>}
        </div>
      </div>
    </div>
  );
}
