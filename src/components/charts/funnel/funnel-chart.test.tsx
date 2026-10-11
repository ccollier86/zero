/** Server-rendering qualification of the public Funnel organism and custom React inspection bodies. */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'bun:test';
import { FunnelChart, FunnelDataTable } from './funnel-chart';
import { FunnelStageTooltip } from './funnel-inspection';
import { buildFunnelModel, inspectFunnelStage } from './funnel-model';
import type { FunnelData } from './funnel-types';
const data: FunnelData = { segments: [{ id: 'mobile', label: 'Mobile' }, { id: 'desktop', label: 'Desktop' }], stages: [
  { id: 'visit', label: 'Visited store', values: { mobile: 70200, desktop: 29800 } },
  { id: 'buy', label: 'Purchased', values: { mobile: 1600, desktop: 2100 } },
] };
describe('Funnel React contracts', () => {
  test('SSR renders complete observed cohort counts and zero-event attribution guidance', () => {
    const markup = renderToStaticMarkup(<FunnelChart data={data} label="Checkout funnel" period="Last 30 days" unit="sessions" />);
    expect(markup).toContain('data-slot="funnel-chart"'); expect(markup).toContain('3.7% convert');
    expect(markup).toContain('<caption>Checkout funnel, Last 30 days</caption>'); expect(markup).toContain('70,200 sessions'); expect(markup).toContain('2,100 sessions');
    expect(markup).toContain('Flow particles illustrate aggregate retention probabilities, not observed individual events.');
    expect(markup).toContain('aria-pressed="true"'); expect(markup).toContain('data-slot="switch"');
  });
  test('tagged reserved-name segment choices stay unambiguous; retired choices are masked', () => {
    const reserved: FunnelData = { segments: [{ id: 'total', label: 'Total cohort' }], stages: [{ id: 'entry', values: { total: 8 } }, { id: 'end', values: { total: 4 } }] };
    expect(renderToStaticMarkup(<FunnelChart data={reserved} label="Reserved" view={{ kind: 'segment', id: 'total' }} />)).toContain('50% convert');
    expect(renderToStaticMarkup(<FunnelChart data={reserved} label="Reserved" view={{ kind: 'segment', id: 'retired' }} />)).toContain('data-view="total"');
  });
  test('full table stays independent from isolated display and reports undefined rates honestly', () => {
    const model = buildFunnelModel(data), markup = renderToStaticMarkup(<FunnelDataTable model={model} label="All cohorts" />);
    expect(markup).toContain('29,800'); expect(markup).toContain('100,000'); expect(markup).toContain('3.7%');
    const empty = renderToStaticMarkup(<FunnelChart data={{ stages: [{ id: 'start', value: 0 }, { id: 'end', value: 0 }] }} label="Empty" />);
    expect(empty).toContain('— convert'); expect(empty).toContain('No data'); expect(empty).not.toContain('NaN');
  });
  test('split inspector renders every segment, aggregate total and retained share', () => {
    const model = buildFunnelModel(data), inspection = inspectFunnelStage(model, { kind: 'split' }, 'buy')!;
    const markup = renderToStaticMarkup(<FunnelStageTooltip {...inspection} model={model} formatValue={value => String(value)} unit="sessions" />);
    expect(markup).toContain('Mobile'); expect(markup).toContain('Desktop'); expect(markup).toContain('1600'); expect(markup).toContain('3700');
    expect(markup).toContain('3.7% kept from visited store'); expect(markup).toContain('var(--zero-funnel-series-2, var(--zero-chart-orange))');
  });
  test('layout policy and data bounds validate during SSR; optional chrome can be omitted', () => {
    expect(() => renderToStaticMarkup(<FunnelChart data={data} label="Invalid" height={Infinity} />)).toThrow();
    expect(() => renderToStaticMarkup(<FunnelChart data={data} label="Invalid" height={0} />)).toThrow();
    const markup = renderToStaticMarkup(<FunnelChart data={data} label="Minimal" controls={false} showDropOff={false} />);
    expect(markup).not.toContain('zero-funnel__controls'); expect(markup).toContain('class="zero-funnel__drops" aria-hidden="true" hidden=""');
  });
});
