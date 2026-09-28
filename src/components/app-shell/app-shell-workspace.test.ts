import { describe, expect, test } from 'bun:test';
import type { AppShellWorkspaceConfig } from './app-shell.types';
import {
  appShellWorkspaceActionDisabled,
  appShellWorkspaceStatusMessage,
  resolveAppShellActiveWorkspace,
} from './app-shell-sidebar';

const items = [
  { id: 'tenant-a', name: 'Alpha' },
  { id: 'tenant-b', name: 'Beta' },
];

describe('AppShell workspace authority projection', () => {
  test('never masks a missing authoritative active selection with the first item', () => {
    const config: AppShellWorkspaceConfig = {
      activeId: 'tenant-missing',
      items,
      requireActiveSelection: true,
    };
    expect(resolveAppShellActiveWorkspace(config)).toBeUndefined();
  });

  test('preserves the legacy first-item fallback for existing callers', () => {
    expect(resolveAppShellActiveWorkspace({ items })).toEqual(items[0]);
  });

  test('returns only an exact committed active match', () => {
    expect(resolveAppShellActiveWorkspace({
      activeId: 'tenant-b',
      items,
      requireActiveSelection: true,
    })).toEqual(items[1]);
  });

  test('freezes all menu actions while scope replacement is pending', () => {
    expect(appShellWorkspaceActionDisabled({ pending: true })).toBe(true);
    expect(appShellWorkspaceActionDisabled({ pending: false }, true)).toBe(true);
    expect(appShellWorkspaceActionDisabled({ pending: false })).toBe(false);
  });

  test('uses the same fallback copy for an unlabeled pending live region', () => {
    expect(appShellWorkspaceStatusMessage({ pending: true })).toBe(
      'Updating workspaces…',
    );
    expect(appShellWorkspaceStatusMessage({
      pending: true,
      pendingLabel: 'Switching organization…',
      announcement: 'Old completion',
    })).toBe('Switching organization…');
    expect(appShellWorkspaceStatusMessage({
      pending: false,
      announcement: 'Switched to Alpha',
    })).toBe('Switched to Alpha');
  });
});
