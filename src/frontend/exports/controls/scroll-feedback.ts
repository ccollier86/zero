/** Scroll anchoring, toast and QR feedback. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

// ─── Smooth Scroll-To-Bottom ────────────────────────────────────────────
export {
  StickToBottom,
  useStickToBottom,
  useStickToBottomContext,
} from 'use-stick-to-bottom';
export type {
  Animation,
  GetTargetScrollTop,
  ScrollElements,
  ScrollToBottom,
  ScrollToBottomOptions,
  SpringAnimation,
  StickToBottomContext,
  StickToBottomInstance,
  StickToBottomOptions,
  StickToBottomProps,
  StickToBottomState,
  StopScroll,
} from 'use-stick-to-bottom';

// ─── Toast ──────────────────────────────────────────────────────────────
export { Toaster } from '../../../components/ui/sonner';
export type { ToasterProps } from '../../../components/ui/sonner';
export { toast } from 'sonner';

// ─── QR Code ───────────────────────────────────────────────────────────
export { QRCode } from '../../../components/qr-code';
export type { QRCodeProps } from '../../../components/qr-code';
