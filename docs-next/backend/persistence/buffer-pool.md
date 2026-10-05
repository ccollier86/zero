---
id: zero.persistence.buffer-pool
type: reference
audience: [developer, agent, operator]
owner: persistence
status: draft
visibility: internal
system: persistence
feature: buffer-pool
maturity: supported
applies_to: ["2.1.1 baseline with unreleased transaction/buffer corrections"]
modes: [file, hot, ephemeral, Fabric-actor]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Reuse Binary Buffers With Explicit Ownership

[Persistence index](./index.md) · [Documentation index](../../index.md)

BufferPool is a reusable Uint8Array helper, not SQLite's page cache,
a credential store or a durable data plane.

Standard buckets are 256/1024/4096/65536/262144 bytes. acquire(minSize) chooses
a sufficient bucket or a larger power-of-two size. It returns a buffer of at
least the requested valid size; the caller must track how much content is
meaningful rather than treat the full capacity as written data.

## Configuration And Corrected Bounds

maxPoolSize defaults100 per bucket; preallocate defaults true. Corrected warmup
retains at most min(10,maxPoolSize) in each standard bucket, including zero.
maxPoolSize and minSize admit nonnegative safe integers; invalid values reject
before allocation. SQLite config validates the pool bound before opening a
handle.

These bounds constrain retained pool entries, not every simultaneously acquired
buffer or total process RAM. Applications must bound payload size/concurrency
at their service boundary.

## Release

release only accepts a buffer currently owned by this pool; foreign/double
release is ignored. Corrected release zeroes a known buffer even when its bucket
is full and it will not be retained.

After release, the caller relinquishes ownership and must not read/write the old
reference while another operation may acquire it. Zeroing a Uint8Array is not
a guarantee that every historical copy/log/provider payload has been erased.

stats reports occupancy/capacity by standard or CUSTOM bucket name. It is not a
database metric or permanent allocation log.

## Verify

The isolated regressions check small/zero retention limits, warmup, full-bucket
zeroing, foreign/double release and invalid size admission. No live credentials
or application data are involved.

## Related Guides And Next Steps

- [Configuration](./configuration.md) wires service pool settings.
- [SQLite service](./sqlite-service.md) exposes an optional buffers helper.
- [Lifecycle](./lifecycle.md) owns the containing resource boundary.
