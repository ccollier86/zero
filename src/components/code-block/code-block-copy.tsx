'use client';
/** Awaited clipboard actions, duplicate-click protection and tokenized feedback. */
import * as React from 'react';
import type { Transition } from 'motion/react';
import { MorphingText } from '../animate-ui/primitives/texts/morphing';
import { ZeroIcon } from '../animate-ui/icons/zero-icon';
import { Button } from '../ui/button';
import { useCopyToClipboard } from '../../hooks/use-copy-to-clipboard';
import { cn } from '../../lib/utils';
import { OBS_CODES } from '../../observability/codes';
import { emitFrontendCode } from '../../frontend/client/observability';
import { useCodeBlockContext } from './code-block-context';
import type { CodeBlockCopyButtonProps } from './code-block.types';
import { codeBlockActionStyle } from './code-block-action-style';

/** Icon, text and shared-character morph variants copy exactly the supplied source. */
export function CodeBlockCopyButton({ content: ownContent, variant = 'icon', resetAfterMs,
  copyLabel = 'Copy code', copiedLabel = 'Code copied', className, disabled, onClick,
  onCopy, onCopyError, children, ref, size = 'sm', iconSize, style, ...props }: CodeBlockCopyButtonProps) {
  const context = useCodeBlockContext();
  const content = ownContent ?? context?.file.code ?? '';
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const composedRef = React.useCallback((node: HTMLButtonElement | null) => {
    buttonRef.current = node;
    if (typeof ref === 'function') {
      const cleanup = ref(node);
      if (typeof cleanup === 'function') return () => { buttonRef.current = null; cleanup(); };
    } else if (ref) ref.current = node;
  }, [ref]);
  const busy = React.useRef(false), [pending, setPending] = React.useState(false);
  const [duration, setDuration] = React.useState(0);
  const [ease, setEase] = React.useState<NonNullable<Transition['ease']>>('linear');
  const [reducedMotion, setReducedMotion] = React.useState(false);
  const [timeout, setTimeoutValue] = React.useState(1600);
  const { copy, copied, value, error } = useCopyToClipboard({ timeoutMs: resetAfterMs ?? timeout });
  const errorCallback = React.useRef(onCopyError); errorCallback.current = onCopyError;
  React.useEffect(() => { if (error) errorCallback.current?.(error); }, [error]);
  React.useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  React.useEffect(() => {
    if (!buttonRef.current) return;
    const style = getComputedStyle(buttonRef.current);
    const durationToken = style.getPropertyValue('--zero-code-transition-duration').trim();
    const nextDuration = Number.parseFloat(durationToken) / (durationToken.endsWith('ms') ? 1000 : 1);
    const nextTimeout = Number.parseFloat(style.getPropertyValue('--zero-code-copy-reset-ms'));
    if (Number.isFinite(nextDuration)) setDuration(nextDuration);
    setEase(readMotionEase(style.getPropertyValue('--zero-code-transition-ease')));
    if (resetAfterMs === undefined && Number.isFinite(nextTimeout)) setTimeoutValue(nextTimeout);
  }, [resetAfterMs]);
  const successful = copied && value === content;
  const label = successful ? copiedLabel : copyLabel;
  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || busy.current || disabled) return;
    busy.current = true; setPending(true);
    const file = context?.file;
    try {
      if (await copy(content)) {
        onCopy?.(content);
        if (file) context?.onCopy?.(file);
      } else emitFrontendCode(OBS_CODES.FRONTEND_COPY_FAILED, { metadata: {
        filename: file?.filename, language: file?.language, hasContent: Boolean(content),
      } });
    } finally { busy.current = false; setPending(false); }
  };
  const text = successful ? 'Copied' : 'Copy';
  return <Button ref={composedRef} animateIcon={false} type="button" variant="ghost" size={variant === 'icon' ? 'icon-sm' : 'sm'}
    className={cn('zero-code-block-action zero-code-block-copy', className)} disabled={disabled || pending}
    aria-label={label} title={label} aria-busy={pending} data-copied={successful ? 'true' : 'false'}
    data-copy-size={size} style={codeBlockActionStyle({ ...(size === 'xs' ? { fontSize: 'var(--zero-code-label-font-size)' } : {}), ...style }, variant === 'icon', iconSize)}
    onClick={event => { void handleClick(event); }} {...props}>
    {children ?? (variant === 'icon' ? <ZeroIcon name={successful ? 'check' : 'copy'} />
      : variant === 'morph' ? <MorphingText text={text} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : duration, ease }} className="zero-code-block-copy-text" /> : text)}
    <span className="sr-only" role="status" aria-live="polite">{successful ? copiedLabel : ''}</span>
  </Button>;
}

function readMotionEase(value: string): NonNullable<Transition['ease']> {
  const named: Record<string, NonNullable<Transition['ease']>> = {
    linear: 'linear', ease: [0.25, 0.1, 0.25, 1], 'ease-in': 'easeIn', 'ease-out': 'easeOut', 'ease-in-out': 'easeInOut',
  };
  const curve = value.trim().match(/^cubic-bezier\(([-.\d]+),\s*([-.\d]+),\s*([-.\d]+),\s*([-.\d]+)\)$/);
  if (curve) {
    const [x1, y1, x2, y2] = curve.slice(1).map(Number);
    if ([x1, y1, x2, y2].every(Number.isFinite) && x1! >= 0 && x1! <= 1 && x2! >= 0 && x2! <= 1) return [x1!, y1!, x2!, y2!];
  }
  return named[value.trim()] ?? 'linear';
}
