/**
 * footer-section.types.ts
 *
 * Defines the public footer section contract. This file owns type shape only;
 * rendering and tokenized layout live in footer-section.tsx.
 */

import type * as React from 'react';

import type { HeroAction } from '../hero';

export interface FooterSectionLink {
  /** Link label rendered for text links and accessible icon labels. */
  label: React.ReactNode;
  /** Link destination. */
  href: string;
  /** Optional icon rendered before the label or as the visible social item. */
  icon?: React.ReactNode;
  /** Opens the link in a new tab with safe noreferrer behavior. */
  external?: boolean;
  /** Accessible label override when the visible content is icon-only. */
  ariaLabel?: string;
}

export interface FooterSectionBrand {
  /** Brand label shown beside the mark. */
  label: React.ReactNode;
  /** Optional brand/home destination. */
  href?: string;
  /** Optional mark or logo node. */
  mark?: React.ReactNode;
  /** Short brand description rendered under the logo row. */
  description?: React.ReactNode;
}

export interface FooterSectionProps extends React.ComponentProps<'footer'> {
  /** Brand block rendered on the left side of the footer. */
  brand: FooterSectionBrand;
  /** Optional heading rendered above the footer navigation links. */
  linksTitle?: React.ReactNode;
  /** Primary footer navigation links. */
  links?: readonly FooterSectionLink[];
  /** Label above the optional action group. */
  actionTitle?: React.ReactNode;
  /** Supporting copy rendered above the optional action group. */
  actionDescription?: React.ReactNode;
  /** Hero-compatible action buttons rendered in the right column. */
  actions?: readonly HeroAction[];
  /** Optional label rendered before social or secondary icon links. */
  socialTitle?: React.ReactNode;
  /** Bottom-row social or secondary icon links. */
  socialLinks?: readonly FooterSectionLink[];
  /** Copyright or legal text rendered in the bottom row. */
  copyright?: React.ReactNode;
  /** Visual tone for the full-width footer band. */
  tone?: 'accent' | 'surface';
  /** Inner constrained content class override. */
  innerClassName?: string;
  /** Brand area class override. */
  brandClassName?: string;
  /** Link list class override. */
  linksClassName?: string;
  /** Action column class override. */
  actionClassName?: string;
  /** Bottom row class override. */
  bottomClassName?: string;
}
