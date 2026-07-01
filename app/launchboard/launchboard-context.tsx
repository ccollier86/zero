'use client';

/**
 * launchboard-context.tsx
 *
 * LaunchBoard route state boundary. This file owns the ReactiveDB data adapter
 * and modal workflow composition for the route branch; page and shell
 * components consume the prepared context without opening their own stores.
 */

import * as React from 'react';

import { useLaunchBoardData, type LaunchBoardData } from './use-launchboard-data';
import {
  useLaunchBoardModals,
  type LaunchBoardModalActions,
} from './use-launchboard-modals';

export interface LaunchBoardContextValue {
  data: LaunchBoardData;
  dialogs: LaunchBoardModalActions;
}

const LaunchBoardContext = React.createContext<LaunchBoardContextValue | null>(null);

export interface LaunchBoardProviderProps {
  children: React.ReactNode;
}

/**
 * Provide LaunchBoard data and modal actions to the route group layout tree.
 *
 * The provider is intentionally scoped to the LaunchBoard route branch so the
 * root app layout can stay provider-only and reusable for public routes.
 */
export function LaunchBoardProvider({ children }: LaunchBoardProviderProps) {
  const data = useLaunchBoardData();
  const dialogs = useLaunchBoardModals(data);

  const value = React.useMemo<LaunchBoardContextValue>(
    () => ({ data, dialogs }),
    [data, dialogs],
  );

  return (
    <LaunchBoardContext.Provider value={value}>
      {children}
    </LaunchBoardContext.Provider>
  );
}

/**
 * Return LaunchBoard route state from the nearest LaunchBoardProvider.
 *
 * Throws during development when a page is mounted outside the route layout,
 * which keeps shell/data ownership errors obvious.
 */
export function useLaunchBoardContext(): LaunchBoardContextValue {
  const context = React.useContext(LaunchBoardContext);
  if (!context) {
    throw new Error('useLaunchBoardContext must be used inside LaunchBoardProvider');
  }
  return context;
}
