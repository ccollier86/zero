/** Pure controlled-data lookup and capability rules; no provider calls or mutations. */
import type {
  IntegrationSettingsAction, IntegrationSettingsGroup, IntegrationSettingsItem,
  IntegrationSettingsListProps,
} from './integration-settings-list.types';

/** Normalize flat rows without manufacturing a user/org group identity. */
export function integrationSettingsGroups(props: IntegrationSettingsListProps): readonly IntegrationSettingsGroup[] {
  const groups = props.groups ?? [{ id: '', items: props.items }];
  const groupIds = new Set<string>();
  for (const group of groups) {
    if (props.groups && (!group.id.trim() || groupIds.has(group.id))) {
      throw new TypeError('IntegrationSettingsList requires unique nonempty group IDs.');
    }
    groupIds.add(group.id);
    const itemIds = new Set<string>();
    for (const item of group.items) {
      if (!item.id.trim() || itemIds.has(item.id)) {
        throw new TypeError('IntegrationSettingsList requires unique nonempty row IDs within each group.');
      }
      itemIds.add(item.id);
      const actionIds = new Set<string>();
      for (const action of item.actions ?? []) {
        if (!action.id.trim() || actionIds.has(action.id)) {
          throw new TypeError('IntegrationSettingsList requires unique nonempty action IDs within each row.');
        }
        actionIds.add(action.id);
      }
    }
  }
  return groups;
}

/** A reason is an actual restriction, not a tooltip decorating an enabled action. */
export function integrationSettingsDisabled(value: { readonly disabled?: boolean; readonly disabledReason?: string }): boolean {
  return Boolean(value.disabled || value.disabledReason);
}

/** Read a target by ID/revision; freshly recreated descriptor objects remain valid. */
export function findIntegrationSettingsItem(
  props: IntegrationSettingsListProps, groupId: string, itemId: string, revision?: string | number,
): IntegrationSettingsItem | null {
  const items = props.groups?.find(group => group.id === groupId)?.items ?? (props.groups ? [] : props.items);
  const item = items.find(candidate => candidate.id === itemId);
  return item && Object.is(item.revision, revision) ? item : null;
}

/** Recheck current capabilities immediately before dispatch and after awaited work. */
export function findIntegrationSettingsAction(
  props: IntegrationSettingsListProps, groupId: string, itemId: string,
  revision: string | number | undefined, actionId: string,
): { readonly item: IntegrationSettingsItem; readonly action: IntegrationSettingsAction } | null {
  if (props.readOnly) return null;
  const item = findIntegrationSettingsItem(props, groupId, itemId, revision);
  const action = item?.actions?.find(candidate => candidate.id === actionId);
  return item && action && !integrationSettingsDisabled(item) && !integrationSettingsDisabled(action)
    ? { item, action } : null;
}
