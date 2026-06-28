'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { HardDrive } from 'lucide-react';
import type { DriveRow } from './storage-management-page';

export interface DriveDetailHeaderProps {
  drive: DriveRow;
  className?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return 'Unlimited';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function DriveDetailHeader({ drive, className }: DriveDetailHeaderProps) {
  const isPublic = drive.public === 1 || drive.public === '1';
  const usedBytes = drive._usedBytes ?? 0;
  const maxBytes = drive.max_size_bytes ?? 0;
  const pct = maxBytes > 0 ? Math.min((usedBytes / maxBytes) * 100, 100) : 0;

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
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={isPublic ? 'default' : 'secondary'}>
              {isPublic ? 'Public' : 'Private'}
            </Badge>
            <span>{drive.allowed_mime_types === '*' ? 'All types' : drive.allowed_mime_types}</span>
          </div>
        </div>
      </div>

      {/* Usage bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{formatBytes(usedBytes)} used</span>
          <span>{maxBytes > 0 ? formatBytes(maxBytes) : 'Unlimited'}</span>
        </div>
        {maxBytes > 0 && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <motion.div
              className={cn(
                'h-full rounded-full',
                pct > 90 ? 'bg-destructive' : pct > 70 ? 'bg-yellow-500' : 'bg-primary'
              )}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
        )}
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span>{drive._fileCount ?? 0} files</span>
          <span>{drive._folderCount ?? 0} folders</span>
          {maxBytes > 0 && <span>{pct.toFixed(1)}% used</span>}
        </div>
      </div>
    </div>
  );
}

export { DriveDetailHeader };
