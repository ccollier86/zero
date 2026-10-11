/** Synthetic shared-calendar cases; no network, accounts, storage, or app state. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Calendar, type CalendarView } from './calendar';
import { fr } from 'react-day-picker/locale';
import { Month, MonthGrid, MonthCaption, CaptionLabel, type DateRange } from 'react-day-picker';

function Harness() {
  const [single, setSingle] = useState<Date | undefined>(new Date(2026, 9, 7));
  const [month, setMonth] = useState(new Date(2026, 9, 1));
  const [multiple, setMultiple] = useState<Date[]>([]);
  const [range, setRange] = useState<DateRange>();
  const [initialYearView, setInitialYearView] = useState<CalendarView>('years');
  return <main className="grid grid-cols-1 gap-8 p-6">
    <section data-testid="single"><Calendar mode="single" selected={single} onSelect={setSingle}
      defaultMonth={new Date(2026, 9, 1)} today={new Date(2026, 9, 7)} />
      <output>{single?.toISOString()}</output></section>
    <section data-testid="bounded"><Calendar mode="single" defaultMonth={new Date(2026, 9, 1)}
      startMonth={new Date(2026, 9, 1)} endMonth={new Date(2027, 1, 1)}
      disabled={{ before: new Date(2026, 9, 10), after: new Date(2027, 1, 20) }} /></section>
    <section data-testid="controlled"><Calendar mode="single" month={month} onMonthChange={setMonth} />
      <output>{`${month.getFullYear()}-${month.getMonth() + 1}`}</output></section>
    <section data-testid="range"><Calendar mode="range" selected={range} onSelect={setRange}
      defaultMonth={new Date(2026, 9, 1)} numberOfMonths={2} />
      <output>{range ? `${range.from?.getDate() ?? ''}-${range.to?.getDate() ?? ''}` : ''}</output></section>
    <section data-testid="multiple"><Calendar mode="multiple" selected={multiple} onSelect={value => setMultiple(value ?? [])}
      defaultMonth={new Date(2026, 9, 1)} disabled={{ dayOfWeek: [0, 6] }} />
      <output>{multiple.map(date => date.getDate()).join(',')}</output></section>
    <section data-testid="locale"><Calendar mode="single" locale={fr}
      defaultMonth={new Date(2026, 9, 1)} /></section>
    <section data-testid="dropdown"><Calendar mode="single" captionLayout="dropdown"
      defaultMonth={new Date(2026, 9, 1)} startMonth={new Date(2025, 0, 1)} endMonth={new Date(2027, 11, 1)} /></section>
    <section data-testid="rtl"><Calendar mode="single" dir="rtl" defaultMonth={new Date(2026, 9, 1)} /></section>
    <section data-testid="hidden"><Calendar mode="single" defaultMonth={new Date(2026, 9, 1)}
      hidden={new Date(2026, 9, 8)} disabled={new Date(2026, 9, 9)} /></section>
    <section data-testid="disabled-nav"><Calendar mode="single" defaultMonth={new Date(2026, 9, 1)} disableNavigation /></section>
    <section data-testid="custom-month"><Calendar mode="single" defaultMonth={new Date(2026, 9, 1)}
      components={{ Month }} /></section>
    <section data-testid="custom-grid"><Calendar mode="single" defaultMonth={new Date(2026, 9, 1)}
      components={{ MonthGrid }} /></section>
    <section data-testid="large-years"><Calendar mode="single" defaultMonth={new Date(2026, 9, 1)}
      yearRange={[-10000, 10000]} /></section>
    <section data-testid="initial-years"><Calendar mode="single" defaultMonth={new Date(2026, 9, 1)}
      view={initialYearView} onViewChange={setInitialYearView} /></section>
    <section data-testid="initial-months"><Calendar mode="single" defaultMonth={new Date(2026, 9, 1)} view="months" /></section>
    <section data-testid="after-nav"><Calendar mode="single" defaultMonth={new Date(2026, 9, 1)} navLayout="after" /></section>
    <section data-testid="around-nav"><Calendar mode="single" defaultMonth={new Date(2026, 9, 1)} navLayout="around" /></section>
    <section data-testid="custom-caption"><Calendar mode="single" defaultMonth={new Date(2026, 9, 1)} components={{ MonthCaption }} /></section>
    <section data-testid="custom-label"><Calendar mode="single" defaultMonth={new Date(2026, 9, 1)} components={{ CaptionLabel }} /></section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
