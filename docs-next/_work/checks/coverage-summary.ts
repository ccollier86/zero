/** Pure draft-placement counts and unmeasured-inventory detection; not a runtime or release audit. */
export interface InventoryPlacement {
  readonly system: string;
  readonly featureGroups: number;
  readonly drafted: number;
  readonly missing: readonly string[];
}

/** Keep empty/unparseable inventories visible instead of counting their existence as feature coverage. */
export function summarizeInventoryCoverage(systems: readonly InventoryPlacement[]) {
  return {
    kind: 'draft-placement-only' as const,
    systems: systems.length,
    featureGroups: systems.reduce((count, system) => count + system.featureGroups, 0),
    draftedFeatureGroups: systems.reduce((count, system) => count + system.drafted, 0),
    fullyPlacedSystems: systems.filter(system => system.featureGroups > 0 && system.drafted === system.featureGroups && system.missing.length === 0).length,
    unmeasuredSystems: systems.filter(system => system.featureGroups <= 0).map(system => system.system),
    coverage: systems,
  };
}
