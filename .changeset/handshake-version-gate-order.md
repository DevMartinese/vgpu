---
"@vgpu/cli": minor
---

`vgpu examples`'s discovery handshake now evaluates `schemaSha256` -> `status` (revoked/deprecated) -> `minimumCliVersion` -> the trusted-origin check on `indexUrl`, instead of running the origin check second. Previously, a CLI whose only problem was being out of date against a migrated origin surfaced `VGPU-EXAMPLES-INTEGRITY` ("API URL leaves trusted origin") instead of the more accurate `VGPU-EXAMPLES-CLI-TOO-OLD`, because the trusted-origin assertion ran before the version comparison (issue #255). Revocation (`status: "revoked"`) and the deprecation warning still take precedence over the version gate, unchanged from before -- this is a narrower reorder than the issue's literal proposal, which would also have let an old CLI see a revoked contract's status masked by `CLI-TOO-OLD`.

The primary observable change: an old CLI querying a discovery document whose contract `indexUrl` points at an origin the CLI does not yet trust (e.g. after a `vgpu.sh` origin migration), where the server has also raised `minimumCliVersion` past that CLI's version:

| Scenario (contract `indexUrl` is off-origin for this CLI) | Before | After |
|---|---|---|
| CLI older than `minimumCliVersion` | `VGPU-EXAMPLES-INTEGRITY` | `VGPU-EXAMPLES-CLI-TOO-OLD` |
| `status: "revoked"` | `VGPU-EXAMPLES-INTEGRITY` | `VGPU-EXAMPLES-INCOMPATIBLE-API` |
| `status: "deprecated"` | `INTEGRITY`, no warning | `INTEGRITY` (unchanged) + deprecation warning now emitted |

Exit code stays 5 in every row. Two notes on the rows beyond the first. The `revoked` row matters if you key on `INTEGRITY` during a migration whose contract is also revoked: you now get the more accurate `INCOMPATIBLE-API`, because the kill switch is evaluated before the origin check rather than after it. The `deprecated` row only adds a static warning string (`"Warning: vgpu-examples/v1 is deprecated.\n"`) that `handshake()` now reaches before failing the trust check; the error code and exit code are unchanged, and `vgpu examples` itself still prints accumulated warnings only on success paths, so CLI output in that case is unaffected.

Same-origin `indexUrl` (the normal case) is unaffected in all of the above: `revoked` already reported `INCOMPATIBLE-API` and `deprecated` already warned.

No wire format change: same `contracts[]` fields, same `discoveryVersion: 1`, same `schemaSha256` value. Servers cannot observe a CLI's internal check order. Do **not** bump `schemaSha256` to "trigger" this fix -- the schema check still runs first and is a hardcoded-constant comparison, not a signature; changing it breaks every deployed CLI with `VGPU-EXAMPLES-INCOMPATIBLE-API`.

BREAKING CHANGE (pre-1.0): anything that keys on `error.code === 'VGPU-EXAMPLES-INTEGRITY'` to detect version skew against a migrated origin will now see `VGPU-EXAMPLES-CLI-TOO-OLD` instead. This is the intended fix -- `INTEGRITY` is reserved for tampering/corruption signals, and conflating "your CLI is old" with "this data may be tampered with" was the bug. CLIs already published at or before `0.2.0-rc.0` are unaffected: they embed the old check order and keep emitting `INTEGRITY` regardless of this change. For this fix to help the *next* origin migration, operators must raise `minimumCliVersion` in the served discovery contract as part of that migration -- see `apps/docs/examples-api.md`.
