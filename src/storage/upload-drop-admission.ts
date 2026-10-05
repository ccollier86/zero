/** Event-owned upload admission; imperative upload callers retain their rejection contract. */
import type { FileRejection } from 'react-dropzone';

export interface StorageDropAdmission {
  readonly isCurrent: () => boolean;
  readonly disabled: boolean;
  readonly onRejected?: (rejections: FileRejection[]) => void;
  readonly upload: (files: File[]) => Promise<unknown>;
}

/** @internal Upload already owns reporting; the event boundary must observe its rejection. */
export function admitStorageDrop(
  admission: StorageDropAdmission,
  accepted: File[],
  rejected: FileRejection[],
): void {
  if (!admission.isCurrent()) return;
  if (rejected.length > 0) admission.onRejected?.(rejected);
  if (accepted.length === 0 || admission.disabled) return;
  void admission.upload(accepted).catch(() => {
    // uploadFiles reports through queue state, observability and onError first.
    // A drag/drop event has no caller to await its intentionally rejected result.
  });
}
