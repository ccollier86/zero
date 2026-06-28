'use client';

/**
 * storage-file-detail-panel.tsx
 *
 * Renders details and actions for one selected storage item. This file owns
 * presentation and action dispatch only; confirmation, mutation, and transport
 * are owned by the parent file browser and storage hooks.
 */

import * as React from 'react';
import { File, Pencil } from 'lucide-react';
import { AnimateIcon } from '../animate-ui/icons/icon';
import { Download } from '../animate-ui/icons/download';
import { Eye } from '../animate-ui/icons/eye';
import { EyeOff } from '../animate-ui/icons/eye-off';
import { Trash } from '../animate-ui/icons/trash';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import type { FileInfo } from '../../storage/types';
import { formatStorageBytes } from './storage-format';

export interface StorageFileDetailPanelProps {
  file: FileInfo;
  downloadUrl: string;
  busy?: boolean;
  onRename: (file: FileInfo) => void;
  onToggleVisibility: (file: FileInfo) => void;
  onDelete: (file: FileInfo) => void;
}

/** Render selected file/folder metadata and available file actions. */
export function StorageFileDetailPanel({
  file,
  downloadUrl,
  busy = false,
  onRename,
  onToggleVisibility,
  onDelete,
}: StorageFileDetailPanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <File className="size-5 shrink-0 text-muted-foreground" />
        <h3 className="min-w-0 truncate text-sm font-semibold">{file.name}</h3>
      </div>

      <div className="space-y-2 text-xs">
        <StorageDetailRow label="Path" value={file.path} />
        <StorageDetailRow label="Size" value={formatStorageBytes(file.sizeBytes)} />
        <StorageDetailRow label="Type" value={file.mimeType ?? (file.type === 'folder' ? 'Folder' : 'Unknown')} />
        <StorageDetailRow label="Checksum" value={file.checksum ? `${file.checksum.slice(0, 16)}...` : 'N/A'} />
        <StorageDetailRow label="Created" value={new Date(file.createdAt).toLocaleString()} />
        <StorageDetailRow label="Updated" value={new Date(file.updatedAt).toLocaleString()} />
        <StorageDetailRow
          label="Visibility"
          value={
            <Badge variant={file.isPublic ? 'default' : 'secondary'} className="text-xs">
              {file.isPublic ? 'Public' : 'Private'}
            </Badge>
          }
        />
      </div>

      <div className="flex flex-col gap-1.5 pt-2">
        {file.type === 'file' && (
          <Button variant="outline" size="sm" asChild>
            <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
              <AnimateIcon animateOnHover>
                <Download size={12} className="mr-1" />
              </AnimateIcon>
              Download
            </a>
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => onRename(file)}>
          <Pencil className="mr-1 size-3" />
          Rename
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => onToggleVisibility(file)}>
          {file.isPublic ? (
            <AnimateIcon animate>
              <EyeOff size={12} className="mr-1" />
            </AnimateIcon>
          ) : (
            <AnimateIcon animate>
              <Eye size={12} className="mr-1" />
            </AnimateIcon>
          )}
          {file.isPublic ? 'Make Private' : 'Make Public'}
        </Button>
        <Button variant="destructive" size="sm" disabled={busy} onClick={() => onDelete(file)}>
          <AnimateIcon animateOnHover>
            <Trash size={12} className="mr-1" />
          </AnimateIcon>
          Delete
        </Button>
      </div>
    </div>
  );
}

function StorageDetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 max-w-[65%] truncate text-right font-mono">{value}</span>
    </div>
  );
}
