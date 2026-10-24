'use client';
import * as React from 'react';
import { Archive, ArrowDownToLine, ChevronDown, ChevronLeft, ChevronRight, File, Inbox, Mail, MailOpen, Paperclip, Search,
  Reply, ReplyAll, Forward, Star, Trash2, Folder, FilePenLine, RefreshCw, Check, MoreHorizontal } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '../dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip';
import { MenuActiveHighlight } from '../overlays/menu-active-highlight';
import { cn } from '../../lib/utils';
import { EMAIL_DRAFT_FOLDER, type EmailInboxAccount, type EmailInboxAttachment, type EmailInboxFolder, type EmailInboxMessage,
  type EmailInboxRow } from '../../email/inbox/contracts';
import { normalizedContentId } from './html/email-html-policy';
import { EmailHtmlBody, EmailPlainTextBody } from './html/email-html-body';
import type { EmailInboxController, EmailInboxState } from './email-inbox-controller';

export interface EmailInboxPartProps { controller: EmailInboxController; state: EmailInboxState; onAction: (work: () => Promise<unknown>) => void }
export function EmailIconButton({ label, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return <Tooltip><TooltipTrigger asChild><Button type="button" size="icon-sm" variant="ghost" aria-label={label} {...props}>{children}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}
export function EmailMailboxSwitcher({ accounts, selected, onChange, enabled = true }: { accounts: readonly EmailInboxAccount[]; selected: EmailInboxAccount | null; onChange: (id: string) => void; enabled?: boolean }) {
  if (!selected) return null;
  if (!enabled || accounts.length < 2) return <div className="min-w-0"><div className="truncate text-[13px] font-semibold">{selected.label}</div><div className="truncate text-[11px] text-muted-foreground">{selected.address}</div></div>;
  return <Select value={selected.id} onValueChange={onChange}><SelectTrigger className="h-10 min-w-0 flex-1 border-0 bg-transparent px-2 shadow-none"><SelectValue /></SelectTrigger><SelectContent>
    {accounts.map(account => <SelectItem key={account.id} value={account.id} description={account.address}>{account.label}</SelectItem>)}
  </SelectContent></Select>;
}

export function EmailFolderNav({ controller, state, onAction }: EmailInboxPartProps) {
  const [container, setContainer] = React.useState<HTMLElement | null>(null);
  const special = state.folders.filter(folder => folder.path === EMAIL_DRAFT_FOLDER || folder.path.toUpperCase() === 'INBOX' || folder.specialUse);
  const custom = state.folders.filter(folder => !special.includes(folder));
  const sort = (folder: EmailInboxFolder) => folder.path.toUpperCase() === 'INBOX' ? 0 : folder.path === EMAIL_DRAFT_FOLDER ? 1 : folder.specialUse === '\\Sent' ? 2 : folder.specialUse === '\\Archive' ? 3 : 4;
  const render = (folder: EmailInboxFolder) => { const Icon = folderIcon(folder), active = folder.path === state.folder;
    return <button type="button" key={folder.path} className="zero-email-folder" data-active={active || undefined} aria-current={active ? 'page' : undefined}
      onClick={() => onAction(() => controller.selectFolder(folder.path))}><Icon aria-hidden="true" className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{folder.name}</span>
      {(folder.unread !== undefined && folder.unread > 0 || folder.path === EMAIL_DRAFT_FOLDER && !!folder.total) && <span className="zero-email-folder-count">{folder.path === EMAIL_DRAFT_FOLDER ? folder.total : folder.unread}</span>}</button>;
  };
  return <nav aria-label="Email folders" className="zero-email-folder-nav" ref={setContainer}>
    <MenuActiveHighlight container={container} activeSelector="[data-active]" hoverSelector=".zero-email-folder" preserveSelectionFill={false} />
    {[...special].sort((a, b) => sort(a) - sort(b)).map(render)}
    {custom.length > 0 && <details className="col-span-2"><summary className="cursor-pointer px-2 py-1 text-[11px] text-muted-foreground">Folders <span className="tabular-nums">{custom.length}</span></summary>
      <ScrollArea className="max-h-36" style={{ height: Math.min(144, custom.length * 30) }}><div className="relative grid grid-cols-2 gap-1 p-1">{custom.map(render)}</div></ScrollArea>
    </details>}
  </nav>;
}

export function EmailMessageRow({ row, selected, checked, onSelect, onCheck, onStar, animateInsert = false }: {
  row: EmailInboxRow; selected: boolean; checked: boolean; onSelect: () => void; onCheck?: (value: boolean) => void; onStar?: () => void; animateInsert?: boolean;
}) {
  const unread = !row.flags.includes('\\Seen') && !row.draftId, starred = row.flags.includes('\\Flagged'), reduced = useReducedMotion();
  const sender = row.draftId ? row.to.map(value => value.name || value.address).join(', ') || 'New message' : row.from.map(value => value.name || value.address).join(', ') || 'Unknown sender';
  return <motion.div layout="position" role="listitem" data-email-row="" data-selected={selected || undefined} data-unread={unread || undefined}
    className="zero-email-row" initial={animateInsert && !reduced ? { opacity: 0, y: -5 } : false} animate={{ opacity: 1, y: 0 }}
    transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38 }}>
    {row.ref && onCheck && <div className={cn('zero-email-row-check', checked && 'is-checked')}><Checkbox aria-label={`Select ${row.subject || 'message'}`} checked={checked} onCheckedChange={value => onCheck(value === true)} /></div>}
    <button type="button" className="zero-email-row-open" data-email-row-open="" aria-pressed={selected} onClick={onSelect}>
      <span className="zero-email-row-meta"><span className="zero-email-row-sender">{row.draftId && <span className="mr-1 text-primary">Draft</span>}{sender}</span><time dateTime={row.date} className="zero-email-row-time">{shortDate(row.date)}</time></span>
      <span className="zero-email-row-subject">{unread && <span className="zero-email-unread-dot" />}{row.subject || '(No subject)'}</span>
      <span className="zero-email-row-preview">{row.preview || (row.draftId ? 'Continue writing your message' : row.to.map(value => value.address).join(', '))}</span>
      {!!row.attachmentCount && <span className="absolute bottom-3 right-9 text-muted-foreground"><Paperclip aria-label="Has attachments" className="size-3" /></span>}
    </button>
    {onStar && <button type="button" className={cn('zero-email-row-star', starred && 'is-starred')} aria-label={starred ? 'Remove star' : 'Star message'} aria-pressed={starred} onClick={onStar}><Star aria-hidden="true" className={cn('size-3.5', starred && 'fill-current')} /></button>}
  </motion.div>;
}

export function EmailMessageList({ controller, state, onAction }: EmailInboxPartProps) {
  const viewport = React.useRef<HTMLDivElement>(null);
  const [listContainer, setListContainer] = React.useState<HTMLDivElement | null>(null);
  const previous = React.useRef({ scope: '', page: -1, ids: new Set<string>() });
  const scope = `${state.account?.id}:${state.folder}:${state.search}:${state.filter}`;
  React.useLayoutEffect(() => { previous.current = { scope, page: state.page, ids: new Set(state.rows.map(row => row.id)) }; }, [scope, state.rows, state.page]);
  React.useEffect(() => { viewport.current?.scrollTo({ top: 0 }); controller.setNearTop(true); }, [controller, scope, state.page]);
  React.useEffect(() => {
    const element = viewport.current; if (!element) return;
    const scroll = () => controller.setNearTop(element.scrollTop < 36);
    element.addEventListener('scroll', scroll, { passive: true }); return () => element.removeEventListener('scroll', scroll);
  }, [controller]);
  const canInsert = previous.current.scope === scope && previous.current.page === state.page && previous.current.ids.size > 0;
  const currentFolder = state.folders.find(folder => folder.path === state.folder);
  const bulkRows = state.rows.filter(row => state.checked.includes(row.id));
  const canSelect = !!state.account?.capabilities.flags || !!state.account?.capabilities.move;
  return <div className="zero-email-message-list">
    <div className="zero-email-list-heading"><h2>{currentFolder?.name ?? 'Messages'}</h2><span className="zero-email-counter">{state.total ?? '—'}</span>
      <div className="ml-auto"><EmailIconButton label="Refresh messages" disabled={state.loading} onClick={() => onAction(() => controller.refresh())}><RefreshCw className={cn('size-3.5', state.loading && 'animate-spin')} /></EmailIconButton></div>
    </div>
    <div className="zero-email-search"><Search className="size-3.5 text-muted-foreground" aria-hidden="true" /><Input aria-label="Search this folder" placeholder="Search mail…" value={state.search} onChange={event => controller.setSearch(event.target.value)} /></div>
    <div className="zero-email-list-filters" role="group" aria-label="Filter messages">
      {(['all', 'unread', 'starred'] as const).map(filter => <button key={filter} type="button" aria-pressed={state.filter === filter} onClick={() => controller.setFilter(filter)}>{filter === 'all' ? 'All mail' : filter === 'unread' ? 'Unread' : 'Starred'}</button>)}
      {canSelect && state.rows.some(row => row.ref) && <span className="ml-auto flex items-center pr-1"><Checkbox aria-label="Select all messages on this page" checked={!!state.checked.length && state.checked.length === state.rows.filter(row => row.ref).length} onCheckedChange={value => controller.checkAll(value === true)} /></span>}
    </div>
    {!!bulkRows.length && canSelect && <div className="zero-email-bulk-bar"><span>{bulkRows.length} selected</span>{state.account?.capabilities.flags && <Button size="xs" variant="ghost" onClick={() => onAction(async () => { for (const row of bulkRows) await controller.setFlags(row, { seen: true }); })}>Mark read</Button>}
      {state.account?.capabilities.move && <DropdownMenu><DropdownMenuTrigger asChild><Button size="xs" variant="ghost">Move<ChevronDown className="size-3" /></Button></DropdownMenuTrigger><DropdownMenuContent>{state.folders.filter(folder => folder.path !== state.folder && folder.path !== EMAIL_DRAFT_FOLDER).map(folder => <DropdownMenuItem key={folder.path} onSelect={() => onAction(async () => { for (const row of bulkRows) await controller.move(row, folder.path); })}>{folder.name}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>}
    </div>}
    {state.newMail && <button type="button" className="zero-email-new-mail" onClick={() => onAction(async () => { await controller.showLatest(); viewport.current?.scrollTo({ top: 0, behavior: 'smooth' }); })}><Mail className="size-3.5" />New mail available<ChevronDown className="size-3.5" /></button>}
    <ScrollArea viewportRef={viewport} className="min-h-0 flex-1" scrollChaining="auto">
      <div ref={setListContainer} className="relative" role="list" aria-label="Messages" aria-busy={state.loading} onKeyDown={event => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || !(event.target instanceof HTMLElement) || !event.target.matches('[data-email-row-open]')) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-email-row-open]')], index = buttons.indexOf(event.target as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
        event.preventDefault(); buttons[next]?.focus();
      }}>
        <MenuActiveHighlight container={listContainer} activeSelector="[data-selected]" hoverSelector="[data-email-row]" preserveSelectionFill />
        {state.rows.map(row => <EmailMessageRow key={row.id} row={row} selected={state.selectedId === row.id} checked={state.checked.includes(row.id)}
          animateInsert={canInsert && !previous.current.ids.has(row.id)} onSelect={() => onAction(() => controller.selectRow(row))} onCheck={canSelect ? value => controller.check(row.id, value) : undefined}
          onStar={row.ref && state.account?.capabilities.flags ? () => onAction(() => controller.setFlags(row, { flagged: !row.flags.includes('\\Flagged') })) : undefined} />)}
        {!state.rows.length && <div className="zero-email-list-empty" role="status"><Inbox className="size-6" /><b>{state.loading || state.status === 'loading' ? 'Getting your mail…' : state.search ? 'No matching messages' : 'You’re all caught up'}</b><span>{state.search ? 'Try a different search or filter.' : state.loading ? 'Connecting securely to your mailbox.' : 'New messages will appear here automatically.'}</span></div>}
      </div>
    </ScrollArea>
    <div className="zero-email-pagination"><span>{state.rows.length ? `${state.page * 40 + 1}–${state.page * 40 + state.rows.length}` : '0'}{state.total !== null ? ` of ${state.total}` : ''}</span>
      <span className="ml-auto inline-flex gap-1"><EmailIconButton label="Previous page" disabled={state.page === 0 || state.loading} onClick={() => onAction(() => controller.previousPage())}><ChevronLeft className="size-3.5" /></EmailIconButton><EmailIconButton label="Next page" disabled={!state.cursor || state.loading} onClick={() => onAction(() => controller.nextPage())}><ChevronRight className="size-3.5" /></EmailIconButton></span>
    </div>
  </div>;
}

export function EmailHeaders({ message }: { message: EmailInboxMessage }) {
  const sender = message.from[0], name = sender?.name || sender?.address || 'Unknown sender';
  return <div className="zero-email-headers"><span className="zero-email-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline gap-x-2"><strong className="text-[13px] font-semibold">{name}</strong>{sender?.name && <span className="text-[11px] text-muted-foreground">{sender.address}</span>}</div>
    <Popover><PopoverTrigger asChild><button type="button" className="mt-1 inline-flex max-w-full items-center gap-1 text-[11px] text-muted-foreground"><span className="truncate">to {message.to.map(value => value.name || value.address).join(', ') || 'undisclosed recipients'}</span><ChevronDown className="size-3 shrink-0" /></button></PopoverTrigger>
      <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-4"><dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
        {([['From', message.from], ['To', message.to], ['Cc', message.cc], ['Bcc', message.bcc], ['Reply to', message.replyTo]] as const).filter(([, values]) => values.length).map(([label, values]) => <React.Fragment key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-words">{values.map(value => value.name ? `${value.name} <${value.address}>` : value.address).join(', ')}</dd></React.Fragment>)}
        <dt className="text-muted-foreground">Date</dt><dd>{longDate(message.date)}</dd>{message.messageId && <><dt className="text-muted-foreground">Message ID</dt><dd className="break-all font-mono text-[10px]">{message.messageId}</dd></>}
      </dl></PopoverContent>
    </Popover>
  </div><time className="self-start whitespace-nowrap text-[11px] text-muted-foreground" dateTime={message.date}>{shortDate(message.date)}</time></div>;
}

export function EmailAttachments({ files, onDownload }: { files: readonly EmailInboxAttachment[]; onDownload: (file: EmailInboxAttachment) => void }) {
  if (!files.length) return null;
  return <section className="zero-email-attachments" aria-label="Attachments"><h3><Paperclip className="size-3.5" />{files.length} attachment{files.length === 1 ? '' : 's'}</h3><div className="flex flex-wrap gap-2">{files.map(file => <button type="button" key={file.id} className="zero-email-attachment" onClick={() => onDownload(file)}><span className="zero-email-file-icon"><File className="size-4" /></span><span className="min-w-0 flex-1 text-left"><b className="block truncate text-xs font-medium">{file.filename}</b><span className="text-[10px] text-muted-foreground">{file.size < 1024 ? `${file.size} B` : `${Math.round(file.size / 1024)} KB`}</span></span><ArrowDownToLine className="size-3.5 text-muted-foreground" /></button>)}</div></section>;
}

export function EmailReader({ controller, state, onAction }: EmailInboxPartProps) {
  const message = state.message, [plain, setPlain] = React.useState(false);
  const messageRef = React.useRef(message); messageRef.current = message;
  React.useEffect(() => { setPlain(false); }, [message?.id]);
  const inline = React.useCallback(async (id: string, signal: AbortSignal) => {
    const current = messageRef.current; if (!current) throw new Error('Message changed.');
    const matches = current.attachments.filter(file => file.contentId && normalizedContentId(file.contentId) === id);
    if (matches.length !== 1) throw new Error('Inline image is missing or ambiguous.');
    return new Uint8Array(await (await controller.attachment(matches[0]!, current, signal)).arrayBuffer());
  }, [controller, message?.id]);
  const mapped = (role: string) => state.folders.find(folder => folder.specialUse === role)?.path;
  if (!message) return <div className="zero-email-reader-empty" role="status"><span className="zero-email-empty-glyph"><MailOpen className="size-7" /></span><h2>{state.reading ? 'Opening your message…' : 'A little room to focus'}</h2><p>{state.reading ? 'Loading the message securely.' : 'Choose an email to read, or start a new conversation.'}</p>{!state.reading && state.account?.capabilities.send && <Button type="button" variant="outline" size="sm" onClick={() => onAction(() => controller.compose())}><FilePenLine className="size-3.5" />Compose a message</Button>}</div>;
  return <article className="zero-email-reader" aria-label="Selected email">
    <div className="zero-email-reader-toolbar">
      {state.account?.capabilities.move && <>
        {mapped('\\Archive') && <EmailIconButton label="Archive message" onClick={() => onAction(() => controller.move(message, mapped('\\Archive')!))}><Archive className="size-4" /></EmailIconButton>}
        {mapped('\\Trash') && <EmailIconButton label="Move to trash" onClick={() => onAction(() => controller.move(message, mapped('\\Trash')!))}><Trash2 className="size-4" /></EmailIconButton>}
        <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="Move message to folder"><Folder className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuLabel>Move to</DropdownMenuLabel><DropdownMenuSeparator />{state.folders.filter(folder => folder.path !== state.folder && folder.path !== EMAIL_DRAFT_FOLDER).map(folder => <DropdownMenuItem key={folder.path} onSelect={() => onAction(() => controller.move(message, folder.path))}><Folder className="size-3.5" />{folder.name}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
      </>}
      {state.account?.capabilities.flags && <><EmailIconButton label={message.flags.includes('\\Seen') ? 'Mark unread' : 'Mark read'} onClick={() => onAction(() => controller.setFlags(message, { seen: !message.flags.includes('\\Seen') }))}><Mail className="size-4" /></EmailIconButton><EmailIconButton label={message.flags.includes('\\Flagged') ? 'Remove star' : 'Star message'} onClick={() => onAction(() => controller.setFlags(message, { flagged: !message.flags.includes('\\Flagged') }))}><Star className={cn('size-4', message.flags.includes('\\Flagged') && 'fill-current text-primary')} /></EmailIconButton></>}
      <span className="ml-auto text-[11px] text-muted-foreground">{plain ? 'Plain text' : 'Email'}</span>
      {message.html && <EmailIconButton label={plain ? 'Show formatted email' : 'Show plain text'} onClick={() => setPlain(!plain)}><MoreHorizontal className="size-4" /></EmailIconButton>}
    </div>
    <ScrollArea className="min-h-0 flex-1" orientation="both" scrollbarOrientation="vertical" scrollChaining="auto">
      <div className="zero-email-reader-content"><header><h1 className="zero-email-subject" dir="auto">{message.subject || '(No subject)'}</h1><EmailHeaders message={message} /></header>
        <div className={cn('zero-email-reading-canvas', message.html && !plain && 'is-html')}>
          {message.html && !plain ? <EmailHtmlBody contentKey={`${controller.scopeKey}:${state.account?.id}:${message.id}`} html={message.html} text={message.text} loadInlineImage={inline} /> : <EmailPlainTextBody text={message.text} />}
        </div>
        <EmailAttachments files={message.attachments} onDownload={file => onAction(async () => {
          const blob = await controller.attachment(file, message); const url = URL.createObjectURL(blob), link = document.createElement('a');
          link.href = url; link.download = file.filename; link.rel = 'noopener'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        })} />
        {state.account?.capabilities.send && <footer className="zero-email-reply-actions"><Button type="button" variant="outline" size="sm" onClick={() => onAction(() => controller.compose('reply'))}><Reply className="size-3.5" />Reply</Button><Button type="button" variant="ghost" size="sm" onClick={() => onAction(() => controller.compose('reply-all'))}><ReplyAll className="size-3.5" />Reply all</Button><Button type="button" variant="ghost" size="sm" onClick={() => onAction(() => controller.compose('forward'))}><Forward className="size-3.5" />Forward</Button></footer>}
      </div>
    </ScrollArea>
  </article>;
}
function folderIcon(folder: EmailInboxFolder) { return folder.path.toUpperCase() === 'INBOX' ? Inbox : folder.path === EMAIL_DRAFT_FOLDER || folder.specialUse === '\\Drafts' ? FilePenLine : folder.specialUse === '\\Sent' ? Mail : folder.specialUse === '\\Archive' ? Archive : folder.specialUse === '\\Trash' ? Trash2 : Folder; }
function shortDate(value?: string) { if (!value) return ''; const date = new Date(value); if (!Number.isFinite(date.getTime())) return ''; const now = new Date(); return new Intl.DateTimeFormat(undefined, date.toDateString() === now.toDateString() ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' }).format(date); }
function longDate(value?: string) { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unknown date'; }
