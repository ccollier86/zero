'use client';
/** Internal composition context: presentation state only, never application state. */
import * as React from 'react';
import type { CodeBlockFile, CodeBlockHighlightOptions, CodeBlockHighlightResult } from './code-block.types';

export interface CodeBlockContextValue {
  file: CodeBlockFile;
  files: readonly CodeBlockFile[];
  selectFile: (file: CodeBlockFile) => void;
  options: CodeBlockHighlightOptions;
  highlighted?: CodeBlockHighlightResult;
  highlightOnClient?: boolean;
  onCopy?: (file: CodeBlockFile) => void;
  onHighlightError?: (error: unknown, file: CodeBlockFile) => void;
  tabId: (id: string) => string;
  panelId: string;
}
export const CodeBlockContext = React.createContext<CodeBlockContextValue | undefined>(undefined);
export function useCodeBlockContext(): CodeBlockContextValue | undefined { return React.useContext(CodeBlockContext); }
