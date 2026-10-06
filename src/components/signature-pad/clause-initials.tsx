'use client';

/**
 * clause-initials.tsx
 *
 * Composes compact Zero Signature Pads beside contract clauses and counts actual
 * ink by stable clause ID. Forms and application callbacks own persistence and
 * authorization; this component never marks a contract legally complete.
 */
import * as React from 'react';
import { Check, PenLine } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { cn } from '../../lib/utils';
import { SignaturePad } from './signature-pad';
import { SignaturePadArea } from './signature-pad-area';
import { SignaturePadClear } from './signature-pad-controls';
import { SignaturePadControls, SignaturePadGuide, SignaturePadPlaceholder } from './signature-pad-overlays';
import { hasSignaturePadInk } from './signature-model';
import { countCompletedClauseInitials, projectClauseInitialsValue, updateClauseInitialsValue, type ClauseInitialsValue } from './clause-initials-model';
import type { SignaturePadStroke } from './signature-pad.types';
import { observeSignatureCompositionCallback } from './signature-composition-callback';

/** Stable ID and readable contract clause; reorder freely without moving another clause's ink. */
export interface SignatureClause {
  readonly id: string;
  readonly label: React.ReactNode;
  readonly description?: React.ReactNode;
}

/** Compact controlled/local drawings; required adds native validation even without field names. */
export interface ClauseInitialsProps extends Omit<React.ComponentProps<'div'>, 'title' | 'onChange' | 'defaultValue'> {
  clauses: readonly SignatureClause[];
  value?: ClauseInitialsValue;
  defaultValue?: ClauseInitialsValue;
  onValueChange?: (value: ClauseInitialsValue) => void | Promise<void>;
  /** Change with contract/organization to retire local drawings and their history. */
  scopeKey?: string | number;
  title?: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  readOnly?: boolean;
  /** Optional native fields serialize SVG data URLs under `${namePrefix}.${clauseId}`. */
  namePrefix?: string;
  form?: string;
  required?: boolean;
}

/** Render compact initials pads with a completion count, preserving stable clause ownership. */
export function ClauseInitials(props: ClauseInitialsProps) {
  return <ClauseInitialsWorkspace key={`${typeof props.scopeKey}:${String(props.scopeKey ?? '')}`} {...props} />;
}

function ClauseInitialsWorkspace({ clauses, value, defaultValue, onValueChange, scopeKey, title = 'Clause initials',
  description = 'Add your initials beside each clause.', disabled = false, readOnly = false,
  namePrefix, form, required = false, className, ...props }: ClauseInitialsProps) {
  const id = React.useId();
  const [localValue, setLocalValue] = React.useState(() => projectClauseInitialsValue(clauses, defaultValue));
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const projected = React.useMemo(() => projectClauseInitialsValue(clauses, value ?? localValue), [clauses, value, localValue]);
  const currentDraft = React.useRef(projected);
  currentDraft.current = projected;
  const completed = countCompletedClauseInitials(clauses, projected);
  const clauseIds = JSON.stringify(clauses.map((clause) => clause.id));
  React.useEffect(() => {
    if (value !== undefined) return;
    setLocalValue((current) => Object.keys(current).length === clauses.length && clauses.every((clause) => Object.hasOwn(current, clause.id))
      ? current : projectClauseInitialsValue(clauses, current));
  }, [clauseIds, value]);

  function changeClause(clauseId: string, strokes: readonly SignaturePadStroke[]) {
    if (disabled || readOnly) return;
    // Multiple native reset callbacks can run before React paints. Compose from
    // the immediately admitted draft, not the first callback's render closure.
    const next = updateClauseInitialsValue(clauses, currentDraft.current, clauseId, strokes);
    currentDraft.current = next;
    setLocalValue(next);
    if (onValueChange) observeSignatureCompositionCallback(() => onValueChange(next), 'clause-selection', () => mounted.current);
  }

  return <div data-slot="clause-initials" className={cn('space-y-3', className)} {...props}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1"><h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <Badge variant={completed === clauses.length && clauses.length > 0 ? 'secondary' : 'outline'}
        aria-live="polite" data-slot="clause-initials-completion" className="gap-1.5 whitespace-nowrap">
        {completed === clauses.length && clauses.length > 0 && <Check className="size-3" aria-hidden="true" />}
        {completed} of {clauses.length} initialed
      </Badge>
    </div>
    {clauses.map((clause, index) => {
      const hasInk = hasSignaturePadInk(projected[clause.id]);
      const labelId = `${id}-clause-${index}`;
      return <Card key={clause.id} data-slot="clause-initials-item" data-state={hasInk ? 'initialed' : 'empty'}
        className="flex min-w-0 flex-col gap-4 p-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs',
            hasInk ? 'border-primary/20 bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')} aria-hidden="true">
            {hasInk ? <Check className="size-3.5" /> : index + 1}
          </span>
          <div className="min-w-0 space-y-1"><h4 id={labelId} className="text-sm font-medium leading-relaxed">{clause.label}</h4>
            {clause.description && <div className="text-sm leading-relaxed text-muted-foreground">{clause.description}</div>}
          </div>
        </div>
        <SignaturePad value={projected[clause.id]} defaultValue={defaultValue && Object.hasOwn(defaultValue, clause.id) ? defaultValue[clause.id] : []}
          onValueChange={(strokes) => changeClause(clause.id, strokes)}
          disabled={disabled} readOnly={readOnly} scopeKey={scopeKey} name={namePrefix === undefined ? undefined : `${namePrefix}.${clause.id}`}
          form={form} required={required} className="w-full shrink-0 sm:w-44">
          <SignaturePadArea variant="muted" className="h-24" aria-label={`Initials for clause ${index + 1}`} aria-describedby={labelId}>
            <SignaturePadPlaceholder className="gap-1.5"><PenLine className="size-3.5" aria-hidden="true" /> Initial here</SignaturePadPlaceholder>
            <SignaturePadGuide className="inset-x-4 bottom-5" />
            {!readOnly && <SignaturePadControls position="top-end"><SignaturePadClear size="icon-xs" /></SignaturePadControls>}
          </SignaturePadArea>
        </SignaturePad>
      </Card>;
    })}
  </div>;
}
