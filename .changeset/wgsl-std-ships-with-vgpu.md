---
"vgpu": minor
---

`@vgpu/wgsl-std` is now a dependency of `vgpu`, so WGSL package imports such as `import { voronoi3d } from "@vgpu/wgsl-std/noise";` resolve in any project that ran `npm install vgpu`. Previously the WGSL resolver failed with `VGPU-WGSL-PKG-NOTFOUND: Package @vgpu/wgsl-std was not found` until the package was installed separately, which no doc mentioned. This works under npm, pnpm, and Yarn PnP: the dependency entry alone only covers hoisting layouts, so `@vgpu/wgsl` resolves the standard modules next to itself when they are not in the project's own `node_modules`. The standard modules are pure `.wgsl` text with no JavaScript entry point.
