'use client';

/** Table-only text presentation adapter. Reuses TypingText; never reads records, editors, or arbitrary cell children. */
import type { ReactNode } from 'react';
import { TypingText } from '../animate-ui/primitives/texts/typing';
import { DATA_TABLE_MOTION } from './data-table-motion-tokens';

interface DataTableAnimatedTextProps {
  value: string;
  children: ReactNode;
  enabled?: boolean;
}

/** Keep canonical safe text current; animate only subsequent replacements, without a cursor or initial typing. */
export function DataTableAnimatedText({ value, children, enabled = true }: DataTableAnimatedTextProps) {
  return <TypingText mode="replace" text={value} enabled={enabled} duration={24}
    maxDuration={DATA_TABLE_MOTION.base} data-slot="data-table-animated-text">{children}</TypingText>;
}
