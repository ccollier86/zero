---
id: zero.schema.codecs
type: reference
audience: [developer, agent]
owner: schema
status: draft
visibility: internal
system: schema
feature: codecs
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [server, browser, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Logical Values And Stored Values

[Schema index](./index.md) · [Documentation index](../../index.md)

Forms edit logical values; SQLite and the Sync transport may represent the same
field differently. Codecs translate those representations. They do not validate
business rules, authorize access or persist a mutation.

## Representation Map

| Field kind | Logical/UI value | Encoded row value |
| --- | --- | --- |
| boolean | true or false | integer 1 or 0 |
| multiSelect, tags | string array | JSON text |
| multiple combobox | string array | JSON text |
| dateRange | start/end string pair | JSON text containing exactly two strings |
| json | parsed structured value | JSON text |
| single combobox and ordinary string/number fields | ordinary value | unchanged by this codec |

The client automatically knows declared boolean fields through its table
metadata. Do not assume every structured TEXT column automatically becomes a
typed object in every SDK/API. Use the descriptor's logical codecs at the
appropriate form/edit boundary.

## Use The Descriptor

```ts
import { defineSchema, field } from '@zero/framework/schema';

const preferences = defineSchema({
  enabled: field.boolean(),
  labels: field.tags(),
  window: field.dateRange(),
});

const stored = preferences.encodeRow({
  enabled: true,
  labels: ['review', 'urgent'],
  window: ['2026-10-01', '2026-10-31'],
});
// enabled: 1; labels/window: JSON strings
const logical = preferences.decodeRow(stored);
// enabled: true; labels/window: arrays
```

Both methods return a shallow copy. They convert declared fields that are present
and preserve other properties, including a generated primary key. They do not
filter protected fields; resource policy owns exposure/write admission.

## Low-Level Helpers

`encodeFieldValue(meta, value)` and `decodeFieldValue(meta, value)` are public
from `@zero/framework/schema`. Prefer the descriptor methods when the schema is
already available, so callers do not duplicate metadata.

Boolean decoding considers true, 1, '1' and 'true' true. Other values decode
false. That permissive conversion is not evidence that an arbitrary wire boolean
is valid: server logical mutation validation preserves invalid wire values so
they can be rejected with bounded field feedback.

Array decoders accept arrays or JSON text and stringify their entries; other
values become an empty array. Date ranges take the first two string values and
fill missing sides with an empty string. JSON decoding maps blank text to null;
malformed JSON text is preserved as a string rather than throwing.

JSON encoding parses an input string when it is valid JSON, otherwise serializes
that string as a JSON string value. It is not a sandbox or a promise that a
cyclic/non-JSON JavaScript object can be stored. Validate and constrain data
before sending it across a persistence/transport boundary.

## Verification And Troubleshooting

For each structured field, verify a valid logical value can encode and decode
without changing its meaning. Then validate the logical record separately. If a
table displays raw JSON text, check whether that screen is using wire rows or
descriptor-decoded values; do not add a second unrelated parser in the component.

The focused schema codec tests cover boolean and structured round trips. Their
execution against the current working source is not an installed-package claim.

## Related Guides And Next Steps

- [Descriptors](./descriptors.md) owns the row/field conversion API.
- [Tables](./tables.md) defines client boolean metadata and server validators.
- [Configuration](./configuration.md#defaults-and-read-time) distinguishes UI
  defaults from encoded storage and database defaults.
