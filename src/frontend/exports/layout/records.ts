/** Record/detail layouts, navigation and inline editing. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

// ─── Master-Detail ──────────────────────────────────────────────────────
export { MasterDetailPage, MasterDetailView } from '../../../components/master-detail';
export type {
  MasterDetailPageProps,
  MasterDetailRenderContext,
} from '../../../components/master-detail';

// ─── CRUD Page ──────────────────────────────────────────────────────────
export { CrudPage } from '../../../components/crud-page';
export type { CrudPageProps } from '../../../components/crud-page';

// ─── Stat Card ──────────────────────────────────────────────────────────
export { StatCard } from '../../../components/ui/stat-card';
export type { StatCardProps } from '../../../components/ui/stat-card';

// ─── Layout Components ──────────────────────────────────────────────────
export { ListDetailLayout } from '../../../components/ui/list-detail-layout';
export type { ListDetailLayoutProps } from '../../../components/ui/list-detail-layout';
export { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../../../components/ui/resizable';
export { DetailPanel } from '../../../components/ui/detail-panel';
export type { DetailPanelProps } from '../../../components/ui/detail-panel';
export { RecordNavigationBar } from '../../../components/ui/record-navigation-bar';
export { Kbd, KbdGroup, type KbdProps, type KbdGroupProps } from '../../../components/kbd';
export type {
  RecordNavigationBarProps,
  NavigationAction,
  RecordPrimaryAction,
} from '../../../components/ui/record-navigation-bar';
export {
  InlineEditText,
  resolveInlineEditTextKeyAction,
} from '../../../components/ui/inline-edit-text';
export type {
  InlineEditTextKeyAction,
  InlineEditTextProps,
  InlineEditTextState,
} from '../../../components/ui/inline-edit-text';
