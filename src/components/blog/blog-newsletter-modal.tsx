'use client';

import * as React from 'react';
import { Button, type ButtonProps } from '../ui/button';
import { ControlledModal } from '../../modals/modal-controlled';
import { NewsletterSignup, type NewsletterSignupProps } from './blog-content';

export interface NewsletterModalProps extends NewsletterSignupProps { open: boolean; onOpenChange: (open: boolean) => void; trigger?: HTMLElement | null }
export function NewsletterModal({ open, onOpenChange, trigger, ...props }: NewsletterModalProps) {
  if (!props.onSubscribe) return null;
  return <ControlledModal open={open} onOpenChange={onOpenChange} descriptor={{ title: props.title ?? 'Stay in the loop', trigger, size: 'sm', className: 'zero-blog-overlay', body: context => <NewsletterSignup {...props}
    onSubscribe={async (email, request) => {
      if (context.signal.aborted) return;
      context.setBusy(true);
      try { await props.onSubscribe!(email, request); if (!context.signal.aborted && !request.signal.aborted) context.accept(email); }
      finally { if (!context.signal.aborted) context.setBusy(false); }
    }} /> }} />;
}
export function NewsletterTrigger({ newsletter, onClick, children, ...props }: ButtonProps & { newsletter: NewsletterSignupProps }) {
  const [trigger, setTrigger] = React.useState<HTMLElement | null>(null), [open, setOpen] = React.useState(false);
  if (!newsletter.onSubscribe) return null;
  return <><Button type="button" {...props} onClick={event => { onClick?.(event); if (!event.defaultPrevented) { setTrigger(event.currentTarget); setOpen(true); } }}>{children ?? 'Subscribe'}</Button>
    <NewsletterModal {...newsletter} open={open} onOpenChange={setOpen} trigger={trigger} /></>;
}
