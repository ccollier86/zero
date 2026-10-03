'use client';

/** Scope-fenced presigned preview loading for browser-safe storage objects. */

import * as React from 'react';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { useClientMaybe } from '../../frontend/client/client-context';
import { usePresignedUrl } from '../../storage/storage-hooks';
import type { FileInfo } from '../../storage/types';
import { reportStorageActionError } from './storage-observability';
import {
  bindStorageStudioValue,
  readStorageStudioValue,
  type StorageStudioScopedValue,
} from './storage-studio-scoped-value';

export type StorageFilePreviewKind =
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'text'
  | 'unsupported';

export interface StorageFilePreviewState {
  readonly kind: StorageFilePreviewKind;
  readonly status: 'idle' | 'loading' | 'ready' | 'error' | 'unsupported';
  readonly url: string | null;
  readonly text: string | null;
  readonly error: string | null;
  readonly refresh: () => void;
}

export const STORAGE_TEXT_PREVIEW_MAX_BYTES = 512 * 1024;
type PreviewPayload = Omit<StorageFilePreviewState, 'kind' | 'refresh'>;

export function useStorageFilePreview(
  driveId: string,
  file: FileInfo,
): StorageFilePreviewState {
  const client = useClientMaybe();
  const boundary = useAuthorizationScopeBoundary(client);
  const presigned = usePresignedUrl();
  const kind = storageFilePreviewKind(file);
  const renderKey = `${boundary.key}\0${driveId}\0${file.id}\0${file.path}\0${file.updatedAt}`;
  const [revision, setRevision] = React.useState(0);
  const [scopedState, setScopedState] = React.useState<StorageStudioScopedValue<PreviewPayload>>(
    bindStorageStudioValue(renderKey, emptyPreviewState(kind, 'idle')),
  );
  const boundaryKeyRef = React.useRef(boundary.key);
  const boundaryReadyRef = React.useRef(boundary.ready);
  boundaryKeyRef.current = boundary.key;
  boundaryReadyRef.current = boundary.ready;

  React.useEffect(() => {
    const controller = new AbortController();
    const capturedKey = boundary.key;
    const capturedRenderKey = renderKey;
    const update = (value: PreviewPayload) => {
      setScopedState(bindStorageStudioValue(capturedRenderKey, value));
    };
    update(emptyPreviewState(kind, 'loading'));
    if (kind === 'unsupported' || !boundary.ready || file.type !== 'file') {
      return () => controller.abort();
    }
    if (kind === 'text' && file.sizeBytes > STORAGE_TEXT_PREVIEW_MAX_BYTES) {
      update({
        status: 'unsupported',
        url: null,
        text: null,
        error: `Text previews are limited to ${formatByteLimit(STORAGE_TEXT_PREVIEW_MAX_BYTES)}.`,
      });
      return () => controller.abort();
    }

    void (async () => {
      try {
        const url = await presigned.getUrl(driveId, file.path, 'download');
        if (!current()) return;
        if (kind !== 'text') {
          update({ status: 'ready', url, text: null, error: null });
          return;
        }
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        if (!response.ok) throw new Error(`Preview request failed with status ${response.status}.`);
        const text = await readBoundedTextResponse(response, STORAGE_TEXT_PREVIEW_MAX_BYTES);
        if (current()) update({ status: 'ready', url: null, text, error: null });
      } catch (cause) {
        if (controller.signal.aborted || !current()) return;
        const normalized = reportStorageActionError('previewFile', cause, {
          driveId,
          objectType: file.type,
        });
        update({ status: 'error', url: null, text: null, error: normalized.message });
      }
    })();
    return () => controller.abort();

    function current(): boolean {
      return !controller.signal.aborted
        && boundaryReadyRef.current
        && boundaryKeyRef.current === capturedKey;
    }
  }, [
    boundary.key,
    boundary.ready,
    driveId,
    file.id,
    file.path,
    file.sizeBytes,
    file.type,
    file.updatedAt,
    kind,
    presigned.getUrl,
    renderKey,
    revision,
  ]);

  const state = readStorageStudioValue(scopedState, renderKey, boundary.ready)
    ?? emptyPreviewState(kind, 'loading');

  return {
    kind,
    ...state,
    refresh: React.useCallback(() => setRevision((value) => value + 1), []),
  };
}

function emptyPreviewState(
  kind: StorageFilePreviewKind,
  supportedStatus: 'idle' | 'loading',
): PreviewPayload {
  return {
    status: kind === 'unsupported' ? 'unsupported' : supportedStatus,
    url: null,
    text: null,
    error: null,
  };
}

/** Classify only formats rendered without executing stored markup or script. */
export function storageFilePreviewKind(file: Pick<FileInfo, 'type' | 'mimeType' | 'name'>): StorageFilePreviewKind {
  if (file.type !== 'file') return 'unsupported';
  const mime = (file.mimeType ?? '').split(';', 1)[0]!.trim().toLowerCase();
  if (mime.startsWith('image/')) return mime === 'image/svg+xml' ? 'unsupported' : 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/')
    || mime === 'application/json'
    || mime === 'application/xml'
    || mime === 'application/yaml'
    || mime === 'application/x-yaml') return 'text';
  const extension = file.name.toLowerCase().split('.').at(-1);
  return ['txt', 'md', 'json', 'csv', 'log', 'xml', 'yaml', 'yml'].includes(extension ?? '')
    ? 'text'
    : 'unsupported';
}

/** Decode a response without allowing a dishonest server to exceed the UI bound. */
export async function readBoundedTextResponse(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const value = await response.text();
    if (new TextEncoder().encode(value).byteLength > maxBytes) throw previewTooLarge(maxBytes);
    return value;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let value = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw previewTooLarge(maxBytes);
      value += decoder.decode(chunk.value, { stream: true });
    }
    return value + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function previewTooLarge(maxBytes: number): Error {
  return new Error(`Text preview exceeds ${formatByteLimit(maxBytes)}.`);
}

function formatByteLimit(value: number): string {
  return `${Math.round(value / 1024)} KiB`;
}
