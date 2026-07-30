---
"@vgpu/wgsl": patch
---

`VGPU-WGSL-PKG-NOTFOUND` now prescribes the fix instead of only naming the miss: an uninstalled package reports `Package <pkg> was not found. Install the package (npm install <pkg>) or check the specifier`, in-memory resolution points at `packageMap`/`modules`, and an unknown subpath names the package and its `exports` map. Scoped packages are also reported correctly — the filesystem message said `Package @vgpu` for `@vgpu/wgsl-std/noise` before.
