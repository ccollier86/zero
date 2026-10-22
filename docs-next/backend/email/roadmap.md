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

Standard [SMTP sending](./smtp.md) and optional [IMAP receiving](./mailbox.md)
are implemented. The remaining backlog includes additional vendor adapters
and potential SMS/push channels. Those future channels are not current
provider names or configuration flags. The extension seam remains the
[EmailProvider interface](./providers.md).

- [ ] Evaluate additional email providers without coupling account policy to a vendor.
- [ ] Design SMS/push as appropriate channel adapters rather than mislabeling EmailMessage.
- [ ] Preserve captured app-local credentials, safe observability and honest acceptance/durability semantics in every adapter.

No schedule or approved implementation order is implied. A future generic
durable-mail API would need its own delivery, ownership and recovery contract;
Guardian's existing outbox is not that API.
