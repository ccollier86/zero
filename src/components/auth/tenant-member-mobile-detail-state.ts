export type TenantMemberMobileDetailAction =
  | { type: 'selection-synchronized'; selectedMembershipId: string | null }
  | { type: 'detail-requested' }
  | { type: 'back-requested' };

/**
 * Keep passive controller selection separate from deliberate mobile navigation.
 *
 * Controllers select a default member and may replace that selection after a
 * search or status change. Those updates keep desktop detail useful, but must
 * not move a mobile user away from the list. Only a deliberate row or record
 * navigation action opens mobile detail; losing selection always closes it.
 */
export function reduceTenantMemberMobileDetail(
  open: boolean,
  action: TenantMemberMobileDetailAction,
): boolean {
  switch (action.type) {
    case 'selection-synchronized':
      return action.selectedMembershipId === null ? false : open;
    case 'detail-requested':
      return true;
    case 'back-requested':
      return false;
  }
}
