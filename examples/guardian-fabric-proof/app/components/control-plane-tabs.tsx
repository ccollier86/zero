'use client';

import * as React from 'react';

import { Button } from '@zero/framework/components/ui/button';

export interface ControlPlaneTab {
  id: string;
  label: string;
  description: string;
  content: React.ReactNode;
}

/** Compact, keyboard-native modes for one bounded control-plane workspace. */
export function ControlPlaneTabs({
  tabs,
  defaultValue,
}: {
  tabs: readonly ControlPlaneTab[];
  defaultValue: string;
}) {
  const [activeId, setActiveId] = React.useState(defaultValue);
  const rootId = React.useId();
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeId));
  const active = tabs[activeIndex] ?? tabs[0];

  React.useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeId) && tabs[0]) setActiveId(tabs[0].id);
  }, [activeId, tabs]);

  if (!active) return null;

  function selectAt(index: number) {
    const bounded = (index + tabs.length) % tabs.length;
    const next = tabs[bounded];
    if (!next) return;
    setActiveId(next.id);
    tabRefs.current[bounded]?.focus();
  }

  return (
    <section className="flex min-h-0 flex-col gap-3" aria-label="Control plane">
      <div className="rounded-lg border bg-background p-2">
        <div
          role="tablist"
          aria-label="Control-plane view"
          className="flex max-w-full gap-1 overflow-x-auto rounded-md bg-muted p-1"
        >
          {tabs.map((tab, index) => {
            const selected = tab.id === active.id;
            return (
              <Button
                key={tab.id}
                ref={(node) => { tabRefs.current[index] = node; }}
                id={`${rootId}-${tab.id}-tab`}
                type="button"
                role="tab"
                size="sm"
                variant={selected ? 'secondary' : 'ghost'}
                className={selected ? 'shrink-0 bg-background shadow-sm' : 'shrink-0'}
                aria-selected={selected}
                aria-controls={`${rootId}-${tab.id}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveId(tab.id)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight') selectAt(index + 1);
                  else if (event.key === 'ArrowLeft') selectAt(index - 1);
                  else if (event.key === 'Home') selectAt(0);
                  else if (event.key === 'End') selectAt(tabs.length - 1);
                  else return;
                  event.preventDefault();
                }}
              >
                {tab.label}
              </Button>
            );
          })}
        </div>
        <p className="px-1 pt-2 text-xs text-muted-foreground">{active.description}</p>
      </div>

      <div
        key={active.id}
        id={`${rootId}-${active.id}-panel`}
        role="tabpanel"
        aria-labelledby={`${rootId}-${active.id}-tab`}
        tabIndex={0}
        className="min-h-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {active.content}
      </div>
    </section>
  );
}
