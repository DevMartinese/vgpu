---
"@vgpu/cli": patch
"vgpu": patch
---

Make `vgpu examples` work on macOS. Online `search`, `show`, and `cat` commands now use an
in-memory cache when Linux's descriptor-anchored persistent cache is unavailable, while `pull`
uses a portable symlink-checked staging path and preserves atomic publication and recovery.
Linux keeps its persistent offline cache and `/proc/self/fd` hardening unchanged.
