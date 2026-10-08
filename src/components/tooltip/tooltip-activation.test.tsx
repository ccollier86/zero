/** Public composition and activation-policy contracts; no app runtime or live data. */
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { expect, test } from 'bun:test';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipGroup } from './index';
import { hasTooltipOverflow, mergeTooltipDescription } from './tooltip-activation';
import { TooltipBody, tooltipText } from './tooltip-body';

test('overflow measures horizontal and multiline clipping without showing fitting labels', () => {
  const element = (width: number, height: number) => ({ clientWidth: 100, scrollWidth: width,
    clientHeight: 30, scrollHeight: height } as HTMLElement);
  expect(hasTooltipOverflow(null)).toBe(false);
  expect(hasTooltipOverflow(element(100, 30))).toBe(false);
  expect(hasTooltipOverflow(element(120, 30))).toBe(true);
  expect(hasTooltipOverflow(element(100, 60))).toBe(true);
});

test('external descriptions are retained, deduplicated, and never replaced by tooltip ids', () => {
  expect(mergeTooltipDescription(undefined)).toBeUndefined();
  expect(mergeTooltipDescription('existing other', 'hint')).toBe('existing other hint');
  expect(mergeTooltipDescription('existing existing hint', 'hint')).toBe('existing hint');
  expect(mergeTooltipDescription(' existing \n other ')).toBe('existing other');
});

test('rich tooltips use shared native keyboard hints and escaped display-only content', () => {
  const html = renderToString(<TooltipBody title="Save" description="Persist <script>" shortcut={['⌘', 'S']} />);
  expect(html).toContain('class="zero-tooltip-title"');
  expect(html).toContain('class="zero-tooltip-description"');
  expect(html).toContain('Persist &lt;script&gt;');
  expect(html).toContain('data-slot="kbd-group"');
  expect(html.match(/data-slot="kbd"/gu)).toHaveLength(2);
  expect(html).not.toContain('tabindex');
  expect(tooltipText([<span>Save</span>, 'changes', <strong>now</strong>])).toBe('Save changes now');
});

test('ordinary and shared-group public composition renders on the server without a portal or extra focus target', () => {
  const element = <TooltipProvider arrow={false} motion="grow"><TooltipGroup>
    <Tooltip><TooltipTrigger>Shared action</TooltipTrigger><TooltipContent title="Shared hint" /></Tooltip>
  </TooltipGroup><Tooltip><TooltipTrigger asChild><button aria-label="Ordinary action">Action</button></TooltipTrigger>
    <TooltipContent>Ordinary hint</TooltipContent></Tooltip></TooltipProvider>;
  const html = renderToString(element);
  expect(html).toContain('Shared action');
  expect(html).toContain('aria-label="Ordinary action"');
  expect(html).not.toContain('role="tooltip"');
  expect(html).not.toContain('aria-describedby');
  expect(html.match(/<button/gu)).toHaveLength(2);
});
