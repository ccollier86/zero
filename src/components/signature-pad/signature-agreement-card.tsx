'use client';

/**
 * signature-agreement-card.tsx
 *
 * Composes Zero's card, fields and Signature Pad into an acknowledged agreement
 * view. It owns presentation and draft interactions, not identity verification,
 * legal compliance, transport, or signature persistence.
 */
import * as React from 'react';
import { Check, LockKeyhole, PenLine } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { cn } from '../../lib/utils';
import { SignaturePad } from './signature-pad';
import { SignaturePadArea } from './signature-pad-area';
import { SignaturePadClear, SignaturePadSave } from './signature-pad-controls';
import { SignaturePadControls, SignaturePadGuide, SignaturePadPlaceholder } from './signature-pad-overlays';
import { hasSignaturePadInk, sameSignaturePadStrokes, snapshotSignaturePadStrokes } from './signature-model';
import { createSignatureAgreementPayload, type SignatureAgreementAcknowledgement, type SignatureAgreementPayload,
  type SignatureAgreementReceipt, type SignatureAgreementSignedValue } from './signature-agreement-model';
import type { SignaturePadStroke } from './signature-pad.types';
import { useSignatureAgreement } from './use-signature-agreement';
import { observeSignatureCompositionCallback } from './signature-composition-callback';

/** Draft-and-receipt composition; sourceKey must change with the document or authorization scope. */
export interface SignatureAgreementCardProps extends Omit<React.ComponentProps<'div'>, 'title' | 'onChange' | 'defaultValue'> {
  sourceKey: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  signed?: SignatureAgreementSignedValue | null;
  value?: readonly SignaturePadStroke[];
  defaultValue?: readonly SignaturePadStroke[];
  onValueChange?: (strokes: readonly SignaturePadStroke[]) => void | Promise<void>;
  signerName?: string;
  defaultSignerName?: string;
  onSignerNameChange?: (name: string) => void | Promise<void>;
  showSignerName?: boolean;
  signerNameLabel?: string;
  requireConsent?: boolean;
  consentLabel?: React.ReactNode;
  disabled?: boolean;
  readOnly?: boolean;
  /** Persist/verify in app code and return a UTC ISO signedAt receipt; rejection leaves the draft editable. */
  onSign?: (payload: SignatureAgreementPayload) => SignatureAgreementAcknowledgement | Promise<SignatureAgreementAcknowledgement>;
  /** Notification only: rejecting it never removes an already acknowledged signature. */
  onSigned?: (receipt: SignatureAgreementReceipt) => void | Promise<void>;
  signLabel?: string;
}

/** Display an agreement and lock its exact ink only after the app acknowledges signing. */
export function SignatureAgreementCard(props: SignatureAgreementCardProps) {
  if (typeof props.sourceKey !== 'string' || props.sourceKey.trim().length === 0) {
    throw new TypeError('SignatureAgreementCard requires a nonempty document or scope sourceKey.');
  }
  return <SignatureAgreementWorkspace key={props.sourceKey} {...props} />;
}

function SignatureAgreementWorkspace({
  sourceKey, title = 'Agreement', description, signed, children, value, defaultValue = [], onValueChange,
  signerName, defaultSignerName = '', onSignerNameChange, showSignerName = true, signerNameLabel = 'Full name',
  requireConsent = false, consentLabel = 'I have read and agree to the terms above.', disabled = false,
  readOnly = false, onSign, onSigned, signLabel = 'Sign agreement', className, ...cardProps
}: SignatureAgreementCardProps) {
  const id = React.useId();
  const [localInk, setLocalInk] = React.useState(() => snapshotSignaturePadStrokes(defaultValue));
  const [localName, setLocalName] = React.useState(defaultSignerName);
  const [consented, setConsented] = React.useState(false);
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const ink = value ?? localInk;
  const name = signerName ?? localName;
  const draft = React.useRef({ ink, name, consented, disabled, readOnly, requireConsent });
  draft.current = { ink, name, consented, disabled, readOnly, requireConsent };
  const agreement = useSignatureAgreement({ sourceKey, signed, onSign, onSigned,
    isDraftCurrent: (payload) => {
      const current = draft.current;
      return !current.disabled && !current.readOnly && sameSignaturePadStrokes(payload.strokes, current.ink)
        && payload.signerName === current.name.trim() && (!current.requireConsent || current.consented);
    },
  });
  const receipt = agreement.receipt;
  const locked = readOnly || receipt !== null || agreement.invalidReceipt;
  const hasInk = hasSignaturePadInk(ink);
  const signable = !disabled && !locked && !agreement.pending && hasInk
    && (!showSignerName || name.trim().length > 0) && (!requireConsent || consented) && Boolean(onSign);

  function changeInk(next: readonly SignaturePadStroke[]) {
    if (locked || agreement.pending || disabled) return;
    if (value === undefined) setLocalInk(next);
    agreement.clearError();
    if (onValueChange) observeSignatureCompositionCallback(() => onValueChange(next), 'agreement-ink', () => mounted.current);
  }

  function changeName(next: string) {
    if (locked || agreement.pending || disabled) return;
    if (signerName === undefined) setLocalName(next);
    agreement.clearError();
    if (onSignerNameChange) observeSignatureCompositionCallback(() => onSignerNameChange(next), 'agreement-name', () => mounted.current);
  }

  return <Card data-slot="signature-agreement-card" data-state={receipt ? 'signed' : agreement.pending ? 'pending' : 'draft'}
    className={cn('overflow-hidden', className)} {...cardProps}>
    <CardHeader className="flex-col items-start justify-between gap-3 border-b bg-muted/25 sm:flex-row sm:gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background text-primary">
          {receipt ? <LockKeyhole className="size-4" aria-hidden="true" /> : <PenLine className="size-4" aria-hidden="true" />}
        </div>
        <div className="min-w-0 space-y-1"><CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
      </div>
      <Badge variant={receipt ? 'secondary' : 'outline'} className="shrink-0 gap-1.5 whitespace-nowrap">
        {receipt && <Check className="size-3" aria-hidden="true" />}{receipt ? 'Signed' : 'Signature required'}
      </Badge>
    </CardHeader>
    {children && <CardContent className="border-b p-5 text-sm leading-relaxed">{children}</CardContent>}
    <SignaturePad value={receipt?.strokes ?? ink} defaultValue={defaultValue} onValueChange={changeInk} scopeKey={sourceKey}
      disabled={disabled} readOnly={locked}>
      <CardContent className="space-y-4 pt-5">
        {showSignerName && !receipt && <div className="space-y-2">
          <Label htmlFor={`${id}-name`}>{signerNameLabel}</Label>
          <Input id={`${id}-name`} autoComplete="name" value={name} placeholder="Name as it appears on the agreement"
            disabled={disabled || agreement.pending} readOnly={locked} onChange={(event) => changeName(event.target.value)} />
        </div>}
        <SignaturePadArea variant="muted" className="h-48" aria-label={receipt ? 'Signed agreement signature' : 'Agreement signature'}>
          <SignaturePadPlaceholder>Draw your signature here</SignaturePadPlaceholder>
          <SignaturePadGuide />
          {!locked && <SignaturePadControls position="top-end"><SignaturePadClear /></SignaturePadControls>}
        </SignaturePadArea>
        {agreement.invalidReceipt && <p role="alert" className="text-sm text-destructive">The saved signature could not be verified for display. Reload the agreement.</p>}
        {agreement.error && <p role="alert" className="text-sm text-destructive">{agreement.error.message}</p>}
        {requireConsent && !receipt && <div className="flex items-start gap-2.5">
          <Checkbox id={`${id}-consent`} checked={consented} disabled={disabled || locked || agreement.pending}
            onCheckedChange={(checked) => setConsented(checked === true)} />
          <Label htmlFor={`${id}-consent`} className="block text-sm font-normal leading-relaxed">{consentLabel}</Label>
        </div>}
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-3 border-t bg-muted/20 px-5 py-4">
        {receipt ? <div className="min-w-0 space-y-1 text-sm" data-slot="signature-agreement-receipt">
          <p className="font-medium">{receipt.signerName ? `Signed by ${receipt.signerName}` : 'Signature confirmed'}</p>
          <p className="text-xs text-muted-foreground"><time dateTime={receipt.signedAt}>
            {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(receipt.signedAt))} UTC
          </time></p>
        </div> : <>
          <p aria-live="polite" className="min-w-0 text-xs text-muted-foreground">
            {agreement.pending ? 'Confirming signature…' : readOnly ? 'This agreement is read-only.' : disabled || !onSign
              ? 'Signing is unavailable.' : 'Your signature is confirmed after the signing action succeeds.'}
          </p>
          {!readOnly && <SignaturePadSave variant="default" size="default" showFeedback={false} disabled={!signable} onSave={async (_value, snapshot) => {
            if (!signable) return false as const;
            const result = await agreement.sign(createSignatureAgreementPayload(snapshot, name));
            if (result === 'failed') throw new Error('The signature was not acknowledged.');
            if (result === 'ignored' || result === 'stale') return false as const;
          }}>{agreement.pending ? 'Confirming…' : signLabel}</SignaturePadSave>}
        </>}
      </CardFooter>
    </SignaturePad>
  </Card>;
}
