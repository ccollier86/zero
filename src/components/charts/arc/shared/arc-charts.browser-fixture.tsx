'use client';
/** Twelve-chart synthetic gallery through the actual public entry; no app services. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LineChart, BarChart, DonutChart, Streamgraph, BrushChart, WaffleChart,
  SlopeChart, Sparkline, Gauge, ActivityHeatmap, Ridgeline, Treemap } from '@zero/framework/components/charts/arc';

const series = [{ id: 'direct', label: 'Direct' }, { id: 'search', label: 'Search' }, { id: 'referral', label: 'Referral' }];
const values = [20, 28, 35, 40, 32, 36, 22, 18, 26, 34];
const observations = values.map((value, index) => ({ id: `day-${index}`, label: `October ${index + 1}`, axisLabel: String(index + 1),
  values: { direct: value, search: 44 - value / 2, referral: 12 + index } }));
const parts = [{ id: 'direct', label: 'Direct', value: 42 }, { id: 'search', label: 'Search', value: 32 }, { id: 'referral', label: 'Referral', value: 18 }, { id: 'social', label: 'Social', value: 8 }];
const days = Array.from({ length: 150 }, (_, index) => ({ date: new Date(Date.UTC(2026, 4, 1) + index * 86_400_000).toISOString().slice(0, 10), count: (index * 17 + index * index) % 12 }));
const tree = { id: 'root', label: 'All products', children: [
  { id: 'home', label: 'Home', children: [{ id: 'furniture', label: 'Furniture', value: 42, color: 8 }, { id: 'lighting', label: 'Lighting', value: 26, color: 4 }] },
  { id: 'studio', label: 'Studio', children: [{ id: 'ceramics', label: 'Ceramics', value: 22, color: 6 }, { id: 'textiles', label: 'Textiles', value: 18, color: 2 }] },
] };
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="gallery-card"><h2>{title}</h2>{children}</section>;
}
function Gallery() {
  return <main className="arc-gallery">
    <header><p className="gallery-eyebrow">ZERO CHARTS / ARC FAMILY</p><h1>Twelve charts. One design language.</h1><p>Trends, proportions, activity and distributions — synthetic measurements, shared Zero tokens.</p></header>
    <div className="gallery-grid">
      <Card title="01 / Line"><LineChart label="Daily source visits" data={observations} series={series} height={180} motion={false} /></Card>
      <Card title="02 / Bar"><BarChart label="Daily visits" period="October 1–10, 2026" data={values.map((value, index) => ({ id: `day-${index}`, label: String(index + 1), value }))} height={160} motion={false} /></Card>
      <Card title="03 / Donut"><DonutChart label="Visits by source" data={parts} size={180} thickness={22} motion={false} /></Card>
      <Card title="04 / Streamgraph"><Streamgraph label="Visits mix" data={observations} series={series} height={170} motion={false} /></Card>
      <Card title="05 / Brush"><BrushChart label="Visit history" height={170} overviewHeight={40} minSpan={86_400_000}
        data={values.map((value, index) => ({ date: Date.UTC(2026, 9, index + 1), value }))} motion={false} /></Card>
      <Card title="06 / Waffle"><WaffleChart label="Source units" data={parts} rows={10} columns={10} motion={false} /></Card>
      <Card title="07 / Slope"><SlopeChart label="Source conversion" startLabel="Before" endLabel="After" height={200} highlightId="direct" data={[
        { id: 'direct', label: 'Direct', start: 4.2, end: 7.8 }, { id: 'search', label: 'Search', start: 6.8, end: 5.4 },
        { id: 'referral', label: 'Referral', start: 3.2, end: 6.1 }, { id: 'social', label: 'Social', start: 5.4, end: 4.2 },
      ]} motion={false} /></Card>
      <Card title="08 / Sparkline"><Sparkline label="Revenue" value="$82K" change="+14.8%" data={values} width={320} height={100} motion={false} /></Card>
      <Card title="09 / Gauge"><Gauge label="Capacity used" detail="62 of 100 units" value={62} thresholds={[
        { from: 0, tone: 'success', label: 'Healthy' }, { from: 80, tone: 'warning', label: 'High' },
      ]} motion={false} /></Card>
      <Card title="10 / Activity"><ActivityHeatmap label="Daily contributions" period="May–September 2026" days={days} motion={false} /></Card>
      <Card title="11 / Ridgeline"><Ridgeline label="Response-time distribution" unit="ms" rowHeight={28} series={[
        { id: 'east', label: 'East', values: [24, 25, 30, 32, 35, 40, 42, 48, 50] },
        { id: 'west', label: 'West', values: [30, 35, 38, 42, 50, 54, 58, 60, 64] },
        { id: 'north', label: 'North', values: [18, 20, 24, 26, 28, 30, 34, 35, 38] },
        { id: 'south', label: 'South', values: [22, 24, 28, 30, 35, 38, 44, 48, 52] },
      ]} motion={false} /></Card>
      <Card title="12 / Treemap"><Treemap label="Product revenue" data={tree} height={220} colorLabel="Growth" motion={false} /></Card>
    </div>
  </main>;
}
const root = createRoot(document.getElementById('root')!);
declare global { interface Window { __arcGalleryUnmount: () => void } }
window.__arcGalleryUnmount = () => root.unmount();
root.render(<Gallery />);
