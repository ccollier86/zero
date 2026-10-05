/** Stable semantic token/icon bridge for json-edit-react, without fixed theme colors. */
import * as React from 'react';
import type { ThemeInput } from 'json-edit-react';
import { Plus, Pencil, Trash2, Copy, Check, X, ChevronDown, type LucideIcon } from 'lucide-react';

export const ZERO_JSON_EDITOR_THEME: ThemeInput = {
  displayName: 'Zero',
  styles: {
    container: { backgroundColor: 'transparent', color: 'var(--foreground)', fontFamily: 'var(--font-mono)', padding: '0.5rem' },
    property: 'var(--foreground)', bracket: 'var(--muted-foreground)', itemCount: 'var(--muted-foreground)',
    string: 'var(--primary)', number: 'var(--success)', boolean: 'var(--warning)', null: 'var(--muted-foreground)',
    input: { backgroundColor: 'var(--background)', color: 'var(--foreground)', borderColor: 'var(--border)', borderRadius: 'var(--radius-sm)' },
    inputHighlight: 'var(--primary)', error: { color: 'var(--destructive)', fontSize: '0.75rem' },
    iconCollection: 'var(--muted-foreground)', iconEdit: 'var(--muted-foreground)', iconAdd: 'var(--primary)',
    iconDelete: 'var(--destructive)', iconCopy: 'var(--muted-foreground)', iconOk: 'var(--success)', iconCancel: 'var(--muted-foreground)',
  },
  icons: {
    add: icon(Plus), edit: icon(Pencil), delete: icon(Trash2), copy: icon(Copy),
    ok: icon(Check), cancel: icon(X), collection: icon(ChevronDown),
  },
};

function icon(Icon: LucideIcon) {
  return { content: <Icon width="100%" height="100%" aria-hidden="true" />, viewBox: '0 0 24 24' };
}
