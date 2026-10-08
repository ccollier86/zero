'use client';

/** Tokenized dialog anatomy and retained tab panels; kernel/controllers own actions and persistence. */
import * as React from 'react';
import { Dialog, Tabs } from 'radix-ui';
import { AlertCircle, X, LoaderCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { HoldButton } from './hold-button';
import { modals } from './modal-events';
import type { ModalAction, ModalBody, ModalContext, ModalDescriptor, ModalSystemState } from './modal-system.types';
import type { ResolvedModalMotion } from './modal-motion-types';
import { cn } from '../lib/utils';
import { useMediaQuery } from '../hooks/use-media-query';

interface ModalShellProps {
  readonly descriptor: ModalDescriptor;
  readonly context: ModalContext;
  readonly state: ModalSystemState;
  readonly motion: ResolvedModalMotion;
  readonly innerRef: React.Ref<HTMLDivElement>;
}

function renderBody(body: ModalBody | undefined, context: ModalContext) {
  return typeof body === 'function' ? body(context) : body;
}

function ModalHoldAction({ action, context, disabled }: { action: ModalAction; context: ModalContext; disabled: boolean }) {
  const confirm = React.useCallback(() => { void modals.performAction(context.id, action.id); },
    [context, action.id, action.onClick, action.value]);
  return <div data-modal-action-role={action.role} data-modal-action-primary={action.variant === 'primary' || action.variant === 'danger' || undefined}>
    <HoldButton disabled={disabled} label={action.label} holdingLabel={action.variant === 'danger' ? 'Deleting…' : 'Confirming…'}
      holdDuration={action.holdDuration ?? 1500} onConfirm={confirm} />
  </div>;
}

/** Header and footer are always outside the active scroll owner; feature code fills slots only. */
export function ModalShell({ descriptor: d, context, state, motion, innerRef }: ModalShellProps) {
  const sections = d.layout === 'tabs' || d.layout === 'nav' ? d.sections : [];
  const [selected, setSelected] = React.useState(d.initialSection ?? sections[0]?.id ?? '');
  const [visited, setVisited] = React.useState(() => new Set([d.initialSection ?? sections[0]?.id ?? '']));
  const active = sections.some(section => section.id === selected) ? selected : sections[0]?.id ?? '';
  const phone = useMediaQuery('(max-width: 640px)', { initializeWithValue: true });
  const vertical = d.layout === 'nav' && !phone;
  const list = React.useRef<HTMLDivElement>(null), indicator = React.useRef<HTMLSpanElement>(null);
  const panels = React.useRef(new Map<string, HTMLDivElement>());
  const [edges, setEdges] = React.useState({ scrolled: false, more: false });
  const [formId, setFormId] = React.useState<string | undefined>();

  const measure = React.useCallback(() => {
    const panel = panels.current.get(active || 'content');
    if (panel) {
      const next = { scrolled: panel.scrollTop > 1, more: panel.scrollTop + panel.clientHeight < panel.scrollHeight - 1 };
      setEdges(previous => previous.scrolled === next.scrolled && previous.more === next.more ? previous : next);
      const forms = [...panel.querySelectorAll('form')].filter(form => !form.closest('[hidden]'));
      if (forms.length === 1) {
        if (!forms[0]!.id) forms[0]!.id = `zero-modal-form-${context.id}-${active || 'content'}`;
        setFormId(forms[0]!.id);
      } else setFormId(undefined);
    }
    const trigger = list.current?.querySelector<HTMLElement>('[data-state="active"]');
    if (trigger && indicator.current) {
      indicator.current.style.width = `${vertical ? trigger.offsetWidth : trigger.offsetWidth}px`;
      indicator.current.style.height = `${vertical ? trigger.offsetHeight : 2}px`;
      indicator.current.style.transform = `translate(${trigger.offsetLeft}px, ${vertical ? trigger.offsetTop : 0}px)`;
    }
  }, [active, context.id, vertical]);
  React.useLayoutEffect(() => {
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    const mutation = typeof MutationObserver === 'function' ? new MutationObserver(measure) : null;
    for (const panel of panels.current.values()) observer?.observe(panel);
    for (const panel of panels.current.values()) mutation?.observe(panel, { childList: true, subtree: true, characterData: true });
    if (list.current) observer?.observe(list.current);
    return () => { observer?.disconnect(); mutation?.disconnect(); };
  }, [measure, sections.length]);
  React.useLayoutEffect(() => {
    const panel = panels.current.get(active), trigger = list.current?.querySelector<HTMLElement>('[data-state="active"]');
    trigger?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (panel && !motion.reducedMotion && typeof panel.animate === 'function') {
      const animation = panel.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
        { duration: motion.timings.tabs, easing: motion.easing.out });
      return () => animation.cancel();
    }
  }, [active, motion]);

  const registerPanel = (id: string) => (element: HTMLDivElement | null) => {
    if (element) panels.current.set(id, element); else panels.current.delete(id);
  };
  const ownedForm = (id: string | undefined): HTMLFormElement | undefined => {
    if (!id) return;
    const panel = panels.current.get(active || 'content');
    return panel ? [...panel.querySelectorAll('form')].find(form => form.id === id && !form.closest('[hidden]')) : undefined;
  };
  const onSubmit = (event: React.FormEvent) => {
    event.stopPropagation();
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (!(event.target instanceof HTMLFormElement) || !ownedForm(event.target.id)) return;
    const native = event.nativeEvent as SubmitEvent;
    const actionId = native.submitter?.getAttribute('data-modal-action-id');
    const submit = d.actions?.find(action => action.submit
      && (!actionId || action.id === actionId)
      && (action.formId ?? formId) === (event.target as HTMLFormElement).id
      && !(state.disabledActions[action.id] ?? action.disabled ?? false));
    if (submit && !state.busy) void modals.performAction(context.id, submit.id);
  };
  const panelProps = { className: 'zero-modal__body', 'data-slot': d.dataSlot ? `${d.dataSlot}-body` : 'modal-body', 'data-scrollbar': d.scrollbar ?? 'auto',
    inert: state.busy && !d.allowEditingWhilePending || undefined, onScroll: measure };
  const nav = sections.length > 0 && <Tabs.List ref={list} className={cn('zero-modal__tabs', vertical && 'zero-modal__nav')}
    aria-label={d.title} data-scrollbar={d.navScrollbar ?? 'auto'}>
    <span ref={indicator} className="zero-modal__indicator" aria-hidden="true" />
    {sections.map((section, index) => <React.Fragment key={section.id}>
      {d.layout === 'nav' && section.group && section.group !== sections[index - 1]?.group
        && <span className="zero-modal__nav-group">{section.group}</span>}
      <Tabs.Trigger value={section.id} className="zero-modal__tab" disabled={state.busy}>
        {section.icon != null && <span aria-hidden="true">{section.icon}</span>}<span>{section.label}</span>
        {section.badge != null && <span className="zero-modal__count">{section.badge}</span>}
      </Tabs.Trigger>
    </React.Fragment>)}
  </Tabs.List>;

  const content = <div ref={innerRef} data-zero-modal-inner className="zero-modal__inner" data-layout={d.layout ?? 'content'} data-tone={d.tone ?? 'default'}
    data-scrolled={edges.scrolled || undefined} data-more={edges.more || undefined} onSubmit={onSubmit}
    style={{ '--zero-modal-tabs-duration': `${motion.timings.tabs}ms`, '--zero-modal-ease-out': motion.easing.out } as React.CSSProperties}>
    <header className="zero-modal__top" data-slot="dialog-header">
      <div className="zero-modal__head">
        {d.icon != null && <div className="zero-modal__icon" aria-hidden="true">{d.icon}</div>}
        <div className="zero-modal__titles"><div className="zero-modal__titleline">
          <Dialog.Title className="zero-modal__title">{d.title}</Dialog.Title>
          {d.meta != null && <span className="zero-modal__meta">{d.meta}</span>}</div>
          {d.description != null && <Dialog.Description className="zero-modal__description">{d.description}</Dialog.Description>}
        </div>
        <div className="zero-modal__head-actions">
          {d.headerActions?.slice(0, 2).map(action => <Button key={action.id} type="button" variant="ghost" size="icon-sm"
            aria-label={action.label} disabled={state.busy} onClick={() => {
              if (context.signal.aborted) return;
              void modals.performHeaderAction(context.id, action.id);
            }}>{action.icon}</Button>)}
          {d.dismissible !== false && <Button type="button" variant="ghost" className="zero-modal__close" aria-label="Close"
            disabled={state.busy} onClick={() => { void context.requestClose('close-button'); }}><X aria-hidden="true" /></Button>}
        </div>
      </div>
      {d.layout === 'tabs' && nav}
    </header>
    {sections.length ? <div className={cn('zero-modal__bodywrap', d.layout === 'nav' && 'zero-modal__split')}>
      {d.layout === 'nav' && nav}
      <div className="zero-modal__panels">{sections.map(section => <Tabs.Content key={section.id} value={section.id} forceMount
        {...panelProps} ref={registerPanel(section.id)} hidden={section.id !== active} tabIndex={0}>
        {(visited.has(section.id) || section.id === active) && renderBody(section.body, context)}
      </Tabs.Content>)}</div>
    </div> : d.body != null && <div {...panelProps} ref={registerPanel('content')}>{renderBody(d.body, context)}</div>}
    {(d.actions?.length || d.footer?.start != null || state.error) && <footer className="zero-modal__foot" data-slot={d.dataSlot ? `${d.dataSlot}-footer` : 'modal-footer'}>
      <div className="zero-modal__foot-start">{state.error
        ? <div role="alert" className="zero-modal__error"><AlertCircle aria-hidden="true" /><span>{state.error}</span></div>
        : d.footer?.start}</div>
      <div className="zero-modal__actions">{d.actions?.map(action => {
        const disabled = state.busy || (state.disabledActions[action.id] ?? action.disabled ?? false);
        if (action.holdToConfirm) return <ModalHoldAction key={action.id} action={action} context={context} disabled={disabled} />;
        const targetForm = action.formId ?? formId;
        return <Button key={action.id} type={action.submit && targetForm ? 'submit' : 'button'} form={action.submit ? targetForm : undefined}
          data-modal-action-id={action.id}
          data-modal-action-role={action.role} data-modal-action-primary={action.variant === 'primary' || action.variant === 'danger' || undefined}
          variant={action.variant === 'danger' ? 'destructive' : action.variant === 'primary' ? 'default' : action.variant === 'ghost' ? 'ghost' : 'outline'}
          disabled={disabled} aria-busy={state.actionId === action.id || undefined} onClick={event => {
            if (action.submit && targetForm) { if (!ownedForm(targetForm)) event.preventDefault(); return; }
            event.preventDefault(); void modals.performAction(context.id, action.id);
          }}>
          {state.actionId === action.id && <LoaderCircle className="zero-modal__spinner" aria-hidden="true" />}{action.label}
        </Button>;
      })}</div>
    </footer>}
  </div>;
  return sections.length ? <Tabs.Root value={active} onValueChange={value => {
    setSelected(value); setVisited(previous => new Set([...previous, value]));
  }} orientation={vertical ? 'vertical' : 'horizontal'} className="zero-modal__tabroot">{content}</Tabs.Root> : content;
}
