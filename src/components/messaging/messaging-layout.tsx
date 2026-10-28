'use client';

import * as React from 'react';
import { ArrowLeft } from '../animate-ui/icons/arrow-left';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import './messaging.css';

export interface MessagingLayoutProps {
  sidebar: React.ReactNode;
  sidebarHeader?: React.ReactNode;
  sidebarFooter?: React.ReactNode;
  header: React.ReactNode;
  children: React.ReactNode;
  composer?: React.ReactNode;
  activity?: React.ReactNode;
  /** Controlled narrow-screen navigation; the existing AppShell remains the first sidebar. */
  mobileView?: 'list' | 'conversation';
  onBack?: () => void;
  viewportRef?: React.Ref<HTMLDivElement>;
  className?: string;
  /** Reuse the managed transcript in a widget or embedded thread without a second sidebar. */
  hideSidebar?: boolean;
}

/** Double-sidebar reference: this owns conversation sidebar + main, never a duplicate app shell. */
export function MessagingLayout({ sidebar, sidebarHeader, sidebarFooter, header, children, composer, activity, mobileView = 'list', onBack, viewportRef, className, hideSidebar = false }: MessagingLayoutProps) {
  return <section data-slot="messaging-layout" data-mobile-view={hideSidebar ? 'conversation' : mobileView} data-single-conversation={hideSidebar || undefined} className={cn('zero-messaging-layout', className)} aria-label="Messaging workspace">
    {!hideSidebar && <aside className="zero-messaging-sidebar" aria-label="Conversations">{sidebarHeader}<ScrollArea className="min-h-0 flex-1" scrollChaining="auto">{sidebar}</ScrollArea>{sidebarFooter}</aside>}
    <div className="zero-messaging-main">
      <header className="zero-messaging-header">{onBack && <Button type="button" variant="ghost" size="icon-sm" className="zero-messaging-back" aria-label="Back to conversations" onClick={onBack}><ArrowLeft className="size-4" /></Button>}{header}</header>
      <ScrollArea viewportRef={viewportRef} className="min-h-0 flex-1" scrollChaining="auto"><div className="zero-messaging-transcript">{children}</div></ScrollArea>
      {activity && <div className="zero-messaging-activity-area">{activity}</div>}
      {composer && <footer className="zero-messaging-composer-area">{composer}</footer>}
    </div>
  </section>;
}
