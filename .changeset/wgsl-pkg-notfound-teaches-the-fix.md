---
"@vgpu/wgsl": minor
---

`VGPU-WGSL-PKG-NOTFOUND` now prescribes the fix instead of only naming the miss: an uninstalled package reports `Package <pkg> was not found. Install the package (npm install <pkg>) or check the specifier`, in-memory resolution points at `packageMap`/`modules`, and an unknown subpath names the package and its `exports` map. Scoped packages are also reported correctly — the filesystem message said `Package @vgpu` for `@vgpu/wgsl-std/noise` before.

WGSL package imports also resolve in layouts where the package reaches the project transitively. Resolution now tries the importing project's `node_modules` first (an installed copy always wins) and then Node's own resolver next to `@vgpu/wgsl`, which depends on `@vgpu/wgsl-std`. Walking up from the shader alone only worked when the package manager hoisted the package, so `import ... from "@vgpu/wgsl-std/noise"` failed under pnpm's isolated `node_modules` and Yarn PnP even though the package was installed.
