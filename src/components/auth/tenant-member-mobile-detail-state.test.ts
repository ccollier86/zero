import { describe, expect, test } from 'bun:test';
import { reduceTenantMemberMobileDetail } from './tenant-member-mobile-detail-state';

describe('tenant member mobile detail state', () => {
  test('keeps initial and passively selected members in the mobile list', () => {
    let open = false;

    open = reduceTenantMemberMobileDetail(open, {
      type: 'selection-synchronized',
      selectedMembershipId: 'membership-default',
    });

    expect(open).toBe(false);
  });

  test('opens only for deliberate row or record navigation and Back closes it', () => {
    let open = reduceTenantMemberMobileDetail(false, {
      type: 'detail-requested',
    });
    expect(open).toBe(true);

    open = reduceTenantMemberMobileDetail(open, {
      type: 'selection-synchronized',
      selectedMembershipId: 'membership-selected-row',
    });
    expect(open).toBe(true);

    open = reduceTenantMemberMobileDetail(open, { type: 'back-requested' });
    expect(open).toBe(false);

    open = reduceTenantMemberMobileDetail(open, {
      type: 'detail-requested',
    });
    expect(open).toBe(true);
  });

  test('does not reopen after filter-driven passive reselection', () => {
    let open = reduceTenantMemberMobileDetail(true, { type: 'back-requested' });

    open = reduceTenantMemberMobileDetail(open, {
      type: 'selection-synchronized',
      selectedMembershipId: 'membership-filtered',
    });

    expect(open).toBe(false);
  });

  test('closes when filtering or refresh removes the selection', () => {
    let open = true;

    open = reduceTenantMemberMobileDetail(open, {
      type: 'selection-synchronized',
      selectedMembershipId: null,
    });
    expect(open).toBe(false);

    open = reduceTenantMemberMobileDetail(open, {
      type: 'selection-synchronized',
      selectedMembershipId: 'membership-restored-passively',
    });
    expect(open).toBe(false);
  });
});
