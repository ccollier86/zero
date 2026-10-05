---
id: zero.email.roadmap
type: roadmap
audience: [developer, agent, maintainer]
owner: email
status: draft
visibility: internal
system: email
feature: future-direction
maturity: planned
---

# Email Roadmap

[Email index](./index.md) · [Documentation index](../../index.md)

The product backlog calls for more email/SMTP provider plugins and potentially
SMS/push notification adapters. These are direction, not current provider names,
configuration flags or supported delivery channels. The current extension seam
is the [EmailProvider interface](./providers.md).

- [ ] Evaluate additional email providers without coupling account policy to a vendor.
- [ ] Design SMS/push as appropriate channel adapters rather than mislabeling EmailMessage.
- [ ] Preserve captured app-local credentials, safe observability and honest acceptance/durability semantics in every adapter.

No schedule or approved implementation order is implied. A future generic
durable-mail API would need its own delivery, ownership and recovery contract;
Guardian's existing outbox is not that API.
