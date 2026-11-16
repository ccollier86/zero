# Calendar backend foundation

Internal work in progress. Nothing here enables a calendar in an application.
There is no managed mount, public server facade or release claim yet.

The [integration plan](../../docs-next/_work/calendar-integration-plan.md) remains
the contract for the remaining work.

This slice establishes pure admission and the private one-off conflict domain.
It does not implement the complete plan:

- Time helpers accept explicit canonical UTC instants and a scheduling zone.
  They do not convert wall time, expand recurrence or implement all-day records.
- Configuration is detached and fails closed, but is not connected to startup.
  A configured object is not runtime readiness.
- Realm commands run in the native tracked transaction boundary. They are not
  routes: actor fields and creation IDs must come from a trusted broker, never
  browser input. That broker and its live authority fences are still to come.
- Safe receipts preserve identity and outcome, not historical access rights.
- Private effect references are handoff groundwork, not another audit system or
  a working notification pipeline.

Before exposure, finish ownership/lifecycle, live Guardian integration, actual
file/actor qualification, availability, policy and UI contracts. No fake success
or partial feature enablement should bridge those gaps.
