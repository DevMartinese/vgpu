---
"vgpu": minor
---

`@vgpu/wgsl-std` is now a dependency of `vgpu`, so WGSL package imports such as `import { voronoi3d } from "@vgpu/wgsl-std/noise";` resolve in any project that ran `npm install vgpu`. Previously the WGSL resolver failed with `VGPU-WGSL-PKG-NOTFOUND: Package @vgpu/wgsl-std was not found` until the package was installed separately, which no doc mentioned. The standard modules are pure `.wgsl` text with no JavaScript entry point, so no bundle budget moves.
