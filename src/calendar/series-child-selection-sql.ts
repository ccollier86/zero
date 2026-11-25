/** Shared private022 selection predicates. Only fixed package code supplies
 * table declarations and these closed aliases; no query input contains SQL,
 * aliases, callbacks or identifiers. Keep DTO, occupancy and forward DDL equal. */
import type { CALENDAR_SERIES_CHILD_TABLES } from './realm-series-children-migration';
import { CALENDAR_SERIES_MATERIALIZATION_TABLES as n } from './realm-series-materialization-migration';
import { CalendarError } from './error';
type Tables = typeof CALENDAR_SERIES_CHILD_TABLES;
type SourceAlias = 's' | 'source' | 'p' | 'cs';
type HeadAlias = 'h' | 'child' | 'OLD';
type ResourceAlias = 'm' | 'member';
function alias(value: string, allowed: readonly string[]): string {
  if (!allowed.includes(value)) throw new CalendarError('CALENDAR_CONFIG_INVALID'); return value;
}
function view(source: string, pointer: string, selected: string, publication: string): string {
  return `${pointer}.scope_id=${source}.scope_id AND ${pointer}.series_id=${source}.id AND ${pointer}.owner_id=${source}.owner_id
    AND ${selected}.id=${pointer}.current_view_id AND ${selected}.scope_id=${pointer}.scope_id AND ${selected}.series_id=${pointer}.series_id
    AND ${selected}.owner_id=${source}.owner_id AND ${selected}.phase='current' AND ${selected}.source_publication_id=${source}.published_publication_id
    AND ${publication}.id=${selected}.publication_id AND ${publication}.view_id=${selected}.id AND ${publication}.scope_id=${selected}.scope_id
    AND ${publication}.series_id=${selected}.series_id AND ${publication}.source_publication_id=${selected}.source_publication_id
    AND ${publication}.adoption_digest=${selected}.adoption_digest`;
}
/** A selected pointer alone is not a qualified promotion or permission to
 * suppress legacy021 occupancy. Its immutable adoption publication must match. */
export function calendarSeriesQualifiedChildViewSql(t: Tables, sourceAlias: SourceAlias = 's'): string {
  const s = alias(sourceAlias, ['s', 'source', 'p', 'cs']);
  return `EXISTS(SELECT 1 FROM ${t.current} selected_pointer JOIN ${t.views} selected_view ON selected_view.id=selected_pointer.current_view_id
    JOIN ${t.viewPublications} selected_publication ON selected_publication.id=selected_view.publication_id
    WHERE ${view(s, 'selected_pointer', 'selected_view', 'selected_publication')})`;
}
/** h must be the actual working head, not an immutable variant supplied by a
 * caller. A staged horizon may share a current view, so origin publication is
 * required independently of the already-selected view publication. */
export function calendarSeriesCurrentChildHeadSql(t: Tables, headAlias: HeadAlias = 'h', resourceAlias?: ResourceAlias): string {
  const h = alias(headAlias, ['h', 'child', 'OLD']);
  const selected = `EXISTS(SELECT 1 FROM ${t.current} head_pointer JOIN ${t.views} head_view ON head_view.id=head_pointer.current_view_id
    JOIN ${t.viewPublications} head_publication ON head_publication.id=head_view.publication_id
    JOIN calendar_series head_source ON head_source.id=head_pointer.series_id AND head_source.scope_id=head_pointer.scope_id
    WHERE head_pointer.scope_id=${h}.scope_id AND head_pointer.series_id=${h}.series_id AND head_pointer.current_view_id=${h}.view_id
      AND ${view('head_source', 'head_pointer', 'head_view', 'head_publication')})`;
  const origin = `(${h}.origin_kind='native21' AND EXISTS(SELECT 1 FROM ${n.versions} origin_version
    JOIN ${n.runState} origin_state ON origin_state.id=origin_version.run_id AND origin_state.scope_id=origin_version.scope_id AND origin_state.state='published'
    WHERE origin_version.id=${h}.native_version_id AND origin_version.id=${h}.version_id AND origin_version.run_id=${h}.native_run_id
      AND origin_version.scope_id=${h}.scope_id AND origin_version.series_id=${h}.series_id AND origin_version.occurrence_id=${h}.occurrence_id)
    OR ${h}.origin_kind='variant22' AND EXISTS(SELECT 1 FROM ${t.variants} origin_variant
      JOIN ${t.changes} origin_change ON origin_change.id=origin_variant.change_id AND origin_change.scope_id=origin_variant.scope_id AND origin_change.state='published'
      JOIN ${t.publications} origin_publication ON origin_publication.change_id=origin_change.id AND origin_publication.scope_id=origin_change.scope_id AND origin_publication.new_variant_id=origin_variant.id
      WHERE origin_variant.id=${h}.variant_version_id AND origin_variant.id=${h}.version_id AND origin_variant.scope_id=${h}.scope_id
        AND origin_variant.series_id=${h}.series_id AND origin_variant.occurrence_id=${h}.occurrence_id AND origin_variant.child_revision=${h}.child_revision
        AND origin_variant.child_exception_revision=${h}.child_exception_revision AND origin_variant.status=${h}.status
        AND origin_publication.appointment_id=${h}.appointment_id AND origin_publication.new_child_revision=${h}.child_revision
        AND origin_publication.new_selection_revision=${h}.selection_revision))`;
  let resource = '';
  if (resourceAlias !== undefined) {
    const m = alias(resourceAlias, ['m', 'member']);
    resource = ` AND ${m}.head_id=${h}.id AND ${m}.scope_id=${h}.scope_id AND ${m}.view_id=${h}.view_id AND ${m}.series_id=${h}.series_id
      AND ${m}.appointment_id=${h}.appointment_id AND ${m}.version_id=${h}.version_id AND ${m}.selection_revision=${h}.selection_revision
      AND ${m}.child_revision=${h}.child_revision AND ${m}.status=${h}.status AND ${m}.occupied_from_ms=${h}.occupied_from_ms AND ${m}.occupied_until_ms=${h}.occupied_until_ms`;
  }
  return `(${selected} AND ${origin}${resource})`;
}
