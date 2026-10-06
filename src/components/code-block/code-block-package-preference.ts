'use client';
/** Opt-in package manager preferences shared between examples, with SSR-safe defaults. */
import * as React from 'react';
import { OBS_CODES } from '../../observability/codes';
import { emitFrontendCode } from '../../frontend/client/observability';
import type { CodeBlockPackageManagerName, CodeBlockPackageManagerOptions } from './code-block.types';

const CHANGE_EVENT = 'zero:code-package-manager';
export const CODE_BLOCK_PACKAGE_MANAGERS = ['bun', 'npm', 'pnpm', 'yarn'] as const;

export function isCodeBlockPackageManager(value: unknown): value is CodeBlockPackageManagerName {
  return CODE_BLOCK_PACKAGE_MANAGERS.includes(value as CodeBlockPackageManagerName);
}

/** Optional persistence never reads storage while rendering, so SSR/hydration agree. */
export function useCodeBlockPackageManager({ value, defaultValue = 'bun', onValueChange,
  persist = false }: CodeBlockPackageManagerOptions = {}) {
  const [local, setLocal] = React.useState(defaultValue);
  const key = persist ? typeof persist === 'string' ? persist : 'zero:code-block:package-manager' : undefined;
  React.useEffect(() => {
    if (!key) return;
    const update = () => {
      try {
        const next = window.localStorage.getItem(key);
        if (isCodeBlockPackageManager(next)) setLocal(next);
      } catch (error) { reportPreferenceFailure(error, 'read'); }
    };
    update();
    const storage = (event: StorageEvent) => { if (event.key === key) update(); };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: CodeBlockPackageManagerName }>).detail;
      if (detail?.key === key && isCodeBlockPackageManager(detail.value)) setLocal(detail.value);
    };
    window.addEventListener('storage', storage); window.addEventListener(CHANGE_EVENT, changed);
    return () => { window.removeEventListener('storage', storage); window.removeEventListener(CHANGE_EVENT, changed); };
  }, [key]);
  const setValue = React.useCallback((next: CodeBlockPackageManagerName) => {
    if (!isCodeBlockPackageManager(next)) return;
    if (value === undefined) setLocal(next);
    onValueChange?.(next);
    if (!key) return;
    try { window.localStorage.setItem(key, next); }
    catch (error) { reportPreferenceFailure(error, 'write'); }
    // Same-tab examples remain synchronized even when persistent storage is blocked.
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key, value: next } }));
  }, [value, onValueChange, key]);
  return { value: value ?? local, setValue };
}

function reportPreferenceFailure(error: unknown, operation: 'read' | 'write'): void {
  emitFrontendCode(OBS_CODES.FRONTEND_CODE_PREFERENCE_FAILED, { error, metadata: { operation } });
}
