---
"@vgpu/cli": patch
---

`vgpu docs find` route hits are now ranked instead of returned alphabetically. `docs find gpu` used to dump 134 unranked lines (since "gpu" substring-matches nearly the whole index) and bury the exact match `Gpu` / `/vgpu/gpu.docs.md` around line 100; `find a` returned 260 lines with no way to tell a complete result set from a truncated one.

Route hits are now sorted into six match-quality tiers (exact symbol, exact page identity, word-boundary in name text, word-boundary in path, substring in name text, substring in path only), tie-broken by the shared package curation ladder, then page hits before symbol hits, then a stable line compare. Both the route and content tiers now share one `HIT_LIMIT` of 20 (replacing the separate `CONTENT_HIT_LIMIT`), and stdout appends a truncation notice whenever a tier is capped, so it's clear when results were cut off.
