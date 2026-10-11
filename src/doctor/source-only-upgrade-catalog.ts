/** Versioned, data-only migration catalog. Availability of optional parts is never a migration error. */
import type { UpgradeCatalogEntry } from './source-only-upgrade-types';

export const SOURCE_ONLY_UPGRADE_CATALOG_VERSION = 2;

const catalog: readonly UpgradeCatalogEntry[] = Object.freeze([
  { id: 'public-named-exports', detector: 'named-export', code: 'upgrade.import_missing',
    category: 'required', severity: 'error', docs: './docs-next/cli/doctor/source-audit.md#upgrade-auditing',
    hint: 'Use a named export actually provided by the intended public package. Doctor does not rewrite imports.' },
  { id: 'dropdown-inner-scroll-owner', detector: 'dropdown-scroll-owner', code: 'upgrade.dropdown_scroll_owner',
    capability: 'dropdownInnerViewport', category: 'manual-review', severity: 'warning', docs: './docs-next/frontend/components/overlays/dropdown-menu.md',
    hint: 'Content refs still address the Radix surface. Review scroll operations against viewportRef; keep surface measurement and focus on Content.' },
  { id: 'popover-bounded-body', detector: 'popover-scroll-body', code: 'upgrade.popover_scroll_body',
    capability: 'popoverViewport', category: 'recommended', severity: 'warning', docs: './docs-next/frontend/components/overlays/popover.md',
    hint: 'For an authored long body, consider PopoverViewport with fixed chrome outside. Do not nest it around an existing picker or command viewport.' },
  { id: 'copied-relative-assets', detector: 'relative-asset', code: 'upgrade.assets.missing',
    category: 'required', severity: 'error', docs: './docs-next/cli/tooling/source-copy.md',
    hint: 'Restore the confirmed local helper or stylesheet dependency. Customized copied source is not overwritten automatically.' },
  { id: 'legacy-chart-dependencies', detector: 'chart-dependency', code: 'upgrade.chart.legacy_dependency',
    category: 'manual-review', severity: 'info', docs: './docs-next/frontend/charts/index.md',
    hint: 'Inventory supported Recharts/legacy Zero chart dependencies; only migrate when the intended target and actual chart behavior are qualified.' },
  { id: 'rendered-chart-candidates', detector: 'chart-usage', code: 'upgrade.chart.legacy_usage',
    category: 'manual-review', severity: 'info', docs: './docs-next/frontend/charts/index.md',
    hint: 'Match data, axes, series, interactions and query projection to a verified handmade family. Do not rename chart imports mechanically.' },
].map(entry => Object.freeze(entry as UpgradeCatalogEntry)));

/** Release metadata does not substitute for target capability or source-contract evidence. */
export function getSourceOnlyUpgradeCatalog(): readonly UpgradeCatalogEntry[] { return catalog; }
