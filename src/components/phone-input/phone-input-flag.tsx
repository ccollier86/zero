/** Embedded upstream SVG flags avoid third-party flag requests and use Zero's existing icon fallback. */
import type { Country } from 'react-phone-number-input';
import flags from 'react-phone-number-input/flags';
import { Globe } from 'lucide-react';

/** Decorative flag; the surrounding country control supplies its accessible name. */
export function PhoneInputFlag({ country, title }: { readonly country?: Country; readonly title?: string }) {
  const Flag = country ? flags[country] : undefined;
  return <span aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-sm [&_svg]:size-full">
    {Flag ? <Flag title={title ?? country ?? ''} /> : <Globe className="size-4 text-muted-foreground" />}
  </span>;
}
