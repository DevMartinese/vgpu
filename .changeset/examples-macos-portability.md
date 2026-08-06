---
"@vgpu/cli": patch
"vgpu": patch
---

Make online `vgpu examples` commands work on macOS and Windows. `search`, `show`, and `cat` now
use an in-memory cache when Linux's descriptor-anchored persistent cache is unavailable. On macOS,
`pull` uses a portable symlink-checked staging path and preserves atomic publication and recovery.
Linux keeps its persistent offline cache and `/proc/self/fd` hardening unchanged.
